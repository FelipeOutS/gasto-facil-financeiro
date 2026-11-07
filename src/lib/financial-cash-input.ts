/** Explicit bank + actual paid/received instant; competence is never a cash date. */
export type FinancialCashInput = { financialBankId?: string; cashEffectiveAt?: string };
export function financialCashColumns(input: FinancialCashInput, options: { credit?: boolean; generated?: boolean } = {}) {
  const bank = input.financialBankId;
  const at = input.cashEffectiveAt;
  if (!bank && !at) return {};
  if (!bank || !at || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bank)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(at) || !Number.isFinite(Date.parse(at))) {
    throw new Error("Informe uma conta válida e o momento do pagamento ou recebimento.");
  }
  const datePart=at.slice(0,10);
  if(new Date(datePart+"T00:00:00Z").toISOString().slice(0,10)!==datePart) throw new Error("Data de pagamento ou recebimento inválida.");
  if (options.credit) throw new Error("Compra no crédito não é pagamento bancário.");
  if (options.generated) throw new Error("Confirme cada pagamento ou recebimento separadamente; não replique o saldo nas parcelas ou recorrências.");
  return { financial_bank_id: bank, cash_effective_at: new Date(at).toISOString() };
}