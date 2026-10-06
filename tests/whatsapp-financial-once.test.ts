import { test, expect } from "bun:test";
import { resetState, state, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();
const { persistirGasto } = await import("../src/server/whatsapp.server");
const { persistirReceita } = await import("../src/server/whatsapp-receitas.server");
const { financialIdForWhatsAppMessage } = await import("../src/server/whatsapp-financial-idempotency.server");

const expense = {
  nome: "Padaria",
  valor: 25,
  data: "2026-10-04",
  formaPagamento: "debito",
  mensagemOriginal: "Padaria 25",
};
const income = {
  kind: "receita",
  tipo: "salario",
  tipoLabel: "Salário",
  descricao: "Salário",
  valor: 3500,
  data: "2026-10-04",
  recorrente: false,
  mensagemOriginal: "Recebi 3500 de salário",
};

test("gasto simples: dois workers e duplo Confirmar gravam uma linha por sessão", async () => {
  resetState();
  const [a, b] = await Promise.all([
    persistirGasto("u1", expense as never, "wamid-a", "session-expense-1"),
    persistirGasto("u1", expense as never, "wamid-b", "session-expense-1"),
  ]);
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  expect(a.gastoId).toBe(b.gastoId);
  expect(state.gastosData).toHaveLength(1);
  expect((await persistirGasto("u1", expense as never, "wamid-a", "session-expense-1")).gastoId).toBe(a.gastoId);
  expect(state.gastosData).toHaveLength(1);
});

test("receita simples: dois workers e retry após commit gravam uma linha", async () => {
  resetState();
  const [a, b] = await Promise.all([
    persistirReceita("u1", income as never, "wamid-a", "session-income-1"),
    persistirReceita("u1", income as never, "wamid-b", "session-income-1"),
  ]);
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  expect(a.receitaId).toBe(b.receitaId);
  expect(state.receitasData).toHaveLength(1);
  expect((await persistirReceita("u1", income as never, "wamid-a", "session-income-1")).receitaId).toBe(a.receitaId);
  expect(state.receitasData).toHaveLength(1);
});

test("falha antes do commit não bloqueia retry de gasto e receita", async () => {
  resetState();
  state.failNextFinancialInsert = "gastos";
  expect((await persistirGasto("u1", expense as never, "wamid-fail-expense")).ok).toBe(false);
  expect(state.gastosData).toHaveLength(0);
  expect((await persistirGasto("u1", expense as never, "wamid-fail-expense")).ok).toBe(true);
  expect(state.gastosData).toHaveLength(1);
  state.failNextFinancialInsert = "receitas";
  expect((await persistirReceita("u1", income as never, "wamid-fail-income")).ok).toBe(false);
  expect(state.receitasData).toHaveLength(0);
  expect((await persistirReceita("u1", income as never, "wamid-fail-income")).ok).toBe(true);
  expect(state.receitasData).toHaveLength(1);
});

test("IDs financeiros separam usuário, tipo e mensagem e são determinísticos após reinício", async () => {
  const first = financialIdForWhatsAppMessage("u1", "wamid-a", "expense");
  const ids = new Set([
    first,
    financialIdForWhatsAppMessage("u2", "wamid-a", "expense"),
    financialIdForWhatsAppMessage("u1", "wamid-a", "income_single"),
    financialIdForWhatsAppMessage("u1", "wamid-b", "expense"),
  ]);
  expect(ids.size).toBe(4);
  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const child = Bun.spawn({
    cmd: [process.execPath, "-e", "import { financialIdForWhatsAppMessage as id } from './src/server/whatsapp-financial-idempotency.server.ts'; console.log(id('u1','wamid-a','expense'))"],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(child.stdout).text();
  expect(await child.exited).toBe(0);
  expect(output.trim()).toBe(first);
});
