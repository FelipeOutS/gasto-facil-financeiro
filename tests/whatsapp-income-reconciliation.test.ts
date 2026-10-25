import { test, expect } from "bun:test";
import { needsIncomeReconciliation } from "../src/server/whatsapp-income-reconciliation";
test.each([
  "Recebi 185 de devolução do adiantamento à minha mãe",
  "Recebi empréstimo de 1000",
  "Recebi reembolso de 45",
  "Recebi 30 de estorno",
  "Resgate de 500 do investimento",
  "Tirei 200 do cofrinho",
  "Transferência entre minhas contas de 100",
])("não classifica principal como renda: %s", (text) =>
  expect(needsIncomeReconciliation(text)).toBe(true),
);
test.each([
  "Recebi meu salário de 3500",
  "Recebi Pix de venda de 1950",
  "Recebi 10 de rendimentos",
  "Freela 150",
])("renda sem indício de principal: %s", (text) =>
  expect(needsIncomeReconciliation(text)).toBe(false),
);
