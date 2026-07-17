/**
 * WA-C11 FASE 3B — Cycle Resolver
 *
 * SERVER-ONLY. Determina o ciclo de quota do usuário:
 *   1. Se `user_plans.current_period_start`/`current_period_end` são válidos
 *      (start < end, end > now), usa como `billing_cycle`.
 *   2. Caso contrário, cai para mês calendário em America/Sao_Paulo
 *      (`calendar_month`).
 *   3. Se nada resolver, retorna `invalid` (fail-closed) — caller deve
 *      bloquear o consumo.
 *
 * Regras invioláveis:
 *   - Nunca retorna ciclo invertido.
 *   - Nunca retorna ciclo indefinido.
 *   - Nunca depende do frontend.
 *   - Nunca lê dados de outros usuários.
 */

export type CycleSource = "billing_cycle" | "calendar_month" | "invalid";

export interface Cycle {
  source: CycleSource;
  cycleStart: Date;
  cycleEnd: Date;
}

export interface PlanRow {
  plano: string | null;
  status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  access_until: string | null;
}

const SP_TZ = "America/Sao_Paulo";

/**
 * Retorna o intervalo [start, end) do mês calendário em America/Sao_Paulo
 * que contém `now`. Determinístico, sem dependência de locale do runtime.
 */
export function calendarMonthCycleSaoPaulo(now: Date): Cycle {
  // Extrai Y/M/D em SP TZ.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);

  // Calcula offset SP relativo a UTC para o instante `now`.
  const asIfUTC = Date.UTC(
    y,
    m - 1,
    Number(parts.find((p) => p.type === "day")?.value),
    Number(parts.find((p) => p.type === "hour")?.value),
    Number(parts.find((p) => p.type === "minute")?.value),
    Number(parts.find((p) => p.type === "second")?.value),
  );
  const offsetMs = asIfUTC - now.getTime();

  const startLocalUtc = Date.UTC(y, m - 1, 1, 0, 0, 0);
  const endLocalUtc = Date.UTC(y, m, 1, 0, 0, 0);
  return {
    source: "calendar_month",
    cycleStart: new Date(startLocalUtc - offsetMs),
    cycleEnd: new Date(endLocalUtc - offsetMs),
  };
}

function parseIso(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Resolve o ciclo autoritativo do usuário.
 * Se `plan` está ausente/incompleto ou tem intervalo inválido, cai para
 * o mês calendário SP. Nunca lança.
 */
export function resolveCycleForPlan(plan: PlanRow | null, now: Date = new Date()): Cycle {
  const start = parseIso(plan?.current_period_start ?? null);
  const end = parseIso(plan?.current_period_end ?? null);
  if (start && end && start.getTime() < end.getTime() && end.getTime() > now.getTime()) {
    return { source: "billing_cycle", cycleStart: start, cycleEnd: end };
  }
  const cal = calendarMonthCycleSaoPaulo(now);
  if (cal.cycleStart.getTime() < cal.cycleEnd.getTime()) return cal;
  // fail-closed final
  return { source: "invalid", cycleStart: now, cycleEnd: now };
}
