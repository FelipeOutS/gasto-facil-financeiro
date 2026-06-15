import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { getCurrentUserSubscription } from "@/lib/subscription.functions";
import {
  getEffectiveUserPlan,
  isAdminMasterEmail,
  isPlanAvailableForNewSubscriptions,
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
type CachedSubscription = {
  storedPlan: string | null;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  trialStartedAt: string | null;
  trialPlan: string | null;
  trialUsed: boolean;
  cancelledAt: string | null;
  accessUntil: string | null;
  paymentMethod: string | null;
  paymentAmountCents: number | null;
  paidAt: string | null;
  periodicidade: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
};

const CACHE_PREFIX = "gf-plan-cache:";
const RUNTIME_CACHE_TTL_MS = 5 * 60_000;

let runtimeSubscriptionCache:
  | { userId: string; value: CachedSubscription; loadedAt: number }
  | null = null;
let runtimeSubscriptionInFlight:
  | { userId: string; promise: Promise<CachedSubscription> }
  | null = null;

function getRuntimeCache(userId: string): CachedSubscription | null {
  if (
    runtimeSubscriptionCache?.userId === userId &&
    Date.now() - runtimeSubscriptionCache.loadedAt < RUNTIME_CACHE_TTL_MS
  ) {
    return runtimeSubscriptionCache.value;
  }
  return null;
}

function rememberRuntimeCache(userId: string, value: CachedSubscription) {
  runtimeSubscriptionCache = { userId, value, loadedAt: Date.now() };
  writeCache(userId, value);
}

function readCache(userId: string): CachedSubscription | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + userId);
    if (!raw) return null;
    return JSON.parse(raw) as CachedSubscription;
  } catch {
    return null;
  }
}

function writeCache(userId: string, value: CachedSubscription) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_PREFIX + userId, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function usePlan(): PlanState {
  const { user, loading: authLoading } = useAuth();
  const initialCache = user ? getRuntimeCache(user.id) ?? readCache(user.id) : null;
  const [storedRaw, setStoredRaw] = useState<string | null>(initialCache?.storedPlan ?? null);
  const [status, setStatus] = useState<SubscriptionStatus>(initialCache?.status ?? "sem_assinatura");
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(initialCache?.trialEndsAt ?? null);
  const [trialStartedAt, setTrialStartedAt] = useState<string | null>(initialCache?.trialStartedAt ?? null);
  const [trialPlanRaw, setTrialPlanRaw] = useState<string | null>(initialCache?.trialPlan ?? null);
  const [trialUsed, setTrialUsed] = useState(initialCache?.trialUsed ?? false);
  const [cancelledAt, setCancelledAt] = useState<string | null>(initialCache?.cancelledAt ?? null);
  const [accessUntil, setAccessUntil] = useState<string | null>(initialCache?.accessUntil ?? null);
  const [paymentMethod, setPaymentMethod] = useState<string | null>(initialCache?.paymentMethod ?? null);
  const [paymentAmountCents, setPaymentAmountCents] = useState<number | null>(initialCache?.paymentAmountCents ?? null);
  const [paidAt, setPaidAt] = useState<string | null>(initialCache?.paidAt ?? null);
  const [periodicidade, setPeriodicidade] = useState<string | null>(initialCache?.periodicidade ?? null);
  const [currentPeriodStart, setCurrentPeriodStart] = useState<string | null>(initialCache?.currentPeriodStart ?? null);
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(initialCache?.currentPeriodEnd ?? null);
  // `loading` é true APENAS na primeiríssima carga (sem cache). Revalidações
  // ficam em segundo plano e mantêm o último estado válido para evitar
  // o "piscar" entre liberado/bloqueado durante a navegação.
  const [loading, setLoading] = useState(!initialCache);
  const [hydratedUserId, setHydratedUserId] = useState<string | null>(initialCache && user ? user.id : null);

  const isAdminMaster = isAdminMasterEmail(user?.email);

  const applyCached = useCallback((cached: CachedSubscription) => {
    setStoredRaw(cached.storedPlan);
    setStatus(cached.status);
    setTrialEndsAt(cached.trialEndsAt);
    setTrialStartedAt(cached.trialStartedAt);
    setTrialPlanRaw(cached.trialPlan);
    setTrialUsed(cached.trialUsed);
    setCancelledAt(cached.cancelledAt);
    setAccessUntil(cached.accessUntil);
    setPaymentMethod(cached.paymentMethod);
    setPaymentAmountCents(cached.paymentAmountCents);
    setPaidAt(cached.paidAt);
    setPeriodicidade(cached.periodicidade);
    setCurrentPeriodStart(cached.currentPeriodStart);
    setCurrentPeriodEnd(cached.currentPeriodEnd);
  }, []);

  // Hidratação síncrona a partir do cache local (evita "Verificando...").
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setHydratedUserId(null);
      return;
    }
    if (hydratedUserId === user.id) return;
    const cached = getRuntimeCache(user.id) ?? readCache(user.id);
    if (cached) {
      applyCached(cached);
      setLoading(false);
    }
    setHydratedUserId(user.id);
  }, [user, authLoading, hydratedUserId, applyCached]);

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
    // Não força loading se já temos algum estado hidratado: revalida em
    // segundo plano mantendo o último resultado válido.
    const runtimeCached = getRuntimeCache(user.id);
    if (runtimeCached) {
      applyCached(runtimeCached);
      setLoading(false);
      return;
    }

    const hasCache = !!readCache(user.id);
    if (!hasCache) setLoading(true);
    try {
      const data = await (runtimeSubscriptionInFlight?.userId === user.id
        ? runtimeSubscriptionInFlight.promise
        : (() => {
            const promise = getCurrentUserSubscription().then((subscription) => ({
              storedPlan: subscription.storedPlan,
              status: subscription.status,
              trialEndsAt: subscription.trialEndsAt,
              trialStartedAt: subscription.trialStartedAt,
              trialPlan: subscription.trialPlan,
              trialUsed: subscription.trialUsed,
              cancelledAt: subscription.cancelledAt,
              accessUntil: subscription.accessUntil,
              paymentMethod: subscription.paymentMethod,
              paymentAmountCents: subscription.paymentAmountCents,
              paidAt: subscription.paidAt,
              periodicidade: subscription.periodicidade,
              currentPeriodStart: subscription.currentPeriodStart,
              currentPeriodEnd: subscription.currentPeriodEnd,
            }));
            runtimeSubscriptionInFlight = { userId: user.id, promise };
            promise.finally(() => {
              if (runtimeSubscriptionInFlight?.promise === promise) {
                runtimeSubscriptionInFlight = null;
              }
            });
            return promise;
          })());
      applyCached(data);
      rememberRuntimeCache(user.id, {
        storedPlan: data.storedPlan,
        status: data.status,
        trialEndsAt: data.trialEndsAt,
        trialStartedAt: data.trialStartedAt,
        trialPlan: data.trialPlan,
        trialUsed: data.trialUsed,
        cancelledAt: data.cancelledAt,
        accessUntil: data.accessUntil,
        paymentMethod: data.paymentMethod,
        paymentAmountCents: data.paymentAmountCents,
        paidAt: data.paidAt,
        periodicidade: data.periodicidade,
        currentPeriodStart: data.currentPeriodStart,
        currentPeriodEnd: data.currentPeriodEnd,
      });
    } catch (error) {
      // Mantém o último estado válido em caso de erro de rede/refetch:
      // não voltamos para "sem_assinatura" só porque a revalidação falhou.
      console.info("[usePlan] revalidação falhou, mantendo último estado", {
        userId: user.id,
        email: user.email,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    setLoading(false);
  }, [user, authLoading, applyCached]);

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
  if (!isPlanAvailableForNewSubscriptions(planoEscolhido)) {
    return { ok: false, reason: "Este plano não está mais disponível para novas assinaturas." };
  }
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
