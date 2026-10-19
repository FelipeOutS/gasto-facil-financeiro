import { describe, expect, it } from "bun:test";
import { classifyTransaction } from "@/lib/pluggy/rules";
import { canUseRealPreview, firstBatchActions, realPreviewWindow, reclassifyForPreview, selectRealTxs, type RealTxRow } from "@/lib/pluggy/real-preview";
import { planImport } from "@/lib/pluggy/import-plan";

const FELIPE = "3324b9f8-ea68-465c-8e1e-ab1cc8caebf1";
const MICHAEL = "47df50ce-df1e-4c54-8fae-0ffb5105478d";

function tx(p: Partial<RealTxRow>): RealTxRow {
  return { transaction_id: "t1", account_id: "a1", account_type: "BANK", description: "Padaria", amount: 10, amount_original: -10, date: "2026-10-10", status: "POSTED", type: "DEBIT", operation_type: null, installment_number: null, total_installments: null, classification: "gasto", classification_reason: "debito_conta", categoria_sugerida: "Alimentação", categoria_manual: null, review_status: null, mp_match_ids: null, deleted_at: null, is_sandbox: false, pluggy_category: "Bakery", ...p };
}

describe("estorno nunca vira gasto", () => {
  it("estorno de cartão (operationType ESTORNO, valor negativo) vai para revisão", () => {
    expect(classifyTransaction({ id: "x", accountId: "c", description: "Shopee*SHOPEE*NETSOFS", amount: -1069.99, date: "2025-11-13", type: "CREDIT", status: "POSTED", category: "Online shopping", operationType: "ESTORNO" }, "CREDIT")).toEqual({ kind: "revisao", reason: "estorno" });
  });
  it("transferência cancelada não é receita", () => {
    expect(classifyTransaction({ id: "x", accountId: "b", description: "Transferência cancelada UBER DO BRASIL", amount: 12.93, date: "2025-12-14", type: "CREDIT", status: "POSTED", category: "Taxi and ride-hailing", operationType: "OUTROS" }, "BANK").kind).toBe("revisao");
  });
  it("rendimentos continuam receita Rendimentos, não salário", () => {
    const r = reclassifyForPreview(tx({ type: "CREDIT", amount: 0.5, amount_original: 0.5, description: "Rendimentos", operation_type: "RESGATE_APLIC_FINANCEIRA", pluggy_category: "Proceeds interests and dividends" }));
    expect([r.classification, r.categoria_sugerida]).toEqual(["receita", "Rendimentos"]);
  });
  it("venda de Meli Dólar fica em revisão", () => {
    expect(reclassifyForPreview(tx({ type: "CREDIT", amount: 7.15, amount_original: 7.15, description: "Venda de Meli Dólar MUSD 1,3", operation_type: "RESGATE_APLIC_FINANCEIRA" })).classification).toBe("revisao");
  });
  it("preserva decisão manual", () => {
    expect(reclassifyForPreview(tx({ review_status: "rejeitado", categoria_manual: "Lazer" }))).toMatchObject({ review_status: "rejeitado", categoria_manual: "Lazer" });
  });
});

describe("prévia real", () => {
  it("só Felipe com owner", () => {
    expect(canUseRealPreview(FELIPE, ["owner"])).toBe(true);
    expect(canUseRealPreview(MICHAEL, ["owner"])).toBe(false);
    expect(canUseRealPreview(FELIPE, ["admin"])).toBe(false);
  });
  it("janela de exatamente 7 dias", () => {
    expect(realPreviewWindow("2026-10-01")).toEqual({ from: "2026-10-01", to: "2026-10-07" });
    expect(() => realPreviewWindow("2026-02-30")).toThrow();
  });
  it("exclui Sandbox, outros conectores e datas fora da janela", () => {
    const items = [{ item_id: "i1", is_sandbox: false, connector_id: 606 }, { item_id: "i2", is_sandbox: false, connector_id: 206 }, { item_id: "s", is_sandbox: true, connector_id: 0 }];
    const accounts = [{ account_id: "a1", item_id: "i1", type: "BANK", is_sandbox: false }, { account_id: "a2", item_id: "i2", type: "BANK", is_sandbox: false }, { account_id: "a3", item_id: "s", type: "BANK", is_sandbox: true }];
    const r = selectRealTxs(items, accounts, [tx({}), tx({ account_id: "a2", transaction_id: "t2" }), tx({ account_id: "a3", transaction_id: "t3", is_sandbox: true }), tx({ transaction_id: "t4", date: "2026-10-20" })], { from: "2026-10-05", to: "2026-10-11" });
    expect(r.map((t) => t.transaction_id)).toEqual(["t1"]);
  });
  it("primeiro lote exclui cartão e duplicações suspeitas", () => {
    const txs = [tx({}), tx({ transaction_id: "c1", account_id: "card", account_type: "CREDIT" }), tx({ transaction_id: "d1", mp_match_ids: ["mp1"] })];
    const actions = planImport({ userId: FELIPE, txs, cardLinks: [], categorias: [{ id: "c", nome: "Alimentação" }], imported: [], existing: [] });
    expect(firstBatchActions(actions, txs).map((a) => a.transaction_id)).toEqual(["t1"]);
  });
  it("gasto estornado no mesmo período fica fora do primeiro lote", () => {
    const txs = [tx({ transaction_id: "u1", amount: 38.94 }), tx({ transaction_id: "r1", type: "CREDIT", amount: 38.94, amount_original: 38.94, classification: "revisao", classification_reason: "estorno" })];
    const actions = planImport({ userId: FELIPE, txs, cardLinks: [], categorias: [{ id: "c", nome: "Alimentação" }], imported: [], existing: [] });
    expect(firstBatchActions(actions, txs)).toEqual([]);
  });
});
