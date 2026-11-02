/**
 * P1 (14/10/2026) — precisão da busca por descrição em edição/exclusão/restauração.
 * Somente fakes locais (sem rede, sem banco real, sem Meta).
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { replyIdToTexto } = await import("../src/server/whatsapp-interactive.server");
const { rankPorTermo } = await import("../src/server/whatsapp-editar-antigo.server");

const tel = "5511999998888";
let n = 0;
const send = async (texto: string) => {
  const out = await processarMensagemWhatsApp({ telefone: tel, texto, external_id: `bu-${++n}` });
  return { ...out, resposta: String(out.resposta ?? "").replace(/\u00a0/g, " ") };
};
const tap = (id: string, title: string) => send(replyIdToTexto(id, title));
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
const testes = () => resetState({ gastos: [
  g({ id: "g-exato", descricao: "TESTE EDIÇÃO WHATSAPP", valor: 10, data: "2026-10-10" }),
  g({ id: "g-t1", descricao: "Teste", valor: 1, data: "2026-10-09" }),
  g({ id: "g-t2", descricao: "teste mercado", valor: 2, data: "2026-10-08" }),
  g({ id: "g-t3", descricao: "Teste edição", valor: 3, data: "2026-10-07" }),
  g({ id: "g-t4", descricao: "Teste WhatsApp 2", valor: 4, data: "2026-10-06" }),
  g({ id: "g-outro", user_id: "u2", descricao: "TESTE EDICAO WHATSAPP", valor: 99, data: "2026-10-10" }),
] });

beforeEach(() => { resetState(); n = 0; });

test("rank: exata (caixa/acento) vence parciais", () => {
  const rows = [{ descricao: "Teste", data: "1" }, { descricao: "teste edicao whatsapp", data: "2" }, { descricao: "Teste edição", data: "3" }];
  expect(rankPorTermo(rows, "TESTE EDIÇÃO WHATSAPP").map((r) => r.data)).toEqual(["2"]);
  expect(rankPorTermo(rows, "edicao").map((r) => r.data)).toEqual(["3", "2"]);
  expect(rankPorTermo(rows, "padaria")).toEqual([]);
});

test("descrição exata e única: vai direto à prévia; nada excluído antes de confirmar", async () => {
  testes();
  const r = await send("Quero excluir o gasto TESTE EDICAO WHATSAPP");
  expect(last().stage).toBe("confirm");
  expect(last().sel.id).toBe("g-exato");
  expect(r.resposta).toContain("Você vai excluir");
  expect(gasto("g-exato").deleted_at).toBeNull();
  expect(gasto("g-outro").deleted_at).toBeNull();
  await tap(`wa_ed:${last().nonce}:del`, "Confirmar");
  expect(gasto("g-exato").deleted_at).not.toBeNull();
  expect(gasto("g-t3").deleted_at).toBeNull();
  expect(gasto("g-outro").deleted_at).toBeNull();
});

test("duas descrições idênticas: lista as duas, seleção pelo ID real", async () => {
  resetState({ gastos: [
    g({ id: "a", descricao: "Mercado", valor: 15, data: "2026-10-01" }),
    g({ id: "b", descricao: "mercado", valor: 56, data: "2026-10-02" }),
    g({ id: "c", descricao: "Mercado Livre", valor: 80, data: "2026-10-03" }),
  ] });
  await send("editar gasto mercado de outubro de 2026");
  expect(last().stage).toBe("select");
  expect(last().cands.map((c: any) => c.id).sort()).toEqual(["a", "b"]);
  await tap(`wa_ed:${last().nonce}:sel:a`, "Mercado");
  expect(last().sel.id).toBe("a");
});

test("sem exata: parcial oferece relacionados para escolha (número)", async () => {
  testes();
  await send("excluir gasto whatsapp de outubro de 2026");
  expect(last().stage).toBe("select");
  const ids = last().cands.map((c: any) => c.id);
  expect(ids.sort()).toEqual(["g-exato", "g-t4"]);
  await send("1");
  expect(last().stage).toBe("confirm");
  expect((state.gastosData as any[]).every((x) => x.deleted_at === null)).toBe(true);
});

test("mês e tipo explícitos preservados", async () => {
  resetState({
    gastos: [g({ id: "g-set", descricao: "Salário", valor: 1, data: "2026-09-05" })],
    receitas: [rc({ id: "r-set", descricao: "Salário", valor: 3000, data: "2026-09-05" }),
      rc({ id: "r-out", descricao: "Salário", valor: 3100, data: "2026-10-05" })],
  });
  await send("Quero editar a receita salário de setembro de 2026");
  expect(last().sel.id).toBe("r-set");
});

test("restauração: exata entre excluídos; ativos não aparecem", async () => {
  resetState({ gastos: [
    g({ id: "x1", descricao: "TESTE EDICAO WHATSAPP", valor: 10, data: "2026-10-10", deleted_at: "2026-10-12T00:00:00Z" }),
    g({ id: "x2", descricao: "Teste", valor: 1, data: "2026-10-09", deleted_at: "2026-10-12T00:00:00Z" }),
    g({ id: "a1", descricao: "TESTE EDICAO WHATSAPP", valor: 10, data: "2026-10-10" }),
  ] });
  await send("restaurar o gasto TESTE EDICAO WHATSAPP");
  expect(last().sel?.id ?? last().cands?.map((c: any) => c.id)).toEqual("x1");
  expect(gasto("x1").deleted_at).not.toBeNull();
});
