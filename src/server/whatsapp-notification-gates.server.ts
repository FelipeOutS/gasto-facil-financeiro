/**
 * WA-C8 — Gates de envio (opt-in canal, opt-in categoria, quiet hours, janela 24h).
 *
 * Não envia nada. Apenas decide se uma notificação pode ir adiante ou
 * deve ser `skipped` (com motivo). Todas as queries filtram `user_id`.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type {
  NotificationCategory,
  SkippedReason,
} from "./whatsapp-notifications.server";

export type GateDecision =
  | { allow: true }
  | {
      allow: false;
      reason: SkippedReason;
      /**
       * WA-C8.1 — presente APENAS quando `reason === "quiet_hours"`.
       * Instante UTC em que a notificação deve reaparecer como due.
       */
      nextAllowedAt?: Date;
    };

export interface GatesDeps {
  client?: typeof supabaseAdmin;
  now?: () => Date;
}

function client(deps?: GatesDeps) {
  return deps?.client ?? supabaseAdmin;
}

interface PrefsRow {
  contas_a_pagar: boolean;
  recorrencias: boolean;
  metas: boolean;
  orcamento: boolean;
  ia_insights: boolean;
  mercado: boolean;
  avisos_sistema: boolean;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
}

const DEFAULT_PREFS: PrefsRow = {
  contas_a_pagar: true,
  recorrencias: true,
  metas: false,
  orcamento: false,
  ia_insights: false,
  mercado: false,
  avisos_sistema: true,
  quiet_hours_start: null,
  quiet_hours_end: null,
};

/**
 * Verifica se há vínculo WhatsApp opt-in ativo (não revogado) para o usuário.
 * Reutiliza `whatsapp_links` (mesma fonte de verdade da WA-C1+).
 */
export async function isChannelOptedIn(
  userId: string,
  deps?: GatesDeps,
): Promise<{ ok: boolean; reason?: SkippedReason }> {
  const c = client(deps);
  const { data } = await c
    .from("whatsapp_links")
    .select("opt_in_em, revogado_em, ativo")
    .eq("user_id", userId)
    .eq("ativo", true)
    .order("opt_in_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return { ok: false, reason: "channel_not_optedin" };
  const row = data as { opt_in_em: string | null; revogado_em: string | null; ativo: boolean };
  if (!row.opt_in_em) return { ok: false, reason: "channel_not_optedin" };
  if (row.revogado_em) return { ok: false, reason: "channel_revoked" };
  if (!row.ativo) return { ok: false, reason: "channel_revoked" };
  return { ok: true };
}

export async function getPreferences(
  userId: string,
  deps?: GatesDeps,
): Promise<PrefsRow> {
  const c = client(deps);
  const { data } = await c
    .from("whatsapp_notification_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data as any) as PrefsRow) ?? DEFAULT_PREFS;
}

export function isCategoryEnabled(
  prefs: PrefsRow,
  category: NotificationCategory,
): boolean {
  return prefs[category] === true;
}

export async function getUserTimezone(
  userId: string,
  deps?: GatesDeps,
): Promise<string> {
  const c = client(deps);
  const { data } = await c
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tz = (data as any)?.timezone as string | undefined;
  return tz && tz.length > 0 ? tz : "America/Sao_Paulo";
}

/**
 * Hora local (0..23) num timezone IANA usando Intl.DateTimeFormat.
 */
export function hourInTimezone(now: Date, timezone: string): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const h = parts.find((p) => p.type === "hour")?.value ?? "00";
    const n = Number(h);
    return Number.isFinite(n) ? n % 24 : 0;
  } catch {
    return now.getUTCHours();
  }
}

/**
 * Verifica se o horário local cai dentro da janela de silêncio.
 * Suporta janela que cruza a meia-noite (ex: 22 → 7).
 */
export function isQuietHour(
  hourLocal: number,
  start: number | null,
  end: number | null,
): boolean {
  if (start == null || end == null) return false;
  if (start === end) return false;
  if (start < end) return hourLocal >= start && hourLocal < end;
  return hourLocal >= start || hourLocal < end;
}

/**
 * WA-C8.1 — Componentes locais (year/month/day/hour, 0-based month) de `instant`
 * no timezone informado. Usa `Intl.DateTimeFormat` (locale `en-CA` produz
 * `YYYY-MM-DD`).
 */
function localPartsInTimezone(
  instant: Date,
  timezone: string,
): { year: number; month: number; day: number; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(instant);
  const pick = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? "0");
  let hour = pick("hour");
  // `en-CA` com hour12:false emite "24" à meia-noite em algumas engines.
  if (hour === 24) hour = 0;
  return {
    year: pick("year"),
    month: pick("month") - 1,
    day: pick("day"),
    hour,
  };
}

/**
 * Converte um wall-clock (ano/mês/dia/hora, 0-based month) no timezone
 * informado para o instante UTC correspondente. Duas iterações de ponto-fixo
 * cobrem transições de DST (avanço/retorno) — em horário local inexistente,
 * converge para o instante logo após o salto; em horário duplicado,
 * converge para uma das duas ocorrências de forma determinística.
 */
function zonedWallTimeToUtc(
  year: number,
  monthZeroBased: number,
  day: number,
  hour: number,
  timezone: string,
): Date {
  // 1ª aproximação: tratar wall-clock como se fosse UTC.
  let utc = Date.UTC(year, monthZeroBased, day, hour, 0, 0);
  for (let i = 0; i < 3; i++) {
    const parts = localPartsInTimezone(new Date(utc), timezone);
    const asLocalUtc = Date.UTC(
      parts.year,
      parts.month,
      parts.day,
      parts.hour,
      0,
      0,
    );
    const wantedUtc = Date.UTC(year, monthZeroBased, day, hour, 0, 0);
    const drift = asLocalUtc - wantedUtc;
    if (drift === 0) break;
    utc -= drift;
  }
  return new Date(utc);
}

function addLocalDays(
  y: number,
  m: number,
  d: number,
  days: number,
): { year: number; month: number; day: number } {
  const t = Date.UTC(y, m, d + days, 12, 0, 0); // meio-dia UTC evita bordas
  const dt = new Date(t);
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth(),
    day: dt.getUTCDate(),
  };
}

/**
 * WA-C8.1 — Próximo instante UTC permitido após a janela de silêncio.
 *
 * Contrato:
 *  - Retorna `null` quando quiet hours está desativado (start/end nulos ou
 *    iguais — preserva o contrato de `isQuietHour`, que trata `start===end`
 *    como desativado).
 *  - Se `now` NÃO está dentro da quiet window, retorna `null` (nada a fazer).
 *  - Caso contrário retorna o instante UTC alinhado a `HH:00:00` local
 *    correspondente ao fim exclusivo da janela (`end`), no timezone do
 *    usuário. Nunca retorna um instante <= `now` nem dentro da janela.
 *  - Usa fallback `America/Sao_Paulo` para timezone inválido/ausente.
 *  - Limite defensivo: no máximo 5 tentativas de +1h para lidar com DST /
 *    horário local inexistente — nunca entra em loop infinito.
 */
export function nextAllowedAfterQuietHours(
  now: Date,
  start: number | null,
  end: number | null,
  timezone: string | null | undefined,
): Date | null {
  if (start == null || end == null) return null;
  if (start === end) return null;

  let tz = timezone && timezone.length > 0 ? timezone : "America/Sao_Paulo";
  // Validação defensiva do TZ.
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  } catch {
    tz = "America/Sao_Paulo";
  }

  const local = localPartsInTimezone(now, tz);
  if (!isQuietHour(local.hour, start, end)) return null;

  // Descobre em qual dia local cai o `end`.
  // Janela sem cruzar meia-noite (start < end): `end` é hoje.
  // Janela cruzando meia-noite (start > end):
  //   - se `hour >= start`: `end` é AMANHÃ;
  //   - se `hour < end`:    `end` é HOJE.
  let target = { year: local.year, month: local.month, day: local.day };
  if (start > end && local.hour >= start) {
    target = addLocalDays(local.year, local.month, local.day, 1);
  }

  let candidate = zonedWallTimeToUtc(
    target.year,
    target.month,
    target.day,
    end,
    tz,
  );

  // Guarda: garante `candidate > now` e fora da quiet window (DST /
  // horário inexistente / dupla ocorrência).
  let guard = 0;
  while (
    guard < 5 &&
    (candidate.getTime() <= now.getTime() ||
      isQuietHour(hourInTimezone(candidate, tz), start, end))
  ) {
    candidate = new Date(candidate.getTime() + 60 * 60_000);
    guard++;
  }
  return candidate;
}


/**
 * Janela de 24h após última mensagem do usuário: required pela política da Meta
 * para mensagens não-template. Lê `whatsapp_messages` (já existente).
 */
export async function hasOpenSessionWindow(
  userId: string,
  deps?: GatesDeps,
): Promise<boolean> {
  const c = client(deps);
  const since = new Date((deps?.now?.() ?? new Date()).getTime() - 24 * 3600_000).toISOString();
  const { data } = await c
    .from("whatsapp_messages")
    .select("id")
    .eq("user_id", userId)
    .gte("created_at", since)
    .limit(1)
    .maybeSingle();
  return !!data;
}

export interface CanDispatchInput {
  userId: string;
  category: NotificationCategory;
  requiresTemplateWindow: boolean;
  hasMetaTemplate: boolean;
}

/**
 * Composição de todos os gates. Retorna allow ou skip com motivo.
 */
export async function canDispatch(
  input: CanDispatchInput,
  deps?: GatesDeps,
): Promise<GateDecision> {
  const channel = await isChannelOptedIn(input.userId, deps);
  if (!channel.ok) return { allow: false, reason: channel.reason! };

  const prefs = await getPreferences(input.userId, deps);
  if (!isCategoryEnabled(prefs, input.category)) {
    return { allow: false, reason: "category_opt_out" };
  }

  const now = deps?.now?.() ?? new Date();
  const tz = await getUserTimezone(input.userId, deps);
  const hour = hourInTimezone(now, tz);
  if (isQuietHour(hour, prefs.quiet_hours_start, prefs.quiet_hours_end)) {
    return { allow: false, reason: "quiet_hours" };
  }

  // Política da Meta: fora da janela de 24h, exige template aprovado (HSM).
  if (input.requiresTemplateWindow) {
    const open = await hasOpenSessionWindow(input.userId, deps);
    if (!open && !input.hasMetaTemplate) {
      return { allow: false, reason: "no_session_window" };
    }
  }

  return { allow: true };
}
