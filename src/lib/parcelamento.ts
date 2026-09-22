import { validateFinancialAmount } from "./financial-limits";

/** Split only a NEW purchase total. Existing/imported individual installments are not totals.
 * Work in integer cents; distribute one extra cent to each of the first remainder installments.
 * This matches the existing card/WhatsApp server rule without changing that implementation.
 */
export function parcelasEmCentavos(valorTotal: number, quantidade: number): number[] {
  const amount = validateFinancialAmount(valorTotal);
  if (!amount.ok) throw new Error("Valor total inválido para parcelamento.");
  const cents = Math.round(amount.value * 100);
  if (!Number.isSafeInteger(cents) || !Number.isSafeInteger(quantidade) || quantidade < 1)
    throw new Error("Quantidade de parcelas inválida.");
  if (quantidade > cents)
    throw new Error("O valor total deve permitir pelo menos um centavo por parcela.");
  const base = Math.floor(cents / quantidade);
  const remainder = cents % quantidade;
  return Array.from({ length: quantidade }, (_, index) => base + (index < remainder ? 1 : 0));
}

/** Compact preview preserves the same order and amounts that will be persisted. */
export function gruposParcelas(valorTotal: number, quantidade: number) {
  try {
    const groups: { quantidade: number; valor: number }[] = [];
    for (const cents of parcelasEmCentavos(valorTotal, quantidade)) {
      const last = groups[groups.length - 1];
      if (last?.valor === cents / 100) last.quantidade++;
      else groups.push({ quantidade: 1, valor: cents / 100 });
    }
    return groups;
  } catch {
    return null;
  }
}
