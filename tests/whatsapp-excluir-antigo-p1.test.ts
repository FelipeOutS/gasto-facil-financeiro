/**
 * P1 (14/10/2026) — Exclusão individual de gastos/receitas pelo WhatsApp.
 * Exclusão reversível (deleted_at), confirmação explícita, Voltar/Cancelar.
 * Somente fakes locais (sem rede, sem banco real, sem Meta).
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { replyIdToTexto } = await import("../src/server/whatsapp-interactive.server");
const { detectExclusaoAntiga } = await import("../src/server/whatsapp-editar-antigo.server");

const tel = "5511999998888";
let n = 0;
const send = async (texto: string, external_id = `ex-${++n}`) => {
  const out = await processarMensagemWhatsApp({ telefone: tel, texto, external_id });
  return { ...out, resposta: String(out.resposta ?? "").replace(/\u00a0/g, " ") };
};
const tap = (id: string, title: string, ext?: string) => send(replyIdToTexto(id, title), ext);

const T0 = "2026-01-01T00:00:00.000Z";
const g = (o: Record<string, unknown>) => ({
  user_id: "u1", deleted_at: null, updated_at: T0, forma_pagamento: "pix", cartao_id: null,
  grupo_parcelamento_id: null, total_parcelas: 1, recorrencia_id: null, bem_id: null, import_batch_id: null,
  categoria_id: null, estabelecimento: "", origem: "web", ...o,
});
const rc = (o: Record<string, unknown>) => ({
  user_id: "u1", deleted_at: null, updated_at: T0, recorrencia_id: null, import_batch_id: null, origem: "web", ...o,
});
const last = (): any => {
  const rows = (state.generic.whatsapp_messages ?? []).filter((m) => m.parsed?.kind === "wa_edit_old");
  return rows[rows.length - 1]?.parsed;
};
const gasto = (id: string) => (state.gastosData as any[]).find((x) => x.id === id);
const receita = (id: string) => (state.receitasData as any[]).find((x) => x.id === id);
const physicalDeletes = () => state.deletes?.filter?.((d: any) => ["gastos", "receitas"].includes(d.table)).length ?? 0;

const outubro = () => resetState({ gastos: [
  g({ id: "g-uber", descricao: "Uber", valor: 13.2, data: "2026-10-01" }),
  g({ id: "g-m15", descricao: "Mercado", valor: 15, data: "2026-10-01" }),
  g({ id: "g-m56", descricao: "Mercado", valor: 56, data: "2026-10-01" }),
  g({ id: "g-b", user_id: "u2", descricao: "Mercado", valor: 99, data: "2026-10-01" }),
] });

beforeEach(() => { resetState(); n = 0; });

test("detector reconhece os pedidos e ignora outros fluxos", () => {
  const now = new Date("2026-10-14T15:00:00Z");
  expect(detectExclusaoAntiga("Excluir um gasto de outubro de 2026", now)).toBe("gasto");
  expect(detectExclusaoAntiga("Apagar a receita do salário de setembro", now)).toBe("receita");
  expect(detectExclusaoAntiga("Remover o Uber de ontem", now)).toBe("lancamento");
  expect(detectExclusaoAntiga("Quero excluir um lançamento antigo", now)).toBe("lancamento");
  expect(detectExclusaoAntiga("excluir cartão nubank", now)).toBeNull();
  expect(detectExclusaoAntiga("apagar lembrete", now)).toBeNull();
  expect(detectExclusaoAntiga("apagar", now)).toBeNull();
});

test("lista → escolha → confirmação → exclusão reversível; some dos totais", async () => {
  outubro();
  await send("Excluir um gasto de outubro de 2026");
  const s = last();
  expect(s.stage).toBe("select");
  expect(s.cands.map((c: any) => c.id)).not.toContain("g-b"); // nunca de outro usuário
  const r = await tap(`wa_ed:${s.nonce}:sel:g-m56`, "Mercado");
  expect(r.resposta).toContain("Você vai excluir");
  expect(r.resposta).toContain("56,00");
  expect(gasto("g-m56").deleted_at).toBeNull(); // nada antes de confirmar
  const ok = await tap(`wa_ed:${last().nonce}:del`, "Confirmar");
  expect(ok.resposta).toContain("Gasto excluído");
  expect(gasto("g-m56").deleted_at).not.toBeNull(); // continua no banco (restaurável)
  expect(gasto("g-m15").deleted_at).toBeNull(); // descrição repetida intacta
  expect(gasto("g-b").deleted_at).toBeNull();
  expect(physicalDeletes()).toBe(0);
  // Nova busca não mostra o excluído.
  await send("Excluir um gasto de outubro de 2026");
  expect(last().cands.map((c: any) => c.id)).not.toContain("g-m56");
});

test("escolha pelo número e receita antiga", async () => {
  resetState({ receitas: [rc({ id: "r-sal", descricao: "Salário", valor: 3000, data: "2026-09-05" }),
    rc({ id: "r-out", descricao: "Freela", valor: 200, data: "2026-09-10" })] });
  await send("Apagar a receita do salário de setembro de 2026");
  expect(last().stage).toBe("confirm"); // único resultado vai direto à confirmação
  const ok = await send("sim");
  expect(ok.resposta).toContain("Receita excluída");
  expect(receita("r-sal").deleted_at).not.toBeNull();
  expect(receita("r-sal").deleted_source).toBe("whatsapp");
  expect(receita("r-out").deleted_at).toBeNull();
});

test("cancelar e voltar não alteram nada", async () => {
  outubro();
  await send("Excluir um gasto de outubro de 2026");
  await send("1");
  expect(last().stage).toBe("confirm");
  const v = await tap(`wa_ed:${last().nonce}:bk`, "Voltar");
  expect(last().stage).toBe("select");
  expect(v.resposta).toContain("Qual você quer excluir");
  await send("2");
  const c = await tap(`wa_ed:${last().nonce}:x`, "Cancelar");
  expect(c.resposta).toContain("exclusão cancelada");
  expect((state.gastosData as any[]).every((x) => x.deleted_at === null)).toBe(true);
});

test("confirmação duplicada e botão antigo não reaplicam", async () => {
  outubro();
  await send("Remover o Uber de outubro de 2026");
  const nonce = last().nonce;
  await tap(`wa_ed:${nonce}:del`, "Confirmar", "dup-1");
  const firstStamp = gasto("g-uber").deleted_at;
  const replay = await tap(`wa_ed:${nonce}:del`, "Confirmar", "dup-1");
  expect(replay.resposta).not.toContain("excluído"); // replay da Meta: recusado, sem reaplicar
  const again = await tap(`wa_ed:${nonce}:del`, "Confirmar", "dup-2");
  expect(again.resposta).toContain("expirou");
  expect(gasto("g-uber").deleted_at).toBe(firstStamp);
});

test("alteração concorrente pelo site: não exclui", async () => {
  outubro();
  await send("Remover o Uber de outubro de 2026");
  gasto("g-uber").updated_at = "2026-10-14T16:00:00.000Z"; // site editou depois
  const r = await tap(`wa_ed:${last().nonce}:del`, "Confirmar");
  expect(r.resposta).toContain("alterado no site");
  expect(gasto("g-uber").deleted_at).toBeNull();
});

test("já excluído pelo site antes de confirmar: informa, nada muda", async () => {
  outubro();
  await send("Remover o Uber de outubro de 2026");
  gasto("g-uber").deleted_at = "2026-10-14T16:00:00.000Z";
  const r = await tap(`wa_ed:${last().nonce}:del`, "Confirmar");
  expect(r.resposta).toContain("já foi excluído");
  expect(gasto("g-uber").deleted_at).toBe("2026-10-14T16:00:00.000Z");
});

test("lançamentos especiais bloqueados", async () => {
  resetState({ gastos: [
    g({ id: "p1", descricao: "Geladeira", valor: 100, data: "2026-10-02", grupo_parcelamento_id: "G", total_parcelas: 10 }),
    g({ id: "c1", descricao: "Cinema", valor: 40, data: "2026-10-03", forma_pagamento: "credito", cartao_id: "card" }),
    g({ id: "e1", descricao: "Padaria", valor: 8, data: "2026-10-04", import_batch_id: "b1" }),
    g({ id: "k1", descricao: "Luz", valor: 120, data: "2026-10-05" }),
  ], contas: [{ id: "cp1", user_id: "u1", gasto_id: "k1", status: "pago" }] } as any);
  for (const [nome, msg] of [["Geladeira", "parceladas"], ["Cinema", "cartão de crédito"], ["Padaria", "extrato"], ["Luz", "conta a pagar"]]) {
    const r = await send(`excluir gasto ${nome.toLowerCase()} de outubro de 2026`);
    expect(r.resposta).toContain(msg);
  }
  expect((state.gastosData as any[]).every((x) => x.deleted_at === null)).toBe(true);
});

test("pedido de exclusão em massa não é executado nesta rodada", async () => {
  outubro();
  const r = await send("excluir todos os gastos de outubro de 2026");
  expect(r.resposta).toContain("um lançamento por vez");
  expect((state.gastosData as any[]).every((x) => x.deleted_at === null)).toBe(true);
});

test("falha de persistência: informa erro e não alega exclusão", async () => {
  const { aplicarExclusao } = await import("../src/server/whatsapp-editar-antigo.server");
  const row = { id: "g1", updated_at: T0, deleted_at: null, total_parcelas: 1, forma_pagamento: "pix" };
  const q: any = {
    select: () => q, eq: () => q, is: () => q, limit: async () => ({ data: [], error: null }),
    maybeSingle: async () => (q._upd ? { data: null, error: { message: "db down" } } : { data: row, error: null }),
    update: () => { q._upd = true; return q; },
  };
  const db = { from: () => { q._upd = false; return q; }, rpc: async () => ({data:null,error:{message:"db down"}}) };
  const r = await aplicarExclusao(db, "u1", { t: "gastos", id: "g1", updated_at: T0, descricao: "X", valor: 1, data: "2026-10-01", categoria_id: null, allowed: [] }, new Date(), tel, "failure-fixture");
  expect(r).toBe("error");
});
