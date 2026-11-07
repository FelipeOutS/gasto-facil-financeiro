import { cashBalance, type CashFact } from "./financial-accounting";
export type AccountBaselineDisplay = { id: string; bancoId: string; bankName: string; amountCents: number; effectiveDate: string };
type Bank = { id: string; nome: string };
/** Complete, owner-scoped facts only. Never mix a historical baseline with a partial ledger. */
export function accountBalanceDisplay(userId: string, banks: Bank[], raw: unknown, at: string): AccountBaselineDisplay[] {
  if (!Array.isArray(raw)) throw new Error("invalid_cash_facts");
  const facts: CashFact[] = raw.map(row => {
    const cents = Number(row.amount_cents);
    if (typeof row.id !== "string" || typeof row.banco_id !== "string" || typeof row.effective_at !== "string"
      || row.user_id !== userId || !Number.isSafeInteger(cents) || !Number.isFinite(Date.parse(row.effective_at))
      || !banks.some(bank => bank.id === row.banco_id)) throw new Error("invalid_cash_fact");
    return { id: row.id, userId, bankId: row.banco_id, at: row.effective_at, cents, kind: row.kind };
  });
  return banks.flatMap(bank => {
    const present = facts.filter(f => f.bankId === bank.id && Date.parse(f.at) <= Date.parse(at));
    if (!present.length) return [];
    const latest = present.reduce((a, b) => Date.parse(a.at) > Date.parse(b.at) ? a : b);
    return [{ id: bank.id, bancoId: bank.id, bankName: bank.nome, amountCents: cashBalance(userId, bank.id, facts, at), effectiveDate: latest.at.slice(0, 10) }];
  });
}