import { parseValor } from "./whatsappParser";

/** Account baseline, never an income. No persistence or report side effects. */
export type OpeningBalanceRequest = { accountName: string | null; amountCents: number; effectiveDate: string; kind?: "current_adjustment" | "opening" };
export function parseOpeningBalance(text: string, date: string): OpeningBalanceRequest | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T12:00:00Z`).toISOString().slice(0,10) !== date) return null;
  if (/\b(não|nao|exceto|menos)\b|(?:r\$\s*-|-\s*\d)/i.test(text)) return null;
  const amounts = [...text.matchAll(/r\$\s*\d[\d.,]*|\d[\d.,]*\s*reais/gi)];
  if (amounts.length !== 1) return null;
  const monetary = amounts[0];
  const amount = monetary ? parseValor(monetary[0]) : null;
  if (amount === null || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100))) return null;
  const clause = text.split(/\be ajuste\b/iu).at(-1) ?? text;
  const accountPattern = /(?:conta\s+(?:(?:do|da|no|na)\s+)?|saldo\s+(?:do|da)\s+|(?:no|na)\s+)([\p{L}\d][\p{L}\d .-]*?)(?=\s+(?:para|como|coloque|saldo|e\s|é(?:\s|$))|[,.!?]|$)/iu;
  const account = accountPattern.exec(clause);
  const current = /(?:atualmente\s+tenho|saldo\s+atual|(?:ajust|atualiz|corrig)\w*\s+(?:(?:o\s+)?meu\s+|o\s+)?saldo)/iu.test(text);
  return { accountName: account?.[1]?.trim().replace(/^(?:do|da|no|na)\s+/iu, "") ?? null, amountCents: Math.round(amount * 100), effectiveDate: date, ...(current ? { kind: "current_adjustment" as const } : {}) };
}
export type BalanceAccount = { id: string; userId: string; name: string };
export function resolveBalanceAccount(accounts: BalanceAccount[], userId: string, name: string | null): BalanceAccount | null {
  const normalized = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  if (!name) return null;
  const matches = accounts.filter(a => a.userId === userId && normalized(a.name) === normalized(name));
  return matches.length === 1 ? matches[0] : null;
}
export type AccountMovement = { userId: string; accountId: string; date: string; amountCents: number; deletedAt: string | null };
export function accountBalanceCents(baseline: { userId: string; accountId: string; amountCents: number; effectiveDate: string }, movements: AccountMovement[]): number {
  return movements.filter(m => m.userId === baseline.userId && m.accountId === baseline.accountId && !m.deletedAt && m.date > baseline.effectiveDate)
    .reduce((sum, m) => sum + m.amountCents, baseline.amountCents);
}