import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { groupByOrigin } from "@/lib/pluggy/origin-groups";
import { classifyTransaction } from "@/lib/pluggy/rules";

const items = [
  { item_id: "sb", connector_name: "Pluggy Bank", is_sandbox: true },
  { item_id: "mp", connector_name: "Mercado Pago", is_sandbox: false },
];

describe("Separação Pluggy Bank (fictício) x Mercado Pago (real)", () => {
  it("nunca mistura as duas origens no mesmo grupo", () => {
    const g = groupByOrigin(items, [
      { item_id: "sb", is_sandbox: true, classification: "gasto" },
      { item_id: "mp", is_sandbox: false, classification: "gasto" },
      { item_id: "mp", is_sandbox: false, classification: "receita" },
    ]);
    expect(g.map((x) => [x.institution, x.sandbox, x.gastos.length, x.receitas.length])).toEqual([
      ["Mercado Pago", false, 1, 1],
      ["Pluggy Bank", true, 1, 0],
    ]);
  });

  it("movimentação sem prova de ser fictícia é tratada como real", () => {
    const g = groupByOrigin(items, [{ item_id: "mp", is_sandbox: true, classification: "gasto" }, { item_id: null, is_sandbox: null, classification: "gasto" }]);
    expect(g.every((x) => x.sandbox === false)).toBe(true);
  });

  it("revisão já decidida pelo usuário não volta para a fila", () => {
    const g = groupByOrigin(items, [{ item_id: "mp", is_sandbox: false, classification: "revisao", review_status: "aprovado" }]);
    expect(g[0].revisao.length).toBe(0);
  });

  it("prévia de importação usa somente movimentações fictícias", () => {
    const src = readFileSync("src/server/pluggy/pluggy-import-store.server.ts", "utf8");
    expect(src).toContain("t.is_sandbox === true");
    expect(src).toContain("a.is_sandbox === true");
  });

  it("reserva do próprio titular é ignorada, não gasto nem receita", () => {
    for (const [description, type] of [["Reserva por gastos Comprar play 5", "DEBIT"], ["Dinheiro retirado Comprar play 5", "CREDIT"]] as const) {
      const c = classifyTransaction({ id: "1", description, amount: 10, date: "2026-10-01", type, status: "POSTED", operationType: "TRANSFERENCIA_SALDO_RESERVADO" } as never, "BANK");
      expect(c).toEqual({ kind: "ignorado", reason: "movimentacao_reserva_propria" });
    }
  });

  it("depósito e parcela de empréstimo vão para revisão", () => {
    for (const [description, type] of [["Depósito do Empréstimo Pessoal", "CREDIT"], ["Pagamento de parcela Empréstimos Mercado Pago", "DEBIT"]] as const) {
      const c = classifyTransaction({ id: "1", description, amount: 10, date: "2026-10-01", type, status: "POSTED", operationType: "OUTROS" } as never, "BANK");
      expect(c).toEqual({ kind: "revisao", reason: "emprestimo" });
    }
  });
});
