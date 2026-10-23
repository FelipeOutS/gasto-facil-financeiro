import { validFinancialDay } from "./reconciliation";
export type BankBill = {
  id: string;
  dueDate: string;
  billClosingDate?: string;
  totalAmount: number;
  totalAmountCurrencyCode: string;
  payments: {
    id: string;
    amount: number;
    currencyCode: string;
    paymentDate: string;
    valueType?: string;
  }[];
  financeCharges: { id: string; amount: number; currencyCode: string }[];
};
export const PLUGGY_SETTLEMENTS_AUTHORIZED = false as const;
export const PLUGGY_BILL_SNAPSHOTS_ENABLED = false as const;
export function confirmedBillPayment(
  previous: BankBill,
  next: BankBill,
  today: string,
): { amount: number; date: string } | null {
  const day = (s: string) => s?.slice(0, 10);
  const prev = day(previous.dueDate),
    n = day(next.dueDate);
  if (
    !validFinancialDay(prev) ||
    !validFinancialDay(n) ||
    !validFinancialDay(today) ||
    previous.id === next.id
  )
    return null;
  const monthIndex = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7));
  if (
    monthIndex(n) - monthIndex(prev) !== 1 ||
    previous.totalAmountCurrencyCode !== "BRL" ||
    next.totalAmountCurrencyCode !== "BRL" ||
    !Number.isFinite(previous.totalAmount) ||
    previous.totalAmount <= 0
  )
    return null;
  if (
    !Array.isArray(next.financeCharges) ||
    next.financeCharges.some(
      (c) => !Number.isFinite(c.amount) || c.amount !== 0 || c.currencyCode !== "BRL",
    )
  )
    return null;
  if (
    !Array.isArray(next.payments) ||
    !next.payments.length ||
    new Set(next.payments.map((p) => p.id)).size !== next.payments.length
  )
    return null;
  if (previous.billClosingDate && !validFinancialDay(day(previous.billClosingDate))) return null;
  const cents = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
  if (!cents(previous.totalAmount)) return null;
  const payments = next.payments;
  if (
    payments.some(
      (p) =>
        !p.id ||
        !Number.isFinite(p.amount) ||
        !cents(p.amount) ||
        p.amount <= 0 ||
        p.currencyCode !== "BRL" ||
        !validFinancialDay(day(p.paymentDate)) ||
        day(p.paymentDate) > today ||
        day(p.paymentDate) > n ||
        day(p.paymentDate) < (previous.billClosingDate ? day(previous.billClosingDate) : prev),
    )
  )
    return null;
  if (
    payments.reduce((sum, p) => sum + Math.round(p.amount * 100), 0) !==
    Math.round(previous.totalAmount * 100)
  )
    return null;
  return {
    amount: previous.totalAmount,
    date: payments
      .map((p) => day(p.paymentDate))
      .sort()
      .at(-1)!,
  };
}
