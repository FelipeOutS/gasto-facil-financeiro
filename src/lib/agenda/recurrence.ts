/**
 * GI Agenda — recorrência estruturada (diária/semanal/mensal/anual + intervalo).
 * A próxima ocorrência é calculada no fuso do item, preservando o horário
 * local (ex.: 09:00 continua 09:00 mesmo com mudança de offset).
 */
import { addDaysYmd, daysInMonth, localParts, localToUtc, type YMD, DEFAULT_TZ } from "./datetime";

export type RecurrenceFreq = "diaria" | "semanal" | "mensal" | "anual";
export const RECURRENCE_FREQS: RecurrenceFreq[] = ["diaria", "semanal", "mensal", "anual"];

export type RecurrenceRule = {
  freq: RecurrenceFreq | null;
  interval?: number;
  until?: string | null; // YYYY-MM-DD local
};

function stepOnce(base: YMD, anchorDay: number, freq: RecurrenceFreq, n: number): YMD {
  if (freq === "diaria") return addDaysYmd(base, n);
  if (freq === "semanal") return addDaysYmd(base, 7 * n);
  let y = base.y;
  let m = base.m;
  if (freq === "mensal") {
    m += n;
    while (m > 12) {
      m -= 12;
      y += 1;
    }
  } else {
    y += n;
  }
  // Dia 31 → último dia do mês quando o mês é mais curto (sem "pular" mês).
  return { y, m, d: Math.min(anchorDay, daysInMonth(y, m)) };
}

/**
 * Próxima ocorrência estritamente depois de `after`, a partir da âncora
 * `startsAt`. Retorna null quando não há recorrência ou passou de `until`.
 */
export function nextOccurrence(
  startsAt: Date,
  rule: RecurrenceRule,
  after: Date,
  tz: string = DEFAULT_TZ,
): Date | null {
  if (!rule.freq) return startsAt.getTime() > after.getTime() ? startsAt : null;
  const interval = Math.max(1, Math.floor(rule.interval ?? 1));
  const lp = localParts(startsAt, tz);
  const anchor: YMD = { y: lp.y, m: lp.m, d: lp.d };
  const hm = { h: lp.h, mi: lp.mi };
  let k = 0;
  let cur = startsAt;
  // Limite de segurança: ~ 20 anos de ocorrências diárias.
  while (cur.getTime() <= after.getTime() && k < 7400) {
    k += 1;
    cur = localToUtc(stepOnce(anchor, anchor.d, rule.freq, interval * k), hm, tz);
  }
  if (cur.getTime() <= after.getTime()) return null;
  if (rule.until) {
    const c = localParts(cur, tz);
    const iso = `${c.y}-${String(c.m).padStart(2, "0")}-${String(c.d).padStart(2, "0")}`;
    if (iso > rule.until) return null;
  }
  return cur;
}

export function detectRecurrence(textNorm: string): RecurrenceFreq | null {
  if (/\b(todo dia|todos os dias|diariamente|toda manha|toda noite)\b/.test(textNorm)) return "diaria";
  if (/\b(toda semana|semanalmente|toda (segunda|terca|quarta|quinta|sexta|sabado)|todo (sabado|domingo))\b/.test(textNorm))
    return "semanal";
  if (/\b(todo mes|todos os meses|mensalmente|todo dia \d{1,2})\b/.test(textNorm)) return "mensal";
  if (/\b(todo ano|todos os anos|anualmente)\b/.test(textNorm)) return "anual";
  return null;
}

export function stripRecurrence(textNorm: string): string {
  return textNorm
    .replace(/\b(todo dia|todos os dias|diariamente|toda semana|semanalmente|todo mes|todos os meses|mensalmente|todo ano|todos os anos|anualmente)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
