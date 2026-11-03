import { parseValor } from "./whatsappParser";

/** Account baseline, never an income. No persistence or report side effects. */
export type OpeningBalanceRequest = { accountName: string | null; amountCents: number; effectiveDate: string };
export function parseOpeningBalance(text: string, date: string): OpeningBalanceRequest | null {
  const monetary = text.match(/r\$\s*\d[\d.,]*|\d[\d.,]*\s*reais/i);
  const amount = monetary ? parseValor(monetary[0]) : null;
  if (amount === null || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100))) return null;
  const account = /(?:conta\s+(?:do|da|no|na)\s+|(?:no|na)\s+)([\p{L}\d][\p{L}\d .-]*?)(?=\s+(?:como|coloque|saldo|e\s)|[,.!?]|$)/iu.exec(text);
  return { accountName: account?.[1]?.trim() ?? null, amountCents: Math.round(amount * 100), effectiveDate: date };
}
export type AccountMovement = { userId: string; accountId: string; date: string; amountCents: number; deletedAt: string | null };
export function accountBalanceCents(baseline: { userId: string; accountId: string; amountCents: number; effectiveDate: string }, movements: AccountMovement[]): number {
  return movements.filter(m => m.userId === baseline.userId && m.accountId === baseline.accountId && !m.deletedAt && m.date > baseline.effectiveDate)
    .reduce((sum, m) => sum + m.amountCents, baseline.amountCents);
}