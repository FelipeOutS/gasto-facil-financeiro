import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { getCurrentUserSubscription } from "@/server/subscription.functions";
import {
  getEffectiveUserPlan,
  isAdminMasterEmail,
  planAllowsFeature,
  type FeatureKey,
  type PlanTier,
  type SubscriptionStatus,
} from "@/lib/plans";

export type UserPlan = {
  plan: PlanTier;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
};

type PlanState = UserPlan & {
  loading: boolean;
  isAdminMaster: boolean;
  /** Plano salvo bruto (antes de aplicar o override de Admin Master). */
  storedPlan: PlanTier;
  /** Plano em teste, se houver teste ativo. */
  trialPlan: PlanTier | null;
  trialStartedAt: string | null;
  /** Marcador: usuário já consumiu o teste de 10 dias (ativo ou expirado). */
  trialUsed: boolean;
  /** Teste ainda dentro da janela de 10 dias? */
  isTrialActive: boolean;
  /** Dias restantes no teste (>=0). */
  trialDaysLeft: number;
  /** Data ISO em que a assinatura foi cancelada. */
  cancelledAt: string | null;
  /** Até quando o acesso premium continua válido após cancelamento. */
  accessUntil: string | null;
  /** Forma de pagamento da assinatura ativa, quando houver. */
  paymentMethod: string | null;
  /** Total pago em centavos da assinatura ativa, quando houver. */
  paymentAmountCents: number | null;
  /** Data do pagamento aprovado usado como fonte da assinatura. */
  paidAt: string | null;
  /** Periodicidade contratada do período ativo. */
  periodicidade: string | null;
  /** Assinatura cancelada porém ainda dentro do período pago. */
  isCancelled: boolean;
  /** Início do período pago atual. */
  currentPeriodStart: string | null;
  /** Fim do período pago atual (próxima renovação manual). */
  currentPeriodEnd: string | null;
  /** Recarrega plano e status do banco (após escolher plano, etc.). */
  refresh: () => Promise<void>;
  /** Pode acessar o recurso? Considera Admin Master, plano e teste. */
  can: (feature: FeatureKey) => boolean;
};

const TRIAL_PLAN_VALUES: PlanTier[] = [
  "pessoal_manual",
  "pessoal_premium",
  "mei_essencial",
  "mei_inteligente",
  "empresa",
];

function asTrialPlan(value: string | null | undefined): PlanTier | null {
  if (!value) return null;
  const v = value.toLowerCase();
  return (TRIAL_PLAN_VALUES as string[]).includes(v) ? (v as PlanTier) : null;
}

/**
 * Lê o plano efetivo do usuário, sempre passando pela regra central
 * `getEffectiveUserPlan(user, storedPlan)`. Admin Master por e-mail
 * tem precedência absoluta.
 */
export function usePlan(): PlanState {
  const { user, loading: authLoading } = useAuth();
  const [storedRaw, setStoredRaw] = useState<string | null>(null);
  const [status, setStatus] = useState<SubscriptionStatus>("sem_assinatura");
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [trialStartedAt, setTrialStartedAt] = useState<string | null>(null);
  const [trialPlanRaw, setTrialPlanRaw] = useState<string | null>(null);
  const [trialUsed, setTrialUsed] = useState(false);
  const [cancelledAt, setCancelledAt] = useState<string | null>(null);
  const [accessUntil, setAccessUntil] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [paymentAmountCents, setPaymentAmountCents] = useState<number | null>(null);
  const [paidAt, setPaidAt] = useState<string | null>(null);
  const [periodicidade, setPeriodicidade] = useState<string | null>(null);
  const [currentPeriodStart, setCurrentPeriodStart] = useState<string | null>(null);
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const isAdminMaster = isAdminMasterEmail(user?.email);

  const load = useCallback(async () => {
    if (authLoading) return;
    if (!user) {
      setStoredRaw(null);
      setStatus("sem_assinatura");
      setTrialEndsAt(null);
      setTrialStartedAt(null);
      setTrialPlanRaw(null);
      setTrialUsed(false);
      setCancelledAt(null);
      setAccessUntil(null);
      setPaymentMethod(null);
      setPaymentAmountCents(null);
      setPaidAt(null);
      setPeriodicidade(null);
      setCurrentPeriodStart(null);
      setCurrentPeriodEnd(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await getCurrentUserSubscription();
      setStoredRaw(data.storedPlan);
      setStatus(data.status);
      setTrialEndsAt(data.trialEndsAt);
      setTrialStartedAt(data.trialStartedAt);
      setTrialPlanRaw(data.trialPlan);
      setTrialUsed(data.trialUsed);
      setCancelledAt(data.cancelledAt);
      setAccessUntil(data.accessUntil);
      setPaymentMethod(data.paymentMethod);
      setPaymentAmountCents(data.paymentAmountCents);
      setPaidAt(data.paidAt);
      setPeriodicidade(data.periodicidade);
      setCurrentPeriodStart(data.currentPeriodStart);
      setCurrentPeriodEnd(data.currentPeriodEnd);
    } catch (error) {
      console.info("[usePlan] assinatura não encontrada", {
        userId: user.id,
        email: user.email,
        reason: error instanceof Error ? error.message : String(error),
      });
      setStoredRaw(null);
      setStatus("sem_assinatura");
      setTrialEndsAt(null);
      setTrialStartedAt(null);
      setTrialPlanRaw(null);
      setTrialUsed(false);
      setCancelledAt(null);
      setAccessUntil(null);
      setPaymentMethod(null);
      setPaymentAmountCents(null);
      setPaidAt(null);
      setPeriodicidade(null);
      setCurrentPeriodStart(null);
      setCurrentPeriodEnd(null);
    }
    setLoading(false);
  }, [user, authLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  const trialPlan = asTrialPlan(trialPlanRaw);

  // Janela do teste
  const now = Date.now();
  const trialEndMs = trialEndsAt ? new Date(trialEndsAt).getTime() : 0;
  const isTrialActive =
    !!trialPlan && !!trialEndsAt && trialEndMs > now;
  const trialDaysLeft = isTrialActive
    ? Math.max(0, Math.ceil((trialEndMs - now) / 86_400_000))
    : 0;

  // Cancelamento: o usuário continua com acesso até access_until.
  const accessUntilMs = accessUntil ? new Date(accessUntil).getTime() : 0;
  const isCancelled = !!cancelledAt;
  const cancelledStillActive = isCancelled && accessUntilMs > now;
  const cancelledExpired = isCancelled && accessUntilMs > 0 && accessUntilMs <= now;

  // Período pago (30 dias após aprovação). Se estourou, vira expirado.
  const periodEndMs = currentPeriodEnd ? new Date(currentPeriodEnd).getTime() : 0;
  const periodExpired =
    !!currentPeriodEnd && periodEndMs > 0 && periodEndMs <= now && status === "ativo";

  const storedPlan: PlanTier = getEffectiveUserPlan({ email: null }, storedRaw);
  let plan: PlanTier;
  if (isAdminMaster) plan = "admin_master";
  else if (isTrialActive && trialPlan) plan = trialPlan;
  else if (cancelledExpired) plan = "sem_assinatura";
  else plan = storedPlan;

  // Status efetivo
  let effectiveStatus: SubscriptionStatus = status;
  if (isAdminMaster) effectiveStatus = "ativo";
  else if (isTrialActive) effectiveStatus = "teste";
  else if (cancelledExpired) effectiveStatus = "expirado";
  else if (cancelledStillActive) effectiveStatus = "cancelado";
  else if (periodExpired) effectiveStatus = "expirado";
  else if (storedPlan === "sem_assinatura") effectiveStatus = "sem_assinatura";

  const hasActiveAccess =
    isAdminMaster ||
    (effectiveStatus === "ativo" && !periodExpired) ||
    effectiveStatus === "teste" ||
    cancelledStillActive;

  return {
    plan,
    storedPlan,
    status: effectiveStatus,
    trialEndsAt: isAdminMaster ? null : trialEndsAt,
    trialStartedAt: isAdminMaster ? null : trialStartedAt,
    trialPlan: isAdminMaster ? null : trialPlan,
    trialUsed,
    isTrialActive: !isAdminMaster && isTrialActive,
    trialDaysLeft,
    cancelledAt: isAdminMaster ? null : cancelledAt,
    accessUntil: isAdminMaster ? null : accessUntil,
    paymentMethod: isAdminMaster ? null : paymentMethod,
    paymentAmountCents: isAdminMaster ? null : paymentAmountCents,
    paidAt: isAdminMaster ? null : paidAt,
    periodicidade: isAdminMaster ? null : periodicidade,
    isCancelled: !isAdminMaster && cancelledStillActive,
    currentPeriodStart: isAdminMaster ? null : currentPeriodStart,
    currentPeriodEnd: isAdminMaster ? null : currentPeriodEnd,
    loading,
    isAdminMaster,
    refresh: load,
    can: (feature) =>
      isAdminMaster
        ? true
        : hasActiveAccess && planAllowsFeature(plan, feature),
  };
}

/**
 * Inicia o teste gratuito de 10 dias para o plano informado.
 * Só pode ser usado uma única vez por usuário.
 */
export async function startTrial(
  userId: string,
  planoEscolhido: PlanTier,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!TRIAL_PLAN_VALUES.includes(planoEscolhido)) {
    return { ok: false, reason: "Plano inválido para teste." };
  }
  // Carregar estado atual
  const { data: current } = await supabase
    .from("user_plans")
    .select("trial_used, plano, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (current?.trial_used) {
    return { ok: false, reason: "Você já utilizou o teste gratuito." };
  }
  const startISO = new Date().toISOString();
  const endISO = new Date(Date.now() + 10 * 86_400_000).toISOString();

  if (current) {
    const { error } = await supabase
      .from("user_plans")
      .update({
        trial_plan_type: planoEscolhido,
        trial_started_at: startISO,
        trial_ends_at: endISO,
        trial_used: true,
        status: "teste",
      })
      .eq("user_id", userId);
    if (error) return { ok: false, reason: error.message };
  } else {
    const { error } = await supabase.from("user_plans").insert({
      user_id: userId,
      plano: "free",
      status: "teste",
      trial_plan_type: planoEscolhido,
      trial_started_at: startISO,
      trial_ends_at: endISO,
      trial_used: true,
    });
    if (error) return { ok: false, reason: error.message };
  }
  return { ok: true };
}
