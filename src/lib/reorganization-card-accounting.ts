import { competenciaDoGasto, cicloParaCompetencia } from "./fatura-competencia";

export type CardAccountingPurchase = { id: string; userId: string; cartaoId: string; valor: number; data: string; fatura_competencia?: string | null; invoice_month?: string | null; deletedAt: string | null };
export type CardAccountingCard = { id: string; userId: string; closingDay: number; dueDay: number; limit: number };
export type CardAccountingInvoice = { userId: string; cartaoId: string; month: number; year: number; status: string; paidAmount: number; paidDate: string | null };
/** Derived estimates mirror existing purchase accounting; payment rows are never rewritten. */
export function previewCardRemoval(userId: string, card: CardAccountingCard, competence: string, purchases: CardAccountingPurchase[], invoices: CardAccountingInvoice[], ids: string[]) {
  if (card.userId !== userId || new Set(ids).size !== ids.length || !ids.length) throw new Error("invalid_card_scope");
  const invoice = invoices.filter(f => f.userId === userId && f.cartaoId === card.id && cicloParaCompetencia(`${f.year}-${String(f.month).padStart(2,"0")}`,card.closingDay,card.dueDay) === competence);
  if (invoice.length > 1 || invoice.some(f => !["aberta","fechada","vencida"].includes(f.status) || f.paidAmount !== 0 || f.paidDate)) throw new Error("paid_or_partial_invoice_requires_ledger");
  const active = purchases.filter(g => g.userId === userId && g.cartaoId === card.id && !g.deletedAt && competenciaDoGasto(g,card.closingDay,card.dueDay) === competence);
  if (ids.some(id => !active.some(g => g.id === id))) throw new Error("invalid_purchase_scope");
  const cents = (n: number) => { const c = Math.round(n*100); if (!Number.isSafeInteger(c) || c<0) throw new Error("invalid_card_amount"); return c; };
  const beforeCents = active.reduce((s,g) => s+cents(g.valor),0);
  const removedCents = active.filter(g => ids.includes(g.id)).reduce((s,g)=>s+cents(g.valor),0);
  return { beforeCents, afterCents: beforeCents-removedCents, availableCents: Math.max(0,cents(card.limit)-beforeCents+removedCents), removedCents };
}