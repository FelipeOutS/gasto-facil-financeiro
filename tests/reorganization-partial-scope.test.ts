import { test, expect } from "bun:test";
import { runReorganization, type ReorganizationStore } from "../src/server/whatsapp-reorganizacao.server";
import { createReorganizationStore } from "../src/server/whatsapp-reorganizacao-store.server";

const input = { userId: "A", phone: "5511999999999", externalId: "audio-1", localDate: "2026-11-03", pendingSession: false,
  text: "GI, exclua todas as minhas despesas e receitas dos meses anteriores, mantenha o mês atual e ajuste o saldo do Nubank para R$ 5.000." };
const leftOut = [{ table: "gastos" as const, motivo: "parcelado", n: 2, total: 600 }, { table: "gastos" as const, motivo: "cartao", n: 1, total: 89.9 }];
const base = (over: Partial<ReorganizationStore> = {}): ReorganizationStore => ({
  authorize: async () => true,
  prepare: async (_i, scope, income, code, balance) => ({ status: "preview", operationId: "11111111-1111-1111-1111-111111111111", code, expiresAt: "2026-11-03T12:05:00Z",
    scope, income, openingBalance: balance, expenses: 10, incomes: 2, totalExpenses: 1500, totalIncomes: 3000, cashBeforeCents: 320000, cashAdjustmentCents: 180000, leftOut }),
  confirm: async () => ({ status: "applied", operationId: "11111111-1111-1111-1111-111111111111", expenses: 10, incomes: 2, balanceId: "b", leftOut }),
  cancel: async () => ({ status: "cancelled" }), status: async () => ({ status: "applied" }), restore: async () => ({ status: "blocked" }), ...over,
});

test("prévia do comando completo mostra excluídos, os que ficam de fora com valores, e o ajuste do Nubank", async () => {
  const r = String(await runReorganization(input, base()));
  expect(r).toContain("10 gastos (R$ 1.500,00) e 2 receitas (R$ 3.000,00)");
  expect(r).toContain("até 2026-11-01 (não incluído)");
  expect(r).toContain("limpeza parcial");
  expect(r).toContain("2 gasto(s) parcelados: R$ 600,00");
  expect(r).toContain("1 gasto(s) de cartão/fatura: R$ 89,90");
  expect(r).toContain("Nubank, R$ 5.000,00");
  expect(r).toContain("ajuste R$ 1.800,00");
  expect(r).toContain("Nada foi alterado");
});

test("resultado parcial nunca é anunciado como limpeza completa", async () => {
  const r = String(await runReorganization({ ...input, text: "APAGAR 11111111-1111-1111-1111-111111111111 123456" }, base()));
  expect(r).toContain("aplicada parcialmente");
  expect(r).not.toContain("Reorganização concluída");
  expect(r).toContain("3 lançamento(s) do período continuam ativos");
});

test("sem nada elegível, responde explicitamente e não grava", async () => {
  const r = String(await runReorganization(input, base({ prepare: async () => ({ status: "nothing_eligible", leftOut }) })));
  expect(r).toContain("Nada foi alterado");
  expect(r).toContain("parcelados");
});

test("store usa as RPCs de escopo parcial e rejeita leftOut malformado", async () => {
  const calls: string[] = [];
  const store = createReorganizationStore({ rpc: async (name) => { calls.push(name); return { data: { status: "preview", expenses: 1, incomes: 0, leftOut: "x" }, error: null }; } });
  await expect(store.prepare(input, { tables: ["gastos"], start: null, end: "2026-11-01" }, null, "123456")).rejects.toThrow("invalid_reorganization_left_out");
  expect(calls).toEqual(["wa_reorganization_prepare_v2"]);
});
