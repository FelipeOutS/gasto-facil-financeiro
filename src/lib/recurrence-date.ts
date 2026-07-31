/**
 * Datas de recorrência mensal — sem overflow de mês.
 *
 * `Date.setMonth(m + i)` transborda quando o dia-base não existe no mês
 * destino (31/01 + 1 mês => 03/03). Isso fazia séries do dia 29/30/31
 * pularem fevereiro e duplicarem março (BUG-01 do diagnóstico).
 *
 * Regras:
 * - cada ocorrência é calculada a partir da data inicial + índice do mês
 *   (nunca a partir da ocorrência ajustada anterior);
 * - se o dia-base não existir no mês destino, usa o último dia do mês;
 * - o dia-base original é preservado nos meses seguintes.
 */

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

/**
 * Retorna a data da i-ésima ocorrência mensal a partir de `base`.
 * `i = 0` retorna a própria data base.
 */
export function addMonthsPreservingDay(base: Date, i: number): Date {
  const baseDay = base.getDate();
  const totalMonths = base.getMonth() + i;
  const year = base.getFullYear() + Math.floor(totalMonths / 12);
  const monthIndex = ((totalMonths % 12) + 12) % 12;
  const day = Math.min(baseDay, daysInMonth(year, monthIndex + 1));
  return new Date(
    year,
    monthIndex,
    day,
    base.getHours(),
    base.getMinutes(),
    base.getSeconds(),
    base.getMilliseconds(),
  );
}

/** Versão ISO (YYYY-MM-DD) — entrada e saída em data local, sem UTC shift. */
export function addMonthsPreservingDayISO(baseISO: string, i: number): string {
  const [y, m, d] = baseISO.slice(0, 10).split("-").map(Number);
  const base = new Date(y!, (m! - 1), d!, 12, 0, 0, 0);
  const next = addMonthsPreservingDay(base, i);
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  return `${next.getFullYear()}-${mm}-${dd}`;
}
