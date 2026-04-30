import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useRoles } from "@/lib/use-roles";
import {
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
  /** Pode acessar o recurso? Considera owner = admin_master automaticamente. */
  can: (feature: FeatureKey) => boolean;
};

/**
 * Lê o plano efetivo do usuário. Owner sempre tem `admin_master`,
 * independentemente do que estiver gravado em `user_plans`.
 */
export function usePlan(): PlanState {
  const { user, loading: authLoading } = useAuth();
  const { isOwner, loading: rolesLoading } = useRoles();
  const [plan, setPlan] = useState<PlanTier>("free");
  const [status, setStatus] = useState<SubscriptionStatus>("ativo");
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (authLoading || rolesLoading) return;
      if (!user) {
        setPlan("free");
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
      // Owner sempre vê admin_master (mesmo se a row dele tem outro plano).
      if (isOwner) {
        setPlan("admin_master");
        setStatus("ativo");
        setTrialEndsAt(null);
      } else if (data) {
        setPlan(data.plano as PlanTier);
        setStatus(data.status as SubscriptionStatus);
        setTrialEndsAt(data.trial_ends_at ?? null);
      } else {
        // Usuário antigo sem registro: tratar como free/ativo.
        setPlan("free");
        setStatus("ativo");
        setTrialEndsAt(null);
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, rolesLoading, isOwner]);

  return {
    plan,
    status,
    trialEndsAt,
    loading,
    can: (feature) => planAllowsFeature(plan, feature),
  };
}
