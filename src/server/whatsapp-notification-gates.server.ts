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
  | { allow: false; reason: SkippedReason };

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
