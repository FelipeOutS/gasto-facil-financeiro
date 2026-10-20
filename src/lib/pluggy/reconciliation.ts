/** Pure reconciliation. A date/amount match is evidence for review, never proof. */
export type ReconciliationEntry = {
  table: "gastos" | "receitas"; id: string; valor: number; data: string;
  descricao: string; origem: string | null; id_operacao_banco?: string | null;
};
export type ReconciliationResult =
  | { status: "nova"; matches: string[] }
  | { status: "confirmada" | "possivel_duplicacao"; matches: string[] };

export function validFinancialDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const time = Date.parse(day + "T12:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day;
}

export function reconcileEntry(
  tx: { account_id: string; transaction_id: string; amount: number; date: string },
  table: "gastos" | "receitas", entries: readonly ReconciliationEntry[],
): ReconciliationResult {
  const source = `pluggy:${tx.account_id}:${tx.transaction_id}`;
  // A stable source identity blocks a second entry even if its amount/date was edited.
  const exact = entries.filter(e => e.id_operacao_banco === source);
  if (exact.length) return { status: "confirmada", matches: exact.map(e => e.id) };
  const day = Date.parse(tx.date + "T12:00:00Z");
  const possible = entries.filter(e => e.table === table &&
    Math.round(Math.abs(e.valor) * 100) === Math.round(tx.amount * 100) &&
    Math.abs(Date.parse(e.data + "T12:00:00Z") - day) <= 86400000);
  return { status: possible.length ? "possivel_duplicacao" : "nova", matches: possible.map(e => e.id) };
}
