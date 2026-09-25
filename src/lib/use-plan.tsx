import { useCallback, useEffect, useRef, useState } from "react";
import { resolveSubscriptionAccess } from "@/lib/subscription-access";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { isLocalDevPreview } from "@/lib/local-dev-preview";
import { getCurrentUserSubscription } from "@/lib/subscription.functions";
import {
  getEffectiveUserPlan,
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
  error: string | null;
  active: boolean;
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
 * do servidor e revalidando as datas com resolveSubscriptionAccess.
 */
type CachedSubscription = {
  active?: boolean;
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

// Não persiste em cache nem altera assinatura: só libera a interface no Vite local.
const LOCAL_PREVIEW_SUBSCRIPTION: CachedSubscription = {
  active: true,
  storedPlan: "pessoal_premium",
  status: "ativo",
  trialEndsAt: null,
  trialStartedAt: null,
  trialPlan: null,
  trialUsed: false,
  cancelledAt: null,
  accessUntil: null,
  paymentMethod: null,
  paymentAmountCents: null,
  paidAt: null,
  periodicidade: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
};

const CACHE_PREFIX = "gf-plan-cache:";
const RUNTIME_CACHE_TTL_MS = 5 * 60_000;

let runtimeSubscriptionCache: {
  userId: string;
  value: CachedSubscription;
  loadedAt: number;
} | null = null;
let runtimeSubscriptionInFlight: { userId: string; promise: Promise<CachedSubscription> } | null =
  null;

type SubscriptionUpdate = {
  userId: string;
  pending: boolean;
  data?: CachedSubscription | null;
  error?: string | null;
};
const subscriptionListeners = new Set<(update: SubscriptionUpdate) => void>();
function publishSubscription(update: SubscriptionUpdate) {
  for (const listener of subscriptionListeners) listener(update);
}

function getRuntimeCache(userId: string): CachedSubscription | null {
  if (runtimeSubscriptionInFlight?.userId === userId) return null;
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
  publishSubscription({ userId, data: value, pending: false, error: null });
}

function readCache(userId: string): CachedSubscription | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + userId);
    if (!raw) return null;
    const value = JSON.parse(raw);
    return value && typeof value.status === "string" && typeof value.storedPlan === "string"
      ? (value as CachedSubscription)
      : null;
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
  const userId = user?.id ?? null;
  const localPreview =
    !!userId &&
    typeof window !== "undefined" &&
    isLocalDevPreview(
      import.meta.env.DEV,
      import.meta.env.VITE_LOCAL_DEV_PREVIEW,
      window.location.hostname,
    );
  const initialCache = userId ? (getRuntimeCache(userId) ?? readCache(userId)) : null;
  const [snapshot, setSnapshot] = useState<{
    userId: string | null;
    data: CachedSubscription | null;
  }>({ userId, data: initialCache });
  const [pending, setPending] = useState(!userId || !getRuntimeCache(userId));
  const [error, setError] = useState<string | null>(null);
  const [clockVersion, tick] = useState(0);
  const identity = useRef(userId);
  identity.current = userId;
  const generation = useRef(0);

  useEffect(() => {
    const listener = (update: SubscriptionUpdate) => {
      if (update.userId !== identity.current) return;
      setPending(update.pending);
      if (!update.pending) setSnapshot({ userId: update.userId, data: update.data ?? null });
      setError(update.error ?? null);
    };
    subscriptionListeners.add(listener);
    return () => {
      subscriptionListeners.delete(listener);
    };
  }, []);

  const load = useCallback(
    async (force = false) => {
      if (authLoading) return;
      const request = ++generation.current;
      const current = () => request === generation.current && identity.current === userId;
      setError(null);
      if (!userId) {
        setSnapshot({ userId: null, data: null });
        setPending(false);
        return;
      }
      if (localPreview) {
        setPending(false);
        return;
      }
      const runtime = !force ? getRuntimeCache(userId) : null;
      if (runtime) {
        setSnapshot({ userId, data: runtime });
        setPending(false);
        return;
      }
      const cached = getRuntimeCache(userId) ?? readCache(userId);
      setPending(true);
      if (force) publishSubscription({ userId, pending: true });
      try {
        let promise =
          runtimeSubscriptionInFlight?.userId === userId
            ? runtimeSubscriptionInFlight.promise
            : null;
        if (!promise) {
          promise = getCurrentUserSubscription().then((subscription) => ({
            active: subscription.active,
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
          runtimeSubscriptionInFlight = { userId, promise };
          const clear = () => {
            if (runtimeSubscriptionInFlight?.promise === promise)
              runtimeSubscriptionInFlight = null;
          };
          // Two handlers avoid creating an unhandled rejected finally-promise.
          void promise.then(clear, clear);
        }
        const data = await promise;
        if (!current()) return;
        rememberRuntimeCache(userId, data);
        setSnapshot({ userId, data });
      } catch {
        if (!current()) return;
        // Preserve the existing last-valid snapshot fallback (including offline).
        // A cached denial is never evidence that a failed query found no plan.
        if (cached && cached.active !== false && resolveSubscriptionAccess(cached).active) {
          setSnapshot({ userId, data: cached });
          publishSubscription({ userId, data: cached, pending: false, error: null });
        } else {
          setSnapshot({ userId, data: null });
          const message = "Não foi possível verificar sua assinatura. Tente novamente.";
          setError(message);
          publishSubscription({ userId, data: null, pending: false, error: message });
        }
      } finally {
        if (current()) setPending(false);
      }
    },
    [userId, authLoading, localPreview],
  );

  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  const refresh = useCallback(() => load(true), [load]);
  const data = localPreview ? LOCAL_PREVIEW_SUBSCRIPTION : snapshot.userId === userId ? snapshot.data : null;
  const loading = authLoading || (!localPreview && (pending || snapshot.userId !== userId));
  const effectiveError = localPreview ? null : error;
  const access = resolveSubscriptionAccess({
    storedPlan: data?.storedPlan ?? null,
    status: data?.status ?? null,
    trialPlan: data?.trialPlan,
    trialEndsAt: data?.trialEndsAt,
    cancelledAt: data?.cancelledAt,
    accessUntil: data?.accessUntil,
    currentPeriodEnd: data?.currentPeriodEnd,
  });
  const active = !loading && !effectiveError && data?.active !== false && access.active;
  const isAdminMaster = active && access.plan === "admin_master";
  const trialPlan = asTrialPlan(data?.trialPlan);
  const trialEndMs = Date.parse(data?.trialEndsAt ?? "");

  // Expiration must revoke permissions even without a navigation or new fetch.
  // Focus/pageshow also cover suspended WebViews whose timers were paused.
  useEffect(() => {
    const remaining = Date.parse(access.expiresAt ?? "") - Date.now();
    const timer =
      access.active && Number.isFinite(remaining)
        ? setTimeout(() => tick((n) => n + 1), Math.max(0, Math.min(remaining, 2_147_483_647)))
        : undefined;
    const resume = () => tick((n) => n + 1);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [access.expiresAt, access.active, clockVersion]);

  return {
    plan: access.plan,
    storedPlan: getEffectiveUserPlan(null, data?.storedPlan),
    status: access.status,
    active,
    error: effectiveError,
    loading,
    isAdminMaster,
    trialEndsAt: isAdminMaster ? null : (data?.trialEndsAt ?? null),
    trialStartedAt: isAdminMaster ? null : (data?.trialStartedAt ?? null),
    trialPlan: isAdminMaster ? null : trialPlan,
    trialUsed: data?.trialUsed ?? false,
    isTrialActive: active && access.isTrialActive,
    trialDaysLeft: access.isTrialActive
      ? Math.max(0, Math.ceil((trialEndMs - Date.now()) / 86_400_000))
      : 0,
    cancelledAt: isAdminMaster ? null : (data?.cancelledAt ?? null),
    accessUntil: isAdminMaster ? null : (data?.accessUntil ?? null),
    paymentMethod: isAdminMaster ? null : (data?.paymentMethod ?? null),
    paymentAmountCents: isAdminMaster ? null : (data?.paymentAmountCents ?? null),
    paidAt: isAdminMaster ? null : (data?.paidAt ?? null),
    periodicidade: isAdminMaster ? null : (data?.periodicidade ?? null),
    isCancelled: active && access.isCancelled,
    currentPeriodStart: isAdminMaster ? null : (data?.currentPeriodStart ?? null),
    currentPeriodEnd: isAdminMaster ? null : (data?.currentPeriodEnd ?? null),
    refresh,
    can: (feature) => active && planAllowsFeature(access.plan, feature),
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
      plano: "free_ads",
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
