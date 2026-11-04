/**
 * Fluxo simples integrado (04/11/2026): áudio transcrito → interpretação → busca do
 * registro → prévia → confirmação → exclusão reversível → totais → replay → restauração
 * → isolamento entre usuários. Usa o handler real `processarMensagemWhatsApp` e o mesmo
 * normalizador de voz do webhook; banco é o fake local (sem rede, Meta ou dados reais).
 * A RPC `whatsapp_entry_mutate_v2` é validada em PostgreSQL descartável por
 * tests/sql/whatsapp/20-entry-v2-tests.sql.
 */
import { test, expect, beforeEach, afterAll } from "bun:test";
import { state, resetState, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const prevVersion = process.env.WHATSAPP_FINANCIAL_MUTATIONS_VERSION;
process.env.WHATSAPP_FINANCIAL_MUTATIONS_VERSION = "2";
afterAll(() => { process.env.WHATSAPP_FINANCIAL_MUTATIONS_VERSION = prevVersion; });

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { replyIdToTexto } = await import("../src/server/whatsapp-interactive.server");
const { normalizeVoiceMoney } = await import("../src/server/whatsapp-voice-number-normalizer.server");

const tel = "5511999998888";
let n = 0;
/** Mesmo encadeamento do webhook: transcrição → normalização monetária → pipeline textual com source audio. */
const audio = async (transcricao: string, external_id = `au-${++n}`) => {
  const texto = normalizeVoiceMoney(transcricao).normalizedText;
  const out = await processarMensagemWhatsApp({ telefone: tel, texto, external_id, source: "audio" } as any);
  return { ...out, resposta: String(out.resposta ?? "").replace(/\u00a0/g, " ") };
};
const tap = async (id: string, title: string, external_id = `tp-${++n}`) => {
  const out = await processarMensagemWhatsApp({ telefone: tel, texto: replyIdToTexto(id, title), external_id });
  return { ...out, resposta: String(out.resposta ?? "").replace(/\u00a0/g, " ") };
};
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
const ativos = (rows: any[], uid: string) => rows.filter((x) => x.user_id === uid && !x.deleted_at).reduce((a, x) => a + x.valor, 0);
const gastos = () => state.gastosData as any[];
const receitas = () => state.receitasData as any[];
const finInserts = () => state.inserts.filter((i) => ["gastos", "receitas"].includes(i.table)).length;
const rpcCalls = () => (state as any).rpcCalls?.filter?.((c: any) => c.fn === "whatsapp_entry_mutate_v2").length;

beforeEach(() => {
  n = 0;
  resetState({
    gastos: [
      g({ id: "g-m", descricao: "Mercado", valor: 56, data: "2026-10-01" }),
      g({ id: "g-u", descricao: "Uber", valor: 10, data: "2026-10-01" }),
      g({ id: "g-x", user_id: "u2", descricao: "Mercado", valor: 99, data: "2026-10-01" }),
    ],
    receitas: [
      rc({ id: "r-s", descricao: "Salário", valor: 3000, data: "2026-10-05" }),
      rc({ id: "r-x", user_id: "u2", descricao: "Salário", valor: 7000, data: "2026-10-05" }),
    ],
  });
});

test("gasto por áudio: prévia sem escrita → confirma → some dos totais → replay não reaplica → restaura", async () => {
  const previa = await audio("excluir o mercado de outubro de 2026");
  expect(previa.resposta).toContain("56,00");
  expect(gastos().find((x) => x.id === "g-m").deleted_at).toBeNull(); // prévia não grava
  const nonce = last().nonce;

  const ok = await tap(`wa_ed:${nonce}:del`, "Confirmar", "tp-del");
  expect(ok.resposta).toContain("Gasto excluído");
  const del = gastos().find((x) => x.id === "g-m");
  expect(del.deleted_at).not.toBeNull(); // exclusão reversível, linha preservada
  expect(gastos().length).toBe(3); // nenhum DELETE físico
  expect(ativos(gastos(), "u1")).toBe(10);
  const stamp = del.deleted_at;

  // Replay: mesmo botão (nova entrega) e reentrega do mesmo wamid.
  const replay = await tap(`wa_ed:${nonce}:del`, "Confirmar");
  expect(replay.resposta).not.toContain("Gasto excluído");
  await tap(`wa_ed:${nonce}:del`, "Confirmar", "tp-del");
  expect(gastos().find((x) => x.id === "g-m").deleted_at).toBe(stamp);
  expect(ativos(gastos(), "u1")).toBe(10);

  const rest = await audio("restaurar o gasto do mercado que eu apaguei");
  expect(rest.resposta).toContain("Você vai restaurar");
  expect(gastos().find((x) => x.id === "g-m").deleted_at).not.toBeNull(); // nada antes de confirmar
  const ok2 = await tap(`wa_ed:${last().nonce}:rst`, "Confirmar");
  expect(ok2.resposta).toContain("Gasto restaurado");
  expect(gastos().find((x) => x.id === "g-m").deleted_at).toBeNull();
  expect(ativos(gastos(), "u1")).toBe(66);
  expect(finInserts()).toBe(0); // restaurar não cria lançamento novo

  // Isolamento: registro de u2 com mesma descrição nunca foi tocado.
  const outro = gastos().find((x) => x.id === "g-x");
  expect(outro.deleted_at).toBeNull();
  expect(outro.updated_at).toBe(T0);
  expect(ativos(gastos(), "u2")).toBe(99);
  void rpcCalls;
});

test("receita por áudio: exclui e restaura a própria; receita de outro usuário intacta", async () => {
  await audio("apagar a receita do salário de outubro de 2026");
  expect(receitas().find((x) => x.id === "r-s").deleted_at).toBeNull();
  const del = await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "s1" });
  expect(String(del.resposta)).toContain("Receita excluída");
  expect(ativos(receitas(), "u1")).toBe(0);
  expect(ativos(receitas(), "u2")).toBe(7000);

  await audio("recuperar a receita que apaguei");
  const ok = await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "s2" });
  expect(String(ok.resposta)).toContain("Receita restaurada");
  expect(ativos(receitas(), "u1")).toBe(3000);
  expect(receitas().find((x) => x.id === "r-x").updated_at).toBe(T0);
  expect(finInserts()).toBe(0);
});

test("áudio de lista de excluídos não cai no bloqueio de reorganização em massa", async () => {
  gastos().find((x) => x.id === "g-m").deleted_at = "2026-10-13T12:00:00.000Z";
  const r = await audio("mostrar meus gastos excluídos");
  expect(r.resposta).not.toContain("reorganização financeira em massa");
  expect(r.resposta).toContain("Mercado");
});

test("pedido em massa por áudio continua bloqueado e não grava", async () => {
  const r = await audio("apague todos os gastos de outubro de 2026 e adicione uma receita de cinco mil reais");
  expect(r.resposta).toContain("bloqueada");
  expect(ativos(gastos(), "u1")).toBe(66);
  expect(finInserts()).toBe(0);
});

test("sem a versão segura habilitada, a exclusão falha fechada", async () => {
  process.env.WHATSAPP_FINANCIAL_MUTATIONS_VERSION = "";
  try {
    await audio("excluir o mercado de outubro de 2026");
    await tap(`wa_ed:${last().nonce}:del`, "Confirmar");
    expect(gastos().find((x) => x.id === "g-m").deleted_at).toBeNull();
  } finally {
    process.env.WHATSAPP_FINANCIAL_MUTATIONS_VERSION = "2";
  }
});
