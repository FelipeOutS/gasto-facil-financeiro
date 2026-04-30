import { useEffect, useState } from "react";
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
  /** Pode acessar o recurso? Considera Admin Master automaticamente. */
  can: (feature: FeatureKey) => boolean;
};

/**
 * Lê o plano efetivo do usuário, sempre passando pela regra central
 * `getEffectiveUserPlan(user, storedPlan)`. Admin Master por e-mail
 * tem precedência absoluta sobre qualquer valor salvo.
 */
export function usePlan(): PlanState {
  const { user, loading: authLoading } = useAuth();
  const [storedPlan, setStoredPlan] = useState<string | null>(null);
  const [status, setStatus] = useState<SubscriptionStatus>("ativo");
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const isAdminMaster = isAdminMasterEmail(user?.email);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (authLoading) return;
      if (!user) {
        setStoredPlan(null);
        setStatus("ativo");
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
      if (cancelled) return;
      if (data) {
        setStoredPlan(String(data.plano ?? ""));
        setStatus((data.status as SubscriptionStatus) ?? "ativo");
        setTrialEndsAt(data.trial_ends_at ?? null);
      } else {
        setStoredPlan(null);
        setStatus("ativo");
        setTrialEndsAt(null);
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const plan: PlanTier = getEffectiveUserPlan(user, storedPlan);

  return {
    plan,
    status: isAdminMaster ? "ativo" : status,
    trialEndsAt: isAdminMaster ? null : trialEndsAt,
    loading,
    isAdminMaster,
    can: (feature) => planAllowsFeature(plan, feature),
  };
}
