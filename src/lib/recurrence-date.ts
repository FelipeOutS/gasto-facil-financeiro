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
  const base = new Date(y!, m! - 1, d!, 12, 0, 0, 0);
  const next = addMonthsPreservingDay(base, i);
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  return `${next.getFullYear()}-${mm}-${dd}`;
}

/* ------------------------------------------------------------------ *
 * Recorrência flexível — "a cada X períodos"
 *
 * O intervalo (a cada quanto acontece) é independente da duração
 * (quantas ocorrências / até quando). Nada aqui é hardcoded para
 * intervalos específicos: `interval` é qualquer inteiro >= 1.
 * ------------------------------------------------------------------ */

export const RECURRENCE_UNITS = ["dia", "semana", "mes", "ano"] as const;
export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];

export function isRecurrenceUnit(v: unknown): v is RecurrenceUnit {
  return typeof v === "string" && (RECURRENCE_UNITS as readonly string[]).includes(v);
}

export type RecurrenceRule = {
  /** A cada quantas unidades. Inteiro >= 1. */
  interval: number;
  unit: RecurrenceUnit;
};

export function normalizeRule(rule?: Partial<RecurrenceRule> | null): RecurrenceRule {
  const interval = Math.max(1, Math.floor(Number(rule?.interval ?? 1) || 1));
  const unit = isRecurrenceUnit(rule?.unit) ? rule.unit : "mes";
  return { interval, unit };
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * i-ésima ocorrência (i = 0 é a data base) para qualquer intervalo/unidade.
 * Meses e anos usam clamp para o último dia do mês, preservando o dia-base
 * original nas ocorrências seguintes (31/01 → 28/02 → 31/03).
 */
export function occurrenceDate(base: Date, i: number, rule?: Partial<RecurrenceRule>): Date {
  const { interval, unit } = normalizeRule(rule);
  const step = interval * i;
  switch (unit) {
    case "dia":
      return addDays(base, step);
    case "semana":
      return addDays(base, step * 7);
    case "ano":
      return addMonthsPreservingDay(base, step * 12);
    case "mes":
    default:
      return addMonthsPreservingDay(base, step);
  }
}

/** Versão ISO local (YYYY-MM-DD). */
export function occurrenceDateISO(
  baseISO: string,
  i: number,
  rule?: Partial<RecurrenceRule>,
): string {
  const [y, m, d] = baseISO.slice(0, 10).split("-").map(Number);
  const base = new Date(y!, m! - 1, d!, 12, 0, 0, 0);
  const next = occurrenceDate(base, i, rule);
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  return `${next.getFullYear()}-${mm}-${dd}`;
}

/** Série de `count` ocorrências ISO (inclui a data base como primeira). */
export function generateOccurrencesISO(
  baseISO: string,
  count: number,
  rule?: Partial<RecurrenceRule>,
): string[] {
  const total = Math.max(1, Math.floor(count || 1));
  return Array.from({ length: total }, (_, i) => occurrenceDateISO(baseISO, i, rule));
}


/* ------------------------------------------------------------------ *
 * Compatibilidade com o modelo legado de frequência (atalhos)
 * ------------------------------------------------------------------ */

export type LegacyFrequencia = "semanal" | "quinzenal" | "mensal" | "anual";

/** Atalho legado → regra flexível (sem alterar resultados existentes). */
export function ruleFromFrequencia(freq?: string | null): RecurrenceRule {
  switch (freq) {
    case "semanal":
      return { interval: 1, unit: "semana" };
    case "quinzenal":
      return { interval: 2, unit: "semana" };
    case "anual":
      return { interval: 1, unit: "ano" };
    case "mensal":
    default:
      return { interval: 1, unit: "mes" };
  }
}

/** Regra flexível → atalho legado mais próximo (para colunas legadas). */
export function frequenciaFromRule(rule?: Partial<RecurrenceRule> | null): LegacyFrequencia {
  const { interval, unit } = normalizeRule(rule);
  if (unit === "semana") return interval === 2 ? "quinzenal" : "semanal";
  if (unit === "ano") return "anual";
  if (unit === "dia") return interval % 7 === 0 && interval / 7 === 2 ? "quinzenal" : "semanal";
  return "mensal";
}
