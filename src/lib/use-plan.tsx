import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
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
  /** Recarrega plano e status do banco (após escolher plano, etc.). */
  refresh: () => Promise<void>;
  /** Pode acessar o recurso? Considera Admin Master e status. */
  can: (feature: FeatureKey) => boolean;
};

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
  const [loading, setLoading] = useState(true);

  const isAdminMaster = isAdminMasterEmail(user?.email);

  const load = useCallback(async () => {
    if (authLoading) return;
    if (!user) {
      setStoredRaw(null);
      setStatus("sem_assinatura");
      setTrialEndsAt(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("user_plans")
      .select("plano, status, trial_ends_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (data) {
      setStoredRaw(String(data.plano ?? ""));
      setStatus((data.status as SubscriptionStatus) ?? "sem_assinatura");
      setTrialEndsAt(data.trial_ends_at ?? null);
    } else {
      setStoredRaw(null);
      setStatus("sem_assinatura");
      setTrialEndsAt(null);
    }
    setLoading(false);
  }, [user, authLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  const plan: PlanTier = getEffectiveUserPlan(user, storedRaw);
  const storedPlan: PlanTier = getEffectiveUserPlan({ email: null }, storedRaw);

  // Status efetivo: Admin Master sempre ativo. Se não há plano comercial
  // salvo, força "sem_assinatura" mesmo que o banco diga "ativo" (registros legados com Free).
  let effectiveStatus: SubscriptionStatus = status;
  if (isAdminMaster) effectiveStatus = "ativo";
  else if (storedPlan === "sem_assinatura") effectiveStatus = "sem_assinatura";

  // Bloqueio de recursos: só libera se status é ativo, teste ou admin.
  const hasActiveAccess =
    isAdminMaster || effectiveStatus === "ativo" || effectiveStatus === "teste";

  return {
    plan,
    storedPlan,
    status: effectiveStatus,
    trialEndsAt: isAdminMaster ? null : trialEndsAt,
    loading,
    isAdminMaster,
    refresh: load,
    can: (feature) =>
      isAdminMaster
        ? true
        : hasActiveAccess && planAllowsFeature(plan, feature),
  };
}
