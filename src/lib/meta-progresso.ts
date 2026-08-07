/**
 * Percentual de progresso de uma meta financeira (apresentação).
 *
 * Regra: acumulado / objetivo * 100, limitado ao teto visual de 100%.
 * Objetivo <= 0, null/undefined ou valores inválidos => 0 (fallback seguro).
 *
 * ATENÇÃO: o denominador é SEMPRE o valor objetivo da meta. Usar o próprio
 * acumulado como denominador (bug histórico do Dashboard) produzia 100% fixo.
 */
export function pctMeta(
  acumulado: number | null | undefined,
  objetivo: number | null | undefined,
): number {
  const a = Number(acumulado);
  const o = Number(objetivo);
  if (!Number.isFinite(a) || !Number.isFinite(o) || o <= 0 || a <= 0) return 0;
  return Math.min(100, (a / o) * 100);
}
