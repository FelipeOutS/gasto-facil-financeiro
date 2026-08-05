import { supabaseAdmin as sb } from "@/integrations/supabase/client.server";
import { getSubscriptionForUserIdentity } from "./subscription.server";

export interface UpsellCriteria {
  authenticated: boolean;
  free_ads_plan: boolean;
  onboarding_completed: boolean;
  account_age_48h: boolean;
  distinct_use_days_2: boolean;
  transactions_5: boolean;
  sessions_3: boolean;
  paid_feature_attempt: boolean;
  trigger_or: boolean;
  no_trial: boolean;
  no_paid_entitlement: boolean;
  no_pending_payment: boolean;
  no_open_checkout: boolean;
  no_owner_role: boolean;
  no_admin_role: boolean;
  frequency_allowed: boolean;
}

export interface UpsellEligibility {
  eligible: boolean;
  reason?: string;
  /** Quais canais podem ser exibidos agora (nunca os dois simultaneamente). */
  channel: "banner" | "modal" | "none";
  criteria: UpsellCriteria;
  config: Record<string, any>;
}

const DEFAULTS = {
  enabled: true,
  banner_interval_days: 7,
  modal_interval_days: 21,
  dismiss_snooze_days: 14,
  max_dismiss_snooze_days: 30,
};

export async function getUpsellConfig(): Promise<Record<string, any>> {
  // Leitura server-side (service_role). A tabela não é legível por usuários comuns.
  const { data: rows } = await sb.from("upsell_runtime_config").select("key, value");
  const config: Record<string, any> = { ...DEFAULTS };
  for (const row of rows || []) config[row.key] = row.value;
  return config;
}

function daysSince(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

function emptyCriteria(): UpsellCriteria {
  return {
    authenticated: false,
    free_ads_plan: false,
    onboarding_completed: false,
    account_age_48h: false,
    distinct_use_days_2: false,
    transactions_5: false,
    sessions_3: false,
    paid_feature_attempt: false,
    trigger_or: false,
    no_trial: false,
    no_paid_entitlement: false,
    no_pending_payment: false,
    no_open_checkout: false,
    no_owner_role: false,
    no_admin_role: false,
    frequency_allowed: false,
  };
}

function deny(
  reason: string,
  criteria: UpsellCriteria,
  config: Record<string, any>,
): UpsellEligibility {
  return { eligible: false, reason, channel: "none", criteria, config };
}

export async function checkUpsellEligibility(userId: string): Promise<UpsellEligibility> {
  const config = await getUpsellConfig();
  const criteria = emptyCriteria();

  if (!userId) return deny("unauthenticated", criteria, config);
  criteria.authenticated = true;

  if (config.enabled === false) return deny("upsell_disabled", criteria, config);

  // 1. Roles (owner / administrativas)
  const { data: roleData } = await sb.from("user_roles").select("role").eq("user_id", userId);
  const roles = (roleData || []).map((r) => String(r.role));
  criteria.no_owner_role = !roles.includes("owner");
  criteria.no_admin_role = !roles.includes("admin");
  if (!criteria.no_owner_role) return deny("owner_role", criteria, config);
  if (!criteria.no_admin_role) return deny("admin_role", criteria, config);

  // 2. Plano / entitlement / trial
  const { data: authUser } = await sb.auth.admin.getUserById(userId);
  const email = authUser?.user?.email ?? null;
  const sub = await getSubscriptionForUserIdentity({ userId, email, repairLink: false });

  criteria.free_ads_plan = sub.plan === "free_ads";
  criteria.no_trial = !(
    sub.status === "teste" ||
    (sub.trialEndsAt ? new Date(sub.trialEndsAt).getTime() > Date.now() : false)
  );
  criteria.no_paid_entitlement = !(sub.active && sub.status === "ativo");

  if (!criteria.free_ads_plan) return deny("not_free_ads_plan", criteria, config);
  if (!criteria.no_trial) return deny("trial_active", criteria, config);
  if (!criteria.no_paid_entitlement) return deny("already_active_paid", criteria, config);

  // 3. Pagamento pendente / checkout em andamento
  const { count: pendingPayments } = await sb
    .from("subscription_payments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "pending");
  criteria.no_pending_payment = (pendingPayments || 0) === 0;
  if (!criteria.no_pending_payment) return deny("pending_payment", criteria, config);

  const { count: openCheckouts } = await sb
    .from("payment_checkout_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString());
  criteria.no_open_checkout = (openCheckouts || 0) === 0;
  if (!criteria.no_open_checkout) return deny("open_checkout", criteria, config);

  // 4. Onboarding concluído
  const { data: onboarding } = await sb
    .from("user_onboarding")
    .select("onboarding_completed")
    .eq("user_id", userId)
    .maybeSingle();
  criteria.onboarding_completed = Boolean(onboarding?.onboarding_completed);
  if (!criteria.onboarding_completed) return deny("onboarding_incomplete", criteria, config);

  // 5. Conta com pelo menos 48 horas
  const createdAt = authUser?.user?.created_at ?? null;
  criteria.account_age_48h = createdAt
    ? Date.now() - new Date(createdAt).getTime() >= 48 * 3_600_000
    : false;
  if (!criteria.account_age_48h) return deny("new_user_grace_period", criteria, config);

  // 6. Preferências / atividade persistida (sem dados financeiros)
  const { data: prefs } = await sb
    .from("user_communication_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  const p = (prefs ?? {}) as Record<string, any>;

  criteria.distinct_use_days_2 = (p.distinct_use_days ?? 0) >= 2;
  criteria.sessions_3 = (p.session_count ?? 0) >= 3;
  criteria.paid_feature_attempt = Boolean(p.paid_feature_attempt_at);

  // Gatilho: 5 lançamentos financeiros reais (gastos + receitas)
  const { count: gastosCount } = await sb
    .from("gastos")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  const { count: receitasCount } = await sb
    .from("receitas")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  criteria.transactions_5 = (gastosCount || 0) + (receitasCount || 0) >= 5;

  criteria.trigger_or =
    criteria.transactions_5 || criteria.sessions_3 || criteria.paid_feature_attempt;

  if (!criteria.distinct_use_days_2) return deny("insufficient_distinct_days", criteria, config);
  if (!criteria.trigger_or) return deny("no_engagement_trigger", criteria, config);

  // 7. Conversão já registrada pelo servidor
  if (p.converted_at) return deny("already_converted", criteria, config);

  // 8. Frequência (snooze + intervalos por canal)
  if (p.snooze_until && new Date(p.snooze_until) > new Date()) {
    return deny("snoozed", criteria, config);
  }

  const bannerInterval = Number(config.banner_interval_days ?? DEFAULTS.banner_interval_days);
  const modalInterval = Number(config.modal_interval_days ?? DEFAULTS.modal_interval_days);
  const bannerAllowed = daysSince(p.last_banner_at) >= bannerInterval;
  const modalAllowed = daysSince(p.last_modal_at) >= modalInterval;

  // Nunca banner e modal juntos: o modal (menor frequência) tem precedência.
  const channel: UpsellEligibility["channel"] = modalAllowed
    ? "modal"
    : bannerAllowed
      ? "banner"
      : "none";

  criteria.frequency_allowed = channel !== "none";
  if (!criteria.frequency_allowed) return deny("frequency_window", criteria, config);

  return { eligible: true, channel, criteria, config };
}
