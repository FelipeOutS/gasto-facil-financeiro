/** Principal movements need reconciliation; never infer disposable income. */
export function needsIncomeReconciliation(text: string): boolean {
  const s = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    /\b(emprestimo|emprestado|emprestei|adiantamento|estorno|reembolso|cofrinho|resgate|devolucao)\b/.test(
      s,
    ) ||
    /\btransfer(?:encia|i|ido|indo)\b.*\b(minhas? contas?|conta propria|entre contas|mesmo titular)\b/.test(
      s,
    )
  );
}
export const INCOME_RECONCILIATION_REPLY =
  "Esse valor pode ser uma transferência, devolução ou principal de empréstimo/investimento. Não vou lançá-lo automaticamente como renda ou despesa de consumo. Confira a origem e concilie a movimentação no app; adiantamentos devem ser vinculados a Contas a Receber com os dados confirmados.";
