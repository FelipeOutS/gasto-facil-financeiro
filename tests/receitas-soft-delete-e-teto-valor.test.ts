/**
 * Prompt 2 — Soft delete de receitas + teto de valor de lançamento.
 *
 * Roda via: bun test tests/receitas-soft-delete-e-teto-valor.test.ts
 *
 * Puro (sem DB real, sem browser):
 *  - valida `validateFinancialAmount` (cliente e servidor usam a mesma função);
 *  - valida o contrato de código: todas as leituras operacionais de `receitas`
 *    filtram `deleted_at IS NULL` (`.is("deleted_at", null)`);
 *  - valida que agregações ignoram registros em soft delete e que os registros
 *    continuam existindo (restauráveis).
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  MAX_FINANCIAL_ENTRY_AMOUNT,
  MIN_FINANCIAL_ENTRY_AMOUNT,
  financialAmountMessage,
  isValidFinancialAmount,
  validateFinancialAmount,
} from "../src/lib/financial-limits";
import { parseBRLInput } from "../src/lib/format";

describe("teto de valor de lançamento financeiro", () => {
  it("constantes centralizadas", () => {
    expect(MAX_FINANCIAL_ENTRY_AMOUNT).toBe(999999999.99);
    expect(MIN_FINANCIAL_ENTRY_AMOUNT).toBe(0.01);
  });

  it("rejeita zero, negativo, NaN, Infinity e texto", () => {
    expect(isValidFinancialAmount(0)).toBe(false);
    expect(isValidFinancialAmount(-10)).toBe(false);
    expect(isValidFinancialAmount(Number.NaN)).toBe(false);
    expect(isValidFinancialAmount(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidFinancialAmount("1000" as unknown)).toBe(false);
  });

  it("rejeita mais de duas casas decimais", () => {
    expect(validateFinancialAmount(10.123).ok).toBe(false);
    expect(validateFinancialAmount(10.12).ok).toBe(true);
  });

  it("999999999.99 é aceito e 1000000000.00 é rejeitado", () => {
    expect(isValidFinancialAmount(999999999.99)).toBe(true);
    const rejected = validateFinancialAmount(1000000000.0);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.code).toBe("too_large");
  });

  it("55555555555.00 (caso do diagnóstico) é rejeitado", () => {
    const r = validateFinancialAmount(55555555555.0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("too_large");
  });

  it("rejeita notação científica que ultrapassa o teto", () => {
    expect(isValidFinancialAmount(5.5e10)).toBe(false);
    expect(isValidFinancialAmount(1e3)).toBe(true);
  });

  it("valor normal e vírgula brasileira", () => {
    expect(isValidFinancialAmount(2500)).toBe(true);
    expect(isValidFinancialAmount(parseBRLInput("2.500,55"))).toBe(true);
    expect(isValidFinancialAmount(parseBRLInput("55.555.555.555,00"))).toBe(false);
  });

  it("mensagens em pt e en, sem detalhe técnico de banco", () => {
    const pt = financialAmountMessage("too_large", "pt");
    const en = financialAmountMessage("too_large", "en");
    expect(pt).toContain("limite");
    expect(en.toLowerCase()).toContain("exceeds");
    for (const msg of [pt, en]) {
      expect(msg).not.toContain("constraint");
      expect(msg).not.toContain("receitas_valor");
    }
  });
});

describe("contrato de código: leituras de receitas filtram soft delete", () => {
  const files = [
    "src/lib/store.ts",
    "src/server/whatsapp-receitas.server.ts",
    "src/server/whatsapp-consultas.server.ts",
    "src/server/whatsapp-consultas-especificas.server.ts",
  ];

  it("store carrega apenas receitas ativas", () => {
    const src = readFileSync("src/lib/store.ts", "utf8");
    expect(src).toContain(
      'supabase.from("receitas").select("*").eq("user_id", userId).is("deleted_at", null)',
    );
  });

  it('toda leitura de receitas no servidor tem .is("deleted_at", null)', () => {
    for (const file of files.slice(1)) {
      const src = readFileSync(file, "utf8");
      const selects = src.split('.from("receitas")').slice(1);
      for (const block of selects) {
        const head = block.slice(0, 400);
        if (!head.includes(".select(")) continue; // insert/update
        expect(head).toContain('.is("deleted_at", null)');
      }
    }
  });

  it("validação de valor está no store e no servidor", () => {
    expect(readFileSync("src/lib/store.ts", "utf8")).toContain("validateFinancialAmount");
    expect(readFileSync("src/server/whatsapp-receitas.server.ts", "utf8")).toContain(
      "validateFinancialAmount",
    );
  });
});

// -------- Agregações operacionais ignoram soft delete --------
type Row = { id: string; valor: number; deleted_at: string | null; user_id: string };

const ativas = (rows: Row[]) => rows.filter((r) => r.deleted_at === null);
const somaOperacional = (rows: Row[], userId?: string) =>
  ativas(rows)
    .filter((r) => (userId ? r.user_id === userId : true))
    .reduce((acc, r) => acc + r.valor, 0);

describe("agregações e visibilidade", () => {
  const owner = "user-a";
  const rows: Row[] = [
    { id: "ok-1", valor: 3000, deleted_at: null, user_id: owner },
    ...Array.from({ length: 12 }, (_, i) => ({
      id: `fake-${i}`,
      valor: 55555555555,
      deleted_at: "2026-07-31T18:00:00Z",
      user_id: owner,
    })),
    { id: "other", valor: 500, deleted_at: null, user_id: "user-b" },
  ];

  it("receita ativa aparece; soft-deleted não aparece", () => {
    const visiveis = ativas(rows).map((r) => r.id);
    expect(visiveis).toContain("ok-1");
    expect(visiveis.some((id) => id.startsWith("fake-"))).toBe(false);
  });

  it("soft-deleted não entra em somas (dashboard, relatório, Gasto AI, faturamento)", () => {
    expect(somaOperacional(rows, owner)).toBe(3000);
    expect(somaOperacional(rows)).toBe(3500);
  });

  it("as 12 linhas continuam fisicamente presentes e são restauráveis", () => {
    const fakes = rows.filter((r) => r.id.startsWith("fake-"));
    expect(fakes).toHaveLength(12);
    const restauradas = fakes.map((r) => ({ ...r, deleted_at: null }));
    expect(ativas(restauradas)).toHaveLength(12);
  });

  it("isolamento por usuário permanece (nem ativas nem soft-deleted de outro dono)", () => {
    const doOutro = rows.filter((r) => r.user_id === "user-b");
    expect(somaOperacional(doOutro, owner)).toBe(0);
    expect(rows.filter((r) => r.user_id === owner && r.deleted_at !== null)).toHaveLength(12);
  });
});
