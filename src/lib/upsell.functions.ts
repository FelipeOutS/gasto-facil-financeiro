import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  checkUpsellEligibility,
  getUpsellConfig,
  type UpsellEligibility,
} from "@/server/upsell-eligibility.server";
import { supabaseAdmin as sb } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Campos de preferências lidos pelo servidor (nunca vindos do cliente). */
interface UpsellPrefsRow {
  session_count?: number | null;
  distinct_use_days?: number | null;
  dismiss_count?: number | null;
  last_activity_date?: string | null;
  converted_at?: string | null;
}

/** Payload de atualização — apenas colunas escalares de comunicação. */
interface UpsellPrefsUpdate {
  last_shown_at?: string;
  updated_at?: string;
  last_banner_at?: string;
  last_modal_at?: string;
  dismiss_count?: number;
  snooze_until?: string;
  last_trigger?: string;
}

type AuthedContext = { userId?: string };

/** Garante a linha de preferências (service_role: converted_at nunca vem do cliente). */
async function ensurePrefs(userId: string): Promise<UpsellPrefsRow> {
  const { data } = await sb
    .from("user_communication_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data as UpsellPrefsRow;
  await sb.from("user_communication_preferences").insert({ user_id: userId });
  const { data: created } = await sb
    .from("user_communication_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  return (created ?? {}) as UpsellPrefsRow;
}

/**
 * Registra atividade autenticada: dias distintos de uso e sessões.
 * Sem nenhum dado financeiro. Chamada uma vez por sessão do navegador.
 */
export const recordUpsellActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: boolean }> => {
    const userId = (context as AuthedContext).userId;
    if (!userId) return { ok: false };

    const prefs = await ensurePrefs(userId);
    const today = new Date().toISOString().slice(0, 10);
    const isNewDay = prefs.last_activity_date !== today;

    await sb
      .from("user_communication_preferences")
      .update({
        session_count: (prefs.session_count ?? 0) + 1,
        distinct_use_days: (prefs.distinct_use_days ?? 0) + (isNewDay ? 1 : 0),
        last_activity_date: today,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    return { ok: true };
  });

/** Registra tentativa legítima de acessar recurso pago (gatilho alternativo). */
export const recordPaidFeatureAttempt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: boolean }> => {
    const userId = (context as AuthedContext).userId;
    if (!userId) return { ok: false };
    await ensurePrefs(userId);
    await sb
      .from("user_communication_preferences")
      .update({
        paid_feature_attempt_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    return { ok: true };
  });

export const getUpsellStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UpsellEligibility> => {
    const userId = (context as AuthedContext).userId;
    return checkUpsellEligibility(userId ?? "");
  });

/** Marca exibição efetiva do canal, aplicando o intervalo (7d banner / 21d modal). */
export const markUpsellShown = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ type: z.enum(["banner", "modal"]) }).parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const userId = (context as AuthedContext).userId;
    if (!userId) return { ok: false };
    await ensurePrefs(userId);
    const now = new Date().toISOString();
    const update: UpsellPrefsUpdate = { last_shown_at: now, updated_at: now };
    if (data.type === "banner") update.last_banner_at = now;
    else update.last_modal_at = now;
    await sb.from("user_communication_preferences").update(update).eq("user_id", userId);
    return { ok: true };
  });

export const dismissUpsell = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ type: z.enum(["banner", "modal"]), trigger: z.string().optional() }).parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const userId = (context as AuthedContext).userId;
    if (!userId) return { success: false };

    const config = await getUpsellConfig();
    const prefs = await ensurePrefs(userId);
    const newCount = (prefs.dismiss_count ?? 0) + 1;

    const snoozeDays =
      newCount >= 3
        ? Number(config.max_dismiss_snooze_days ?? 30)
        : Number(config.dismiss_snooze_days ?? 14);
    const snoozeUntil = new Date(Date.now() + snoozeDays * 86_400_000);

    const now = new Date().toISOString();
    const update: UpsellPrefsUpdate = {
      dismiss_count: newCount,
      snooze_until: snoozeUntil.toISOString(),
      last_shown_at: now,
      updated_at: now,
    };
    if (data.type === "banner") update.last_banner_at = now;
    if (data.type === "modal") update.last_modal_at = now;
    if (data.trigger) update.last_trigger = data.trigger;

    await sb.from("user_communication_preferences").update(update).eq("user_id", userId);
    return { success: true };
  });
