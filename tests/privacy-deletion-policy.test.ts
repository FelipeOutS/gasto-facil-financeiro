import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  classifyRpcError,
  computeBlockers,
  isConfirmedResult,
  userMessage,
  validateSelections,
  type DependencyFacts,
} from "../src/lib/privacy-deletion-policy";

const none: DependencyFacts = {
  pluggyEntriesOnBatches: 0,
  pluggyEntriesOnGastos: 0,
  pluggyEntriesOnReceitas: 0,
  gastosComBem: 0,
  gastosComCartao: 0,
  faturas: 0,
  lancamentosComRecorrencia: 0,
};
const sel = (category: string, scope = "all") => {
  const v = validateSelections([{ category, scope }]);
  if (!v.ok) throw new Error("invalid");
  return v.selections;
};

test("rejeita categoria, escopo, duplicata e lista vazia", () => {
  expect(validateSelections([]).ok).toBe(false);
  expect(validateSelections([{ category: "profiles", scope: "all" }]).ok).toBe(false);
  expect(validateSelections([{ category: "payables", scope: "tudo" }]).ok).toBe(false);
  expect(validateSelections([{ category: "expenses", scope: "paid" }]).ok).toBe(false);
  expect(validateSelections([{ category: "income", scope: "all" }, { category: "income", scope: "all" }]).ok).toBe(false);
  expect(validateSelections([{ category: "payables", scope: "paid" }]).ok).toBe(true);
});

test("importações com lançamento Pluggy ficam bloqueadas (FK RESTRICT)", () => {
  const b = computeBlockers(sel("imports"), { ...none, pluggyEntriesOnBatches: 1 });
  expect(b.map((x) => x.code)).toEqual(["imports_pluggy_linked"]);
  expect(b[0].count).toBe(1);
});

test("gastos ligados a bens, cartão ou Pluggy ficam bloqueados", () => {
  const b = computeBlockers(sel("expenses"), { ...none, gastosComBem: 2, gastosComCartao: 3, pluggyEntriesOnGastos: 1 });
  expect(b.map((x) => x.code).sort()).toEqual(["expenses_bens_linked", "expenses_card_linked", "expenses_pluggy_linked"]);
});

test("cartões com fatura ou compras ficam bloqueados", () => {
  expect(computeBlockers(sel("cards"), { ...none, faturas: 1 })[0].code).toBe("cards_invoice_linked");
  expect(computeBlockers(sel("cards"), { ...none, gastosComCartao: 1 })[0].count).toBe(1);
});

test("receitas Pluggy e recorrências com lançamentos ficam bloqueadas", () => {
  expect(computeBlockers(sel("income"), { ...none, pluggyEntriesOnReceitas: 1 })[0].code).toBe("income_pluggy_linked");
  expect(computeBlockers(sel("subscriptions"), { ...none, lancamentosComRecorrencia: 4 })[0].count).toBe(4);
});

test("sem vínculos ou categoria sem vínculo financeiro não bloqueia", () => {
  expect(computeBlockers(sel("imports"), none)).toEqual([]);
  expect(computeBlockers(sel("market"), { ...none, faturas: 9, pluggyEntriesOnBatches: 9 })).toEqual([]);
});

test("erro de vínculo do banco vira dependency_conflict sem expor texto", () => {
  expect(classifyRpcError({ code: "23503", message: "violates foreign key pluggy_import_entries_batch_id_fkey" })).toBe("dependency_conflict");
  expect(classifyRpcError({ code: "P0001", message: "Unauthorized: User ID mismatch" })).toBe("not_authorized");
  expect(classifyRpcError({ code: "XX000", message: "boom" })).toBe("unknown");
  const m = userMessage("dependency_conflict", "ab12cd34");
  expect(m).toContain("ref ab12cd34");
  expect(m).toContain("Nada foi excluído");
  expect(m).not.toContain("pluggy_import_entries");
});

test("sucesso só com número para cada categoria pedida", () => {
  const s = [...sel("expenses"), ...sel("income")];
  expect(isConfirmedResult({ expenses: 3, income: 0 }, s)).toBe(true);
  expect(isConfirmedResult({ expenses: 3 }, s)).toBe(false);
  expect(isConfirmedResult(null, s)).toBe(false);
  expect(isConfirmedResult([1, 2], s)).toBe(false);
});

test("servidor chama o RPC com o cliente do usuário e revalida vínculos antes", () => {
  const src = readFileSync("src/lib/privacy.functions.ts", "utf8");
  expect(src).not.toMatch(/supabaseAdmin\.rpc\(\s*"execute_data_deletion_atomic"/);
  expect(src).toMatch(/supabase\.rpc\(\s*"execute_data_deletion_atomic"/);
  const exec = src.slice(src.indexOf("export const executeDataDeletion"));
  expect(exec.indexOf("computeBlockers")).toBeGreaterThan(-1);
  expect(exec.indexOf("computeBlockers")).toBeLessThan(exec.indexOf("execute_data_deletion_atomic"));
  expect(src).not.toMatch(/console\.error\([^)]*error\.message/);
});
