/** Financial facts are independent of presentation visibility. All arithmetic is integer cents. */
export type CashFact = { id: string; userId: string; bankId: string; at: string; cents: number; kind: "opening" | "income_received" | "expense_paid" | "adjustment" | "refund" | "accounting_reversal"; reversalOf?: string | null };
export function cashBalance(userId: string, bankId: string, facts: CashFact[], at: string): number {
  const cutoff = Date.parse(at);
  if (!Number.isFinite(cutoff)) throw new Error("invalid_cash_cutoff");
  const seen = new Set<string>(); let total = 0;
  for (const f of facts) {
    if (f.userId !== userId || f.bankId !== bankId) continue;
    const instant = Date.parse(f.at);
    if (!Number.isFinite(instant)) throw new Error("invalid_cash_date");
    if (instant > cutoff) continue;
    if (seen.has(f.id) || !Number.isSafeInteger(f.cents)) throw new Error("invalid_cash_fact");
    seen.add(f.id); total += f.cents;
    if (!Number.isSafeInteger(total)) throw new Error("cash_overflow");
  }
  return total;
}
export function reconcileBalance(userId: string, bankId: string, facts: CashFact[], observedCents: number, at: string) {
  if (!Number.isSafeInteger(observedCents)) throw new Error("invalid_observed_balance");
  const beforeCents = cashBalance(userId, bankId, facts, at);
  const adjustmentCents = observedCents - beforeCents;
  if (!Number.isSafeInteger(adjustmentCents)) throw new Error("cash_overflow");
  return { beforeCents, observedCents, adjustmentCents };
}
export type CardFact = { id: string; userId: string; cardId: string; cycle: string; cents: number; kind: "charge" | "payment_snapshot" | "payment" | "accounting_reversal" | "bank_refund" | "charge_refund" };
/** Hidden expense rows do not erase issuer debt or fabricate a refund. */
export function invoicePosition(userId: string, cardId: string, cycle: string, facts: CardFact[], limitCents: number) {
  if (!Number.isSafeInteger(limitCents) || limitCents < 0) throw new Error("invalid_card_limit");
  let chargedCents = 0, paidCents = 0, refundedCents = 0; const seen = new Set<string>();
  for (const f of facts) {
    if (f.userId !== userId || f.cardId !== cardId || f.cycle !== cycle) continue;
    if (!Number.isSafeInteger(f.cents) || f.cents < 0 || seen.has(f.id)) throw new Error("invalid_card_fact");
    seen.add(f.id);
    if (f.kind === "charge") chargedCents += f.cents;
    if (f.kind === "charge_refund") { chargedCents -= f.cents; refundedCents += f.cents; }
    if (f.kind === "payment" || f.kind === "payment_snapshot") paidCents += f.cents;
    if (f.kind === "accounting_reversal" || f.kind === "bank_refund") paidCents -= f.cents;
  }
  if (paidCents < 0 || chargedCents < 0) throw new Error("invalid_reversal");
  const pendingCents = Math.max(0, chargedCents - paidCents);
  return { chargedCents, paidCents, refundedCents, pendingCents, creditCents: Math.max(0, paidCents - chargedCents), availableCents: Math.max(0, limitCents - pendingCents) };
}