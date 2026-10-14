/**
 * 14/10/2026 — P1: seleção pela lista interativa na edição de lançamentos.
 * Causa: replyIdToTexto trocava o ID `wa_ed:<nonce>:sel:<id>` pelo título
 * ("Uber"), e o fluxo de edição respondia "Não identifiquei o lançamento".
 * Somente fakes locais (sem rede, sem banco real, sem Meta).
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { replyIdToTexto } = await import("../src/server/whatsapp-interactive.server");

const tel = "5511999998888";
let n = 0;
const send = async (texto: string, external_id = `sl-${++n}`) => {
  const out = await processarMensagemWhatsApp({ telefone: tel, texto, external_id });
  return { ...out, resposta: String(out.resposta ?? "").replace(/\u00a0/g, " ") };
};
/** Simula o webhook: list_reply da Meta → mesmo texto que o handler recebe. */
const tapList = (id: string, title: string, ext?: string) => send(replyIdToTexto(id, title), ext);

const T0 = "2026-01-01T00:00:00.000Z";
const g = (o: Record<string, unknown>) => ({
  user_id: "u1", deleted_at: null, updated_at: T0, forma_pagamento: "pix", cartao_id: null,
  grupo_parcelamento_id: null, total_parcelas: 1, recorrencia_id: null, bem_id: null,
  categoria_id: "cat-mer", estabelecimento: "", origem: "web", ...o,
});
const rc = (o: Record<string, unknown>) => ({
  user_id: "u1", deleted_at: null, updated_at: T0, recorrencia_id: null, origem: "web", ...o,
});
function lastState(): any {
  const rows = (state.generic.whatsapp_messages ?? []).filter((m) => m.parsed?.kind === "wa_edit_old");
  return rows[rows.length - 1]?.parsed;
}
const snapshot = () => JSON.stringify(state.gastosData) + JSON.stringify(state.receitasData);
const financialInserts = () =>
  state.inserts.filter((i) => ["gastos", "receitas", "recorrencias", "contas_a_pagar"].includes(i.table)).length;

const outubro = () => resetState({ gastos: [
  g({ id: "g-uber", descricao: "Uber", valor: 13.2, data: "2026-10-01" }),
  g({ id: "g-m15", descricao: "Mercado", valor: 15, data: "2026-10-01" }),
  g({ id: "g-m56", descricao: "Mercado", valor: 56, data: "2026-10-01" }),
] });

beforeEach(() => { resetState(); n = 0; });

test("replyIdToTexto preserva o token da edição (não usa o título)", () => {
  const id = "wa_ed:0123456789ab:sel:g-uber";
  expect(replyIdToTexto(id, "Uber")).toBe(id);
  expect(replyIdToTexto("wa_ed:0123456789ab:pg:1", "Ver mais")).toBe("wa_ed:0123456789ab:pg:1");
  // Menus existentes inalterados.
  expect(replyIdToTexto("opt_2", "Gastos")).toBe("2");
  expect(replyIdToTexto("desconhecido", "Título")).toBe("Título");
});

test("cenário real: lista → Uber → pergunta o campo; nada alterado", async () => {
  outubro();
  const before = snapshot();
  await send("Quero editar um gasto de outubro de 2026");
  const s = lastState();
  expect(s.stage).toBe("select");
  const r = await tapList(`wa_ed:${s.nonce}:sel:g-uber`, "Uber");
  expect(r.resposta).not.toContain("Não identifiquei");
  expect(lastState().sel.id).toBe("g-uber");
  expect(lastState().stage).toBe("field");
  expect(snapshot()).toBe(before);
  expect(financialInserts()).toBe(0);
});

test("digitar o número continua funcionando", async () => {
  outubro();
  await send("Quero editar um gasto de outubro de 2026");
  const idx = lastState().cands.findIndex((c: any) => c.id === "g-uber");
  await send(String(idx + 1));
  expect(lastState().sel.id).toBe("g-uber");
});

test("mesma descrição, valores diferentes: seleciona pelo ID real", async () => {
  outubro();
  await send("Quero editar um gasto de outubro de 2026");
  await tapList(`wa_ed:${lastState().nonce}:sel:g-m56`, "Mercado");
  expect(lastState().sel.id).toBe("g-m56");
});

test("outra página da lista", async () => {
  resetState({ gastos: Array.from({ length: 10 }, (_, i) => g({ id: `g-${i}`, descricao: "Item", valor: 10 + i, data: `2026-08-${String(i + 1).padStart(2, "0")}` })) });
  await send("editar gasto de agosto de 2026");
  await tapList(`wa_ed:${lastState().nonce}:pg:1`, "Ver mais");
  expect(lastState().page).toBe(1);
  await tapList(`wa_ed:${lastState().nonce}:sel:g-9`, "Item");
  expect(lastState().sel.id).toBe("g-9");
});

test("receitas pela lista", async () => {
  resetState({ receitas: [
    rc({ id: "r-1", descricao: "Salário", valor: 3000, data: "2026-09-05" }),
    rc({ id: "r-2", descricao: "Freela", valor: 500, data: "2026-09-10" }),
  ] });
  await send("Quero editar uma receita de setembro de 2026");
  await tapList(`wa_ed:${lastState().nonce}:sel:r-2`, "Freela");
  expect(lastState().sel.id).toBe("r-2");
});

test("resposta repetida (mesmo id Meta) e lista antiga não mudam a seleção", async () => {
  outubro();
  await send("Quero editar um gasto de outubro de 2026");
  const old = lastState().nonce;
  const r0 = await tapList(`wa_ed:${old}:sel:g-uber`, "Uber", "meta-wamid-1");
  const seq = lastState().seq;
  const r1 = await tapList(`wa_ed:${old}:sel:g-uber`, "Uber", "meta-wamid-1");
  expect(r1.resposta).toBe(r0.resposta); // replay devolve a mesma resposta
  expect(lastState().seq).toBe(seq); // sem novo passo
  const r2 = await tapList(`wa_ed:${old}:sel:g-m56`, "Mercado");
  expect(r2.resposta).toContain("expirou");
  expect(lastState().sel.id).toBe("g-uber");
});

test("ID fora da busca, após cancelar, sem estado ou de outro menu: nada selecionado", async () => {
  outubro();
  await send("Quero editar um gasto de outubro de 2026");
  const r = await tapList(`wa_ed:${lastState().nonce}:sel:g-de-outro-usuario`, "Uber");
  expect(r.resposta).toContain("Não identifiquei");
  expect(lastState().sel).toBeUndefined();
  const nonce = lastState().nonce;
  await send("cancelar");
  const r2 = await tapList(`wa_ed:${nonce}:sel:g-uber`, "Uber");
  expect(r2.resposta).toContain("expirou");
  resetState();
  const r3 = await tapList("wa_ed:0123456789ab:sel:g-uber", "Uber");
  expect(r3.resposta).toContain("expirou");
  expect(financialInserts()).toBe(0);
});
