import { describe, expect, test } from "bun:test";
import { restoreCodeOnly } from "@/lib/whatsapp-reorganizacao";
import { runReorganization, type ReorganizationStore } from "@/server/whatsapp-reorganizacao.server";
import { createReorganizationStore } from "@/server/whatsapp-reorganizacao-store.server";

const input = { userId: "A", phone: "5511999999999", externalId: "x", localDate: "2026-11-04", pendingSession: false, text: "" };

describe("restauração por código falado", () => {
  test("seis dígitos falados ou digitados", () => {
    expect(restoreCodeOnly("restaurar um dois três quatro cinco seis")).toBe("123456");
    expect(restoreCodeOnly("Restaurar 004821")).toBe("004821");
  });
  test("menos de seis dígitos ou pedido sem código não confirma", () => {
    expect(restoreCodeOnly("restaurar um dois três")).toBeNull();
    expect(restoreCodeOnly("restaurar última limpeza")).toBeNull();
  });
});

describe("prévia do zerar tudo", () => {
  const base = { status: "preview", mode: "full" as const, code: "123456", expiresAt: "x", operationId: "op", expenses: 15, incomes: 14, totalExpenses: 100, totalIncomes: 200,
    scope: { tables: ["gastos", "receitas"] as ("gastos" | "receitas")[], start: null, end: null }, card: 8, installments: 0, futureInstallments: 0, recurringEntries: 12, imported: 3, invoices: 1, payables: 13, receivables: 0, transfers: 0, recurrenceRules: 0 };
  const store = (r: object): ReorganizationStore => ({ authorize: async () => true, prepare: async () => r as never, confirm: async () => ({ status: "wrong_code" }), cancel: async () => ({ status: "cancelled" }), status: async () => ({ status: "preview" }), restore: async () => ({ status: "blocked" }) });
  const text = "GI, exclua todos os meus gastos, receitas e lançamentos financeiros. Quero zerar tudo.";
  test("total só quando nada fica de fora", async () => {
    const out = await runReorganization({ ...input, text }, store({ ...base, complete: true, leftOut: [] }));
    expect(out).toContain("Limpeza total do histórico");
    expect(out).toContain("8 compra(s) de cartão");
    expect(out).toContain("1 fatura(s)");
    expect(out).toContain("13 conta(s) a pagar");
  });
  test("com algo de fora, nunca diz total", async () => {
    const out = await runReorganization({ ...input, text }, store({ ...base, complete: false, leftOut: [{ table: "gastos", motivo: "bem", n: 1, total: 900 }] }));
    expect(out).toContain("NÃO zera todo o histórico");
    expect(out).not.toContain("Limpeza total do histórico");
  });
});

describe("roteamento do store", () => {
  test("zerar tudo usa o caminho completo só quando habilitado", async () => {
    const calls: string[] = [];
    const db = { rpc: async (name: string) => { calls.push(name); return { data: { status: "blocked" }, error: null }; } };
    const scope = { tables: ["gastos", "receitas"] as ("gastos" | "receitas")[], start: null, end: null };
    await createReorganizationStore(db).prepare(input, scope, null, "123456");
    await createReorganizationStore(db, { fullReset: true }).prepare(input, scope, null, "123456");
    expect(calls).toEqual(["wa_reorganization_prepare_v2", "wa_full_reset_prepare"]);
  });
});
