import { expect, test } from "bun:test";
import { planImport, type PlanTx } from "../src/lib/pluggy/import-plan";
import { reconcileEntry, validFinancialDay } from "../src/lib/pluggy/reconciliation";
import { reclassifyForPreview, matchBatchGrant, closedBatchActions, validateGrantedActions } from "../src/lib/pluggy/real-preview";
import { classifyTransaction } from "../src/lib/pluggy/rules";
const tx: PlanTx = { transaction_id: "test", account_id: "bank", account_type: "BANK", description: "Rendimento", amount: 1, amount_original: 1, date: "2026-10-15", status: "POSTED", type: "CREDIT", operation_type: null, installment_number: null, total_installments: null, classification: "receita", classification_reason: "credito_conta", categoria_sugerida: "Rendimentos", categoria_manual: null, review_status: null, mp_match_ids: null, deleted_at: null };
const plan = (t: PlanTx) => planImport({ userId: "owner", txs: [t], cardLinks: [], categorias: [], existing: [], imported: [] })[0];
test("stable source identity survives manual edits and even a nature mismatch", () => {
  expect(reconcileEntry(tx, "receitas", [{ id: "existing", table: "gastos", valor: 9, data: "2026-01-01", descricao: "Edited", origem: "manual", id_operacao_banco: "pluggy:bank:test" }]).status).toBe("confirmada");
});
test("same value/day never confirms a duplicate, including a reconnected Pluggy source", () => {
  expect(reconcileEntry(tx, "receitas", [{ id: "other", table: "receitas", valor: 1, data: tx.date, descricao: tx.description!, origem: "pluggy" }]).status).toBe("possivel_duplicacao");
});
test("invalid dates and amounts cannot reach either new or incremental writes", () => {
  for (const t of [{ ...tx, amount: Infinity }, { ...tx, amount: NaN }, { ...tx, date: "2026-02-30" }]) expect(plan(t)).toMatchObject({ op: "review", reason: "dados_invalidos" });
  expect(validFinancialDay("2024-02-29")).toBe(true);
  expect(validFinancialDay("2026-02-29")).toBe(false);
});
test("preview preserves own-transfer evidence not available in its reduced payload", () => {
  const t = { ...tx, is_sandbox: false, classification: "ignorado" as const, classification_reason: "transferencia_mesma_titularidade" };
  expect(reclassifyForPreview(t)).toEqual(t);
});
test("partial installment metadata does not guess a bill or future installments", () => {
  for (const pair of [[1, null], [null, 2], [3, 2], [0, 2], [1.5, 3]]) {
    expect(planImport({ userId: "owner", txs: [{ ...tx, account_type: "CREDIT", classification: "gasto", type: "DEBIT", categoria_sugerida: "Contas", installment_number: pair[0], total_installments: pair[1] }], categorias: [{ id: "category", nome: "Contas" }], cardLinks: [], imported: [], existing: [] })[0]).toMatchObject({ op: "review", reason: "parcelamento_incompleto" });
  }
});
test("empty or duplicate grant sets never match a selection", () => {
  const item = { account_id: "bank", transaction_id: "test" };
  expect(matchBatchGrant([{ batch_id: "b", items: [] }], [])).toBeNull();
  expect(matchBatchGrant([{ batch_id: "b", items: [item, item] }], [item, { ...item, transaction_id: "other" }])).toBeNull();
});
test("loan principal, advances and investment redemptions remain in review", () => {
  for (const description of ["Loan principal", "Adiantamento pessoal", "Resgate de investimento", "Venda de criptomoeda"]) {
    expect(classifyTransaction({ id: "t", accountId: "a", description, amount: 100, date: tx.date, type: "CREDIT", status: "POSTED" }, "BANK").kind).toBe("revisao");
  }
});


test("real card requires bank bill and uses its due month rather than purchase month", () => {
 const input = { userId: "owner", txs: [{ ...tx, is_sandbox: false, account_type: "CREDIT" as const, type: "DEBIT" as const, amount_original: -1, classification: "gasto" as const, categoria_sugerida: "Contas" }], categorias: [{ id: "cat", nome: "Contas" }], cardLinks: [{ account_id: "bank", cartao_id: "card", dia_fechamento: 25, dia_vencimento: 5 }], imported: [], existing: [] };
 expect(planImport(input)[0]).toMatchObject({ op: "review", reason: "fatura_bancaria_nao_identificada" });
 expect(planImport({ ...input, txs: input.txs.map(t => ({ ...t, bill_id: "bill", bill_due_date: "2026-12-05" })) })[0]).toMatchObject({ op: "insert", table: "gastos", row: { cartao_id: "card", fatura_competencia: "2026-12" } });
});


test("card closed batch is independently gated and checks bank bill against authorization", () => {
 const t = { ...tx, is_sandbox: false, account_type: "CREDIT" as const, type: "DEBIT" as const, amount_original: -1, classification: "gasto" as const, categoria_sugerida: "Contas", bill_id: "bill", bill_due_date: "2026-12-05" };
 const actions = planImport({ userId: "owner", txs: [t], categorias: [{ id: "cat", nome: "Contas" }], cardLinks: [{ account_id: "bank", cartao_id: "card", dia_fechamento: 25, dia_vencimento: 5 }], imported: [], existing: [] });
 expect(closedBatchActions(actions,[t])).toHaveLength(0);
 expect(closedBatchActions(actions,[t],true)).toHaveLength(1);
 expect(closedBatchActions(actions,[t,{...t,transaction_id:"refund",classification:"revisao",classification_reason:"estorno"}],true)).toHaveLength(0);
 const grant = { account_id: "bank", transaction_id: "test", entry_table: "gastos", valor: 1, data: t.date, categoria_id: "cat", tipo: null, cartao_id: "card", bill_id: "bill", bill_due_date: "2026-12-05" };
 expect(validateGrantedActions(actions,[grant],[t])).toBe(true);
 expect(validateGrantedActions(actions,[{...grant,bill_due_date:"2026-12-06"}],[t])).toBe(false);
 expect(validateGrantedActions(actions,[{...grant,cartao_id:"other"}],[t])).toBe(false);
});

test("structured bill payment never becomes a second expense", () => { expect(classifyTransaction({id:"t",accountId:"a",description:"Banco",amount:40,type:"DEBIT",status:"POSTED",date:"2026-10-10",operationType:"PAGAMENTO_FATURA"},"CREDIT")).toMatchObject({kind:"ignorado",reason:"pagamento_de_fatura"}); });
