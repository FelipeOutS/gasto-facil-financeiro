/**
 * P1 (14/10/2026) — Restauração individual de gastos/receitas excluídos pelo WhatsApp.
 * Ciclo completo: excluir → some dos totais → restaurar → volta aos totais.
 * Somente fakes locais (sem rede, sem banco real, sem Meta).
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { replyIdToTexto } = await import("../src/server/whatsapp-interactive.server");
const { detectRestauracaoAntiga, detectExclusaoAntiga, aplicarRestauracao } = await import("../src/server/whatsapp-editar-antigo.server");

const tel = "5511999998888";
let n = 0;
const send = async (texto: string, external_id = `rs-${++n}`) => {
  const out = await processarMensagemWhatsApp({ telefone: tel, texto, external_id });
  return { ...out, resposta: String(out.resposta ?? "").replace(/\u00a0/g, " ") };
};
const tap = (id: string, title: string, ext?: string) => send(replyIdToTexto(id, title), ext);
const T0 = "2026-01-01T00:00:00.000Z";
const DEL = "2026-10-13T12:00:00.000Z";
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
const totalGastos = () => (state.gastosData as any[]).filter((x) => x.user_id === "u1" && !x.deleted_at).reduce((a, x) => a + x.valor, 0);
const totalReceitas = () => (state.receitasData as any[]).filter((x) => x.user_id === "u1" && !x.deleted_at).reduce((a, x) => a + x.valor, 0);
const finInserts = () => state.inserts.filter((i) => ["gastos", "receitas"].includes(i.table)).length;

beforeEach(() => { resetState(); n = 0; });

test("detector: restaurar ≠ cadastrar/excluir", () => {
  const now = new Date("2026-10-14T15:00:00Z");
  expect(detectRestauracaoAntiga("Restaurar um gasto excluído", now)).toBe("gasto");
  expect(detectRestauracaoAntiga("Recuperar a receita que apaguei", now)).toBe("receita");
  expect(detectRestauracaoAntiga("Mostrar meus gastos excluídos", now)).toBe("gasto");
  expect(detectRestauracaoAntiga("Desfazer a exclusão do mercado de ontem", now)).toBe("lancamento");
  expect(detectRestauracaoAntiga("gastei 50 no mercado", now)).toBeNull();
  expect(detectRestauracaoAntiga("desfazer", now)).toBeNull();
  expect(detectRestauracaoAntiga("restaurar cartão", now)).toBeNull();
  expect(detectExclusaoAntiga("Recuperar a receita que apaguei", now)).toBeNull();
});

test("ciclo gasto: excluir → some dos totais → restaurar → volta, sem lançamento novo", async () => {
  resetState({ gastos: [g({ id: "g-m", descricao: "Mercado", valor: 56, data: "2026-10-01" }), g({ id: "g-u", descricao: "Uber", valor: 10, data: "2026-10-01" })] });
  expect(totalGastos()).toBe(66);
  await send("excluir o mercado de outubro de 2026");
  await tap(`wa_ed:${last().nonce}:del`, "Confirmar");
  expect(totalGastos()).toBe(10);
  const r = await send("Restaurar um gasto excluído");
  expect(r.resposta).toContain("Você vai restaurar");
  expect(r.resposta).toContain("56,00");
  expect(gasto("g-m").deleted_at).not.toBeNull(); // nada antes de confirmar
  const ok = await tap(`wa_ed:${last().nonce}:rst`, "Confirmar");
  expect(ok.resposta).toContain("Gasto restaurado");
  expect(gasto("g-m").deleted_at).toBeNull();
  expect(totalGastos()).toBe(66); // sem duplicar
  expect(finInserts()).toBe(0);
  // Edição continua funcionando no restaurado.
  await send("editar gasto mercado de outubro de 2026");
  expect(last().acao ?? "editar").toBe("editar");
  expect(last().sel?.id).toBe("g-m");
});

test("ciclo receita: excluir → restaurar limpa a origem da exclusão", async () => {
  resetState({ receitas: [rc({ id: "r-s", descricao: "Salário", valor: 3000, data: "2026-09-05" })] });
  await send("Apagar a receita do salário de setembro de 2026");
  await send("sim");
  expect(totalReceitas()).toBe(0);
  await send("Recuperar a receita que apaguei");
  const ok = await send("sim");
  expect(ok.resposta).toContain("Receita restaurada");
  expect(receita("r-s").deleted_at).toBeNull();
  expect(receita("r-s").deleted_source).toBeNull();
  expect(totalReceitas()).toBe(3000);
});

test("lista vários excluídos; só do próprio usuário; escolha pelo número", async () => {
  resetState({ gastos: [
    g({ id: "a", descricao: "Mercado", valor: 15, data: "2026-10-01", deleted_at: DEL }),
    g({ id: "b", descricao: "Mercado", valor: 56, data: "2026-10-02", deleted_at: DEL }),
    g({ id: "ativo", descricao: "Mercado", valor: 1, data: "2026-10-03" }),
    g({ id: "x", user_id: "u2", descricao: "Mercado", valor: 99, data: "2026-10-02", deleted_at: DEL }),
  ] });
  await send("Mostrar meus gastos excluídos");
  const ids = last().cands.map((c: any) => c.id).sort();
  expect(ids).toEqual(["a", "b"]);
  const idx = last().cands.findIndex((c: any) => c.id === "a");
  await send(String(idx + 1));
  await send("sim");
  expect(gasto("a").deleted_at).toBeNull();
  expect(gasto("b").deleted_at).toBe(DEL);
  expect(gasto("x").deleted_at).toBe(DEL);
});

test("cancelar não restaura", async () => {
  resetState({ gastos: [g({ id: "a", descricao: "Uber", valor: 9, data: "2026-10-01", deleted_at: DEL })] });
  await send("Restaurar um gasto excluído");
  const c = await tap(`wa_ed:${last().nonce}:x`, "Cancelar");
  expect(c.resposta).toContain("restauração cancelada");
  expect(gasto("a").deleted_at).toBe(DEL);
});

test("confirmação duplicada e botão antigo não reaplicam", async () => {
  resetState({ gastos: [g({ id: "a", descricao: "Uber", valor: 9, data: "2026-10-01", deleted_at: DEL })] });
  await send("Restaurar um gasto excluído");
  const nonce = last().nonce;
  await tap(`wa_ed:${nonce}:rst`, "Confirmar", "d1");
  const stamp = gasto("a").updated_at;
  const again = await tap(`wa_ed:${nonce}:rst`, "Confirmar", "d2");
  expect(again.resposta).toContain("expirou");
  expect(gasto("a").updated_at).toBe(stamp);
});

test("concorrência: site já restaurou ou alterou → não sobrescreve", async () => {
  resetState({ gastos: [g({ id: "a", descricao: "Uber", valor: 9, data: "2026-10-01", deleted_at: DEL })] });
  await send("Restaurar um gasto excluído");
  gasto("a").deleted_at = null;
  const r = await tap(`wa_ed:${last().nonce}:rst`, "Confirmar");
  expect(r.resposta).toContain("já estava ativo");
  resetState({ gastos: [g({ id: "b", descricao: "Uber", valor: 9, data: "2026-10-01", deleted_at: DEL })] });
  await send("Restaurar um gasto excluído");
  gasto("b").updated_at = "2026-10-14T16:00:00.000Z";
  const r2 = await tap(`wa_ed:${last().nonce}:rst`, "Confirmar");
  expect(r2.resposta).toContain("mudou");
  expect(gasto("b").deleted_at).toBe(DEL);
});

test("tipos especiais não são restaurados por aqui", async () => {
  resetState({ gastos: [
    g({ id: "p", descricao: "Geladeira", valor: 100, data: "2026-10-02", grupo_parcelamento_id: "G", total_parcelas: 10, deleted_at: DEL }),
  ] });
  const r = await send("Restaurar um gasto excluído");
  expect(r.resposta).toContain("parceladas");
  expect(gasto("p").deleted_at).toBe(DEL);
});

test("nenhum excluído: avisa e não altera", async () => {
  resetState({ gastos: [g({ id: "a", descricao: "Uber", valor: 9, data: "2026-10-01" })] });
  const r = await send("Restaurar um gasto excluído");
  expect(r.resposta).toContain("Não encontrei nenhum gasto excluído");
});

test("falha de banco: não alega restauração", async () => {
  const row = { id: "g1", updated_at: T0, deleted_at: DEL, total_parcelas: 1, forma_pagamento: "pix" };
  const q: any = {
    select: () => q, eq: () => q, is: () => q, not: () => q, limit: async () => ({ data: [], error: null }),
    maybeSingle: async () => (q._upd ? { data: null, error: { message: "db down" } } : { data: row, error: null }),
    update: () => { q._upd = true; return q; },
  };
  const db = { from: () => { q._upd = false; return q; }, rpc: async () => ({data:null,error:{message:"db down"}}) };
  const r = await aplicarRestauracao(db, "u1", { t: "gastos", id: "g1", updated_at: T0, descricao: "X", valor: 1, data: "2026-10-01", categoria_id: null, allowed: [] }, new Date(), tel, "failure-fixture");
  expect(r).toBe("error");
});
