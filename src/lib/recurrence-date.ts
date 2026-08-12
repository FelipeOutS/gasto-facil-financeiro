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

/* ------------------------------------------------------------------ *
 * Término da recorrência — contagem, data final ou sem fim
 *
 * Fonte única de verdade: tudo abaixo usa `occurrenceDateISO`, o mesmo
 * motor usado para materializar os lançamentos reais.
 * ------------------------------------------------------------------ */

export type RecurrenceEnd =
  | { mode: "count"; count: number }
  | { mode: "until"; until: string }
  | { mode: "forever" };

/** Horizonte materializado quando não há data final (evita gerar até 2050). */
export const OPEN_ENDED_HORIZON_MONTHS = 24;
/** Teto absoluto de ocorrências materializadas de uma vez. */
export const MAX_MATERIALIZED_OCCURRENCES = 240;

/** Quantas ocorrências existem de `baseISO` até `untilISO` (inclusive). */
export function countOccurrencesUntilISO(
  baseISO: string,
  untilISO: string,
  rule?: Partial<RecurrenceRule>,
  cap: number = MAX_MATERIALIZED_OCCURRENCES,
): number {
  const base = baseISO.slice(0, 10);
  const until = untilISO.slice(0, 10);
  if (until < base) return 0;
  let n = 0;
  for (let i = 0; i < cap; i++) {
    if (occurrenceDateISO(base, i, rule) <= until) n++;
    else break;
  }
  return n;
}

/** Quantidade de ocorrências a materializar para qualquer forma de término. */
export function resolveOccurrenceCount(
  baseISO: string,
  rule?: Partial<RecurrenceRule>,
  end?: RecurrenceEnd,
): number {
  const e = end ?? { mode: "count", count: 12 };
  if (e.mode === "count") {
    return Math.min(MAX_MATERIALIZED_OCCURRENCES, Math.max(1, Math.floor(e.count || 1)));
  }
  if (e.mode === "until") {
    return Math.max(1, countOccurrencesUntilISO(baseISO, e.until, rule));
  }
  const horizon = addMonthsPreservingDayISO(baseISO, OPEN_ENDED_HORIZON_MONTHS);
  return Math.max(1, Math.min(60, countOccurrencesUntilISO(baseISO, horizon, rule)));
}

/**
 * Prévia compacta das próximas ocorrências.
 * `remaining` é null quando a recorrência não tem fim definido.
 */
export function previewOccurrences(
  baseISO: string,
  rule?: Partial<RecurrenceRule>,
  end?: RecurrenceEnd,
  limit = 4,
): { dates: string[]; remaining: number | null; openEnded: boolean } {
  const openEnded = (end?.mode ?? "count") === "forever";
  if (openEnded) {
    return { dates: generateOccurrencesISO(baseISO, limit, rule), remaining: null, openEnded };
  }
  const total = resolveOccurrenceCount(baseISO, rule, end);
  const shown = Math.min(limit, total);
  return {
    dates: generateOccurrencesISO(baseISO, shown, rule),
    remaining: Math.max(0, total - shown),
    openEnded,
  };
}

export type RecurrenceValidationCode = "interval" | "count" | "untilBeforeStart";

/** Validação das combinações inválidas de recorrência. */
export function validateRecurrence(
  baseISO: string,
  rule?: Partial<RecurrenceRule>,
  end?: RecurrenceEnd,
): { ok: true } | { ok: false; code: RecurrenceValidationCode } {
  if (!Number.isFinite(Number(rule?.interval)) || Math.floor(Number(rule?.interval)) < 1) {
    return { ok: false, code: "interval" };
  }
  const e = end ?? { mode: "count", count: 12 };
  if (e.mode === "count" && (!Number.isFinite(e.count) || Math.floor(e.count) < 1)) {
    return { ok: false, code: "count" };
  }
  if (e.mode === "until") {
    if (!e.until || e.until.slice(0, 10) < baseISO.slice(0, 10)) {
      return { ok: false, code: "untilBeforeStart" };
    }
  }
  return { ok: true };
}

/**
 * Deduz a regra de recorrência a partir das datas já materializadas
 * (usada na EDIÇÃO, onde a regra não é persistida por ocorrência).
 * Usa o mesmo motor: uma regra só é aceita se reproduz a 2ª data.
 */
export function inferRuleFromISODates(dates: string[]): RecurrenceRule | null {
  const uniq = Array.from(new Set(dates.map((d) => d.slice(0, 10)))).sort();
  if (uniq.length < 2) return null;
  const [a, b] = [uniq[0]!, uniq[1]!];
  for (const unit of ["mes", "ano"] as const) {
    for (let interval = 1; interval <= 36; interval++) {
      if (occurrenceDateISO(a, 1, { interval, unit }) === b) return { interval, unit };
    }
  }
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  const diffDays = Math.round(
    (new Date(y2!, m2! - 1, d2!).getTime() - new Date(y1!, m1! - 1, d1!).getTime()) / 86400000,
  );
  if (diffDays <= 0) return null;
  if (diffDays % 7 === 0) return { interval: diffDays / 7, unit: "semana" };
  return { interval: diffDays, unit: "dia" };
}
