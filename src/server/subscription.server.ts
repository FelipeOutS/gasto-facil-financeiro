import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getEffectiveUserPlan, type PlanTier, type SubscriptionStatus } from "@/lib/plans";
import { hasAdminMasterRole } from "@/server/admin-master.server";

const APPROVED_PAYMENT_STATUSES = new Set(["approved", "paid", "authorized", "aprovado", "aprovada"]);

type PaymentRow = {
  id: string;
  user_id: string | null;
  plano: string | null;
  method: string | null;
  status: string | null;
  amount_cents: number | null;
  periodicidade: string | null;
  months: number | null;
  provider_payment_id: string | null;
  paid_at: string | null;
  created_at: string;
  payload?: Record<string, unknown> | null;
};

type PlanRow = {
  user_id: string;
  plano: string | null;
  status: string | null;
  trial_ends_at: string | null;
  trial_started_at: string | null;
  trial_plan_type: string | null;
  trial_used: boolean | null;
  cancelled_at: string | null;
  access_until: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  periodicidade: string | null;
  months: number | null;
  last_payment_id: string | null;
};

export type CurrentUserSubscription = {
  userId: string | null;
  email: string | null;
  plan: PlanTier;
  storedPlan: PlanTier;
  status: SubscriptionStatus;
  active: boolean;
  trialPlan: PlanTier | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialUsed: boolean;
  cancelledAt: string | null;
  accessUntil: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  periodicidade: string | null;
  months: number | null;
  lastPaymentId: string | null;
  paymentStatus: string | null;
  paymentMethod: string | null;
  paymentAmountCents: number | null;
  paidAt: string | null;
  debug: {
    checkedUserId: string | null;
    checkedEmail: string | null;
    source: "admin" | "active_payment" | "user_plan" | "trial" | "cancelled" | "pending" | "expired" | "none";
    reason: string;
    matchedPaymentId: string | null;
  };
};

function normalizeEmail(email: string | null | undefined) {
  return (email ?? "").trim().toLowerCase();
}

function normalizedStatus(status: string | null | undefined) {
  return (status ?? "").trim().toLowerCase();
}

function addMonths(iso: string, months: number) {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + Math.max(1, months || 1));
  return d.toISOString();
}

function paymentPeriod(payment: PaymentRow) {
  const start = payment.paid_at ?? payment.created_at;
  const months = Math.max(1, Number(payment.months ?? 1) || 1);
  return { start, end: addMonths(start, months), months };
}

function isPaymentActive(payment: PaymentRow, nowMs: number) {
  if (!APPROVED_PAYMENT_STATUSES.has(normalizedStatus(payment.status))) return false;
  if (!payment.plano) return false;
  const { start, end } = paymentPeriod(payment);
  return new Date(start).getTime() <= nowMs && new Date(end).getTime() >= nowMs;
}

function emptySubscription(userId: string | null, email: string | null, reason: string): CurrentUserSubscription {
  return {
    userId,
    email,
    plan: "sem_assinatura",
    storedPlan: "sem_assinatura",
    status: "sem_assinatura",
    active: false,
    trialPlan: null,
    trialStartedAt: null,
    trialEndsAt: null,
    trialUsed: false,
    cancelledAt: null,
    accessUntil: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    periodicidade: null,
    months: null,
    lastPaymentId: null,
    paymentStatus: null,
    paymentMethod: null,
    paymentAmountCents: null,
    paidAt: null,
    debug: { checkedUserId: userId, checkedEmail: email, source: "none", reason, matchedPaymentId: null },
  };
}

async function paymentsForEmail(email: string): Promise<PaymentRow[]> {
  if (!email) return [];
  const paths = [
    "payload->payer->>email",
    "payload->>payer_email",
    "payload->metadata->>email",
    "payload->metadata->>user_email",
    "payload->additional_info->payer->>email",
  ];
  const results = await Promise.all(
    paths.map((path) =>
      supabaseAdmin
        .from("subscription_payments")
        .select("id, user_id, plano, method, status, amount_cents, periodicidade, months, provider_payment_id, paid_at, created_at, payload")
        .eq(path, email)
        .order("created_at", { ascending: false })
        .limit(20),
    ),
  );
  return results.flatMap((res) => (res.data ?? []) as PaymentRow[]);
}

export async function getSubscriptionForUserIdentity(input: {
  userId: string;
  email?: string | null;
  repairLink?: boolean;
}): Promise<CurrentUserSubscription> {
  const email = normalizeEmail(input.email);
  const nowMs = Date.now();

  const isAdmin = await hasAdminMasterRole(input.userId);
  if (isAdmin) {
    return { ...emptySubscription(input.userId, email, "admin_master"), plan: "admin_master", storedPlan: "admin_master", status: "ativo", active: true, debug: { checkedUserId: input.userId, checkedEmail: email, source: "admin", reason: "admin_master", matchedPaymentId: null } };
  }

  const [planRes, paymentsByUserRes, paymentsByEmail] = await Promise.all([
    supabaseAdmin.from("user_plans").select("*").eq("user_id", input.userId).maybeSingle(),
    supabaseAdmin
      .from("subscription_payments")
      .select("id, user_id, plano, method, status, amount_cents, periodicidade, months, provider_payment_id, paid_at, created_at, payload")
      .eq("user_id", input.userId)
      .order("created_at", { ascending: false })
      .limit(50),
    paymentsForEmail(email),
  ]);

  const planRow = (planRes.data ?? null) as PlanRow | null;
  const paymentMap = new Map<string, PaymentRow>();
  for (const payment of [...((paymentsByUserRes.data ?? []) as PaymentRow[]), ...paymentsByEmail]) {
    paymentMap.set(payment.id, payment);
  }
  const payments = [...paymentMap.values()].sort(
    (a, b) => new Date(b.paid_at ?? b.created_at).getTime() - new Date(a.paid_at ?? a.created_at).getTime(),
  );
  const activePayment = payments.find((payment) => isPaymentActive(payment, nowMs));

  if (activePayment?.user_id && activePayment.user_id !== input.userId) {
    console.info("[subscription] pagamento aprovado encontrado por e-mail normalizado", {
      userId: input.userId,
      email,
      paymentId: activePayment.id,
      linkedUserId: activePayment.user_id,
    });
  }

  if (activePayment) {
    const { start, end, months } = paymentPeriod(activePayment);
    if (input.repairLink && activePayment.user_id !== input.userId) {
      await supabaseAdmin.from("subscription_payments").update({ user_id: input.userId }).eq("id", activePayment.id);
    }
    return {
      userId: input.userId,
      email,
      plan: getEffectiveUserPlan({ email }, activePayment.plano),
      storedPlan: getEffectiveUserPlan({ email: null }, activePayment.plano),
      status: "ativo",
      active: true,
      trialPlan: null,
      trialStartedAt: planRow?.trial_started_at ?? null,
      trialEndsAt: planRow?.trial_ends_at ?? null,
      trialUsed: Boolean(planRow?.trial_used),
      cancelledAt: null,
      accessUntil: null,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      periodicidade: activePayment.periodicidade ?? null,
      months,
      lastPaymentId: activePayment.provider_payment_id ?? activePayment.id,
      paymentStatus: activePayment.status ?? null,
      paymentMethod: activePayment.method ?? null,
      paymentAmountCents: activePayment.amount_cents ?? null,
      paidAt: activePayment.paid_at ?? activePayment.created_at,
      debug: { checkedUserId: input.userId, checkedEmail: email, source: "active_payment", reason: "approved_payment_inside_period", matchedPaymentId: activePayment.id },
    };
  }

  if (!planRow) return emptySubscription(input.userId, email, "no_user_plan_or_active_payment");

  const storedPlan = getEffectiveUserPlan({ email: null }, planRow.plano);
  const trialPlan = getEffectiveUserPlan({ email: null }, planRow.trial_plan_type) === "sem_assinatura" ? null : getEffectiveUserPlan({ email: null }, planRow.trial_plan_type);
  const trialEndMs = planRow.trial_ends_at ? new Date(planRow.trial_ends_at).getTime() : 0;
  if (trialPlan && trialEndMs > nowMs) {
    return { ...emptySubscription(input.userId, email, "trial_active"), plan: trialPlan, storedPlan, status: "teste", active: true, trialPlan, trialStartedAt: planRow.trial_started_at, trialEndsAt: planRow.trial_ends_at, trialUsed: Boolean(planRow.trial_used), debug: { checkedUserId: input.userId, checkedEmail: email, source: "trial", reason: "trial_inside_period", matchedPaymentId: null } };
  }

  const accessUntilMs = planRow.access_until ? new Date(planRow.access_until).getTime() : 0;
  if (planRow.cancelled_at && accessUntilMs > nowMs) {
    return { ...emptySubscription(input.userId, email, "cancelled_but_inside_paid_period"), plan: storedPlan, storedPlan, status: "cancelado", active: true, cancelledAt: planRow.cancelled_at, accessUntil: planRow.access_until, currentPeriodStart: planRow.current_period_start, currentPeriodEnd: planRow.current_period_end, periodicidade: planRow.periodicidade, months: planRow.months, lastPaymentId: planRow.last_payment_id, debug: { checkedUserId: input.userId, checkedEmail: email, source: "cancelled", reason: "access_until_in_future", matchedPaymentId: planRow.last_payment_id } };
  }

  const planEndMs = planRow.current_period_end ? new Date(planRow.current_period_end).getTime() : 0;
  if (normalizedStatus(planRow.status) === "ativo" && storedPlan !== "sem_assinatura" && storedPlan !== "free" && (!planEndMs || planEndMs >= nowMs)) {
    return { ...emptySubscription(input.userId, email, "user_plan_active"), plan: storedPlan, storedPlan, status: "ativo", active: true, trialStartedAt: planRow.trial_started_at, trialEndsAt: planRow.trial_ends_at, trialUsed: Boolean(planRow.trial_used), currentPeriodStart: planRow.current_period_start, currentPeriodEnd: planRow.current_period_end, periodicidade: planRow.periodicidade, months: planRow.months, lastPaymentId: planRow.last_payment_id, debug: { checkedUserId: input.userId, checkedEmail: email, source: "user_plan", reason: "user_plan_active_inside_period", matchedPaymentId: planRow.last_payment_id } };
  }

  const status = normalizedStatus(planRow.status) === "aguardando_pagamento" ? "aguardando_pagamento" : planEndMs > 0 && planEndMs < nowMs ? "expirado" : "sem_assinatura";
  return { ...emptySubscription(input.userId, email, status), storedPlan, status, trialStartedAt: planRow.trial_started_at, trialEndsAt: planRow.trial_ends_at, trialUsed: Boolean(planRow.trial_used), currentPeriodStart: planRow.current_period_start, currentPeriodEnd: planRow.current_period_end, periodicidade: planRow.periodicidade, months: planRow.months, lastPaymentId: planRow.last_payment_id, debug: { checkedUserId: input.userId, checkedEmail: email, source: status === "aguardando_pagamento" ? "pending" : status === "expirado" ? "expired" : "none", reason: status, matchedPaymentId: null } };
}