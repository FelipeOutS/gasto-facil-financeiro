/**
 * 14/10/2026 — Ajustes finais da edição pelo WhatsApp:
 * interrupção por novo lançamento (pergunta antes de abandonar) e "ver mais" estrito.
 * Somente fakes locais (sem rede, sem banco real, sem Meta).
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { MORE_CMD } = await import("../src/server/whatsapp-editar-antigo.server");

const tel = "5511999998888";
let n = 0;
const send = async (texto: string) => {
  const out = await processarMensagemWhatsApp({ telefone: tel, texto, external_id: `int-${++n}` });
  return { ...out, resposta: String(out.resposta ?? "").replace(/\u00a0/g, " ") };
};
const T0 = "2026-01-01T00:00:00.000Z";
const g = (o: Record<string, unknown>) => ({
  user_id: "u1", deleted_at: null, updated_at: T0, forma_pagamento: "pix", cartao_id: null,
  grupo_parcelamento_id: null, total_parcelas: 1, recorrencia_id: null, bem_id: null,
  categoria_id: "cat-mer", estabelecimento: "", origem: "web", ...o,
});
function lastState(): any {
  const rows = (state.generic.whatsapp_messages ?? []).filter((m) => m.parsed?.kind === "wa_edit_old");
  return rows[rows.length - 1]?.parsed;
}
const financialInserts = () =>
  state.inserts.filter((i) => ["gastos", "receitas", "recorrencias", "contas_a_pagar"].includes(i.table)).length;
const gasto = (id: string) => state.gastosData.find((x) => x.id === id)!;
const snapshot = () => JSON.stringify(state.gastosData) + JSON.stringify(state.receitasData);

beforeEach(() => { resetState(); n = 0; });

async function abrirValor() {
  resetState({ gastos: [g({ id: "g-1", descricao: "Mercado", valor: 56, data: "2026-09-05" })] });
  await send("editar gasto de setembro de 2026");
  await send("valor");
  expect(lastState().stage).toBe("value");
}

test("'gastei...' no meio da edição pergunta; estado preservado; nada gravado", async () => {
  await abrirValor();
  const before = snapshot();
  const r = await send("gastei 30 no uber");
  expect(r.resposta).toContain("Continuar edição");
  expect(r.resposta).toContain("Iniciar novo lançamento");
  expect(r.resposta).toContain("Cancelar");
  const s = lastState();
  expect(s.stage).toBe("interrupt");
  expect(s.resume).toBe("value");
  expect(s.sel.id).toBe("g-1");
  expect(s.pending_text).toBe("gastei 30 no uber");
  expect(financialInserts()).toBe(0);
  expect(snapshot()).toBe(before);
  // Texto aleatório não decide: repete a pergunta.
  const r2 = await send("hmm");
  expect(r2.resposta).toContain("Continuar edição");
  expect(lastState().stage).toBe("interrupt");
  expect(financialInserts()).toBe(0);
});

test("Continuar edição retoma a etapa e conclui só após Confirmar", async () => {
  await abrirValor();
  await send("recebi 200 de freela");
  const s = lastState();
  const r = await send(`wa_ed:${s.nonce}:cont`);
  expect(lastState().stage).toBe("value");
  expect(r.resposta.length).toBeGreaterThan(0);
  await send("65");
  expect(gasto("g-1").valor).toBe(56);
  await send("sim");
  expect(gasto("g-1").valor).toBe(65);
  expect(financialInserts()).toBe(0);
});

test("botão antigo da pergunta não vale após a escolha", async () => {
  await abrirValor();
  await send("gastei 30 no uber");
  const old = lastState().nonce;
  await send(`wa_ed:${old}:cont`);
  const r = await send(`wa_ed:${old}:novo`);
  expect(r.resposta).toContain("expirou");
  expect(financialInserts()).toBe(0);
  expect(lastState().stage).toBe("value");
});

test("Iniciar novo lançamento encerra a edição e segue para o cadastro normal", async () => {
  await abrirValor();
  await send("gastei 30 no uber");
  const s = lastState();
  const r = await send(`wa_ed:${s.nonce}:novo`);
  expect(lastState().stage).toBe("done");
  expect(r.resposta).not.toContain("Continuar edição");
  expect(r.resposta).toMatch(/30/);
  expect(gasto("g-1").valor).toBe(56); // gasto em edição intacto
});

test("Cancelar na pergunta: sem efeitos financeiros", async () => {
  await abrirValor();
  const before = snapshot();
  await send("gastei 30 no uber");
  const r = await send("cancelar");
  expect(r.resposta).toContain("cancelada");
  expect(lastState().stage).toBe("done");
  expect(financialInserts()).toBe(0);
  expect(snapshot()).toBe(before);
  // Botão Cancelar também.
  await abrirValor();
  await send("paguei 10 de estacionamento");
  await send(`wa_ed:${lastState().nonce}:x`);
  expect(lastState().stage).toBe("done");
  expect(financialInserts()).toBe(0);
});

test("'mais' só pagina quando é o pedido inteiro", async () => {
  expect(MORE_CMD.test("mais")).toBe(true);
  expect(MORE_CMD.test("ver mais")).toBe(true);
  expect(MORE_CMD.test("proximos")).toBe(true);
  expect(MORE_CMD.test("mais barato")).toBe(false);
  expect(MORE_CMD.test("mercado mais caro")).toBe(false);
  expect(MORE_CMD.test("mais 50")).toBe(false);
  expect(MORE_CMD.test("50 a mais")).toBe(false);

  const gs = Array.from({ length: 10 }, (_, i) => g({ id: `g-${i}`, descricao: `Item ${i}`, valor: 10 + i, data: `2026-08-${String(i + 1).padStart(2, "0")}` }));
  resetState({ gastos: gs });
  await send("editar gasto de agosto de 2026");
  const s0 = lastState();
  expect(s0.stage).toBe("select");
  const r = await send("mais barato");
  expect(r.resposta).toContain("Não identifiquei");
  expect(lastState().page).toBe(0);
  await send("ver mais");
  const s2 = lastState();
  expect(s2.page).toBe(1);
  // Vínculo opção → ID real preservado.
  expect(s2.cands.map((c: any) => c.id).sort()).toEqual(gs.map((x) => x.id).sort());
  await send(`wa_ed:${s2.nonce}:sel:g-9`);
  expect(lastState().sel.id).toBe("g-9");
  expect(financialInserts()).toBe(0);
});

test("descrição com 'mais' é tratada como valor do campo, sem paginar", async () => {
  resetState({ gastos: [g({ id: "g-1", descricao: "Mercado", valor: 56, data: "2026-09-05" })] });
  await send("editar gasto de setembro de 2026");
  await send("descrição");
  const r = await send("mais");
  expect(r.resposta).toContain("Nova descrição: mais");
  expect(gasto("g-1").descricao).toBe("Mercado");
  await send("sim");
  expect(gasto("g-1").descricao).toBe("mais");
});
