import { supabase } from "@/integrations/supabase/client";
import type { AccountType, GoalKey, ModuleKey, OnboardingState } from "./types";

// `user_onboarding` ainda não está nos types gerados — usamos cast para
// liberar acesso até o regen automático.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type Row = {
  user_id: string;
  account_type: string | null;
  goals: string[] | null;
  enabled_modules: string[] | null;
  recommended_plan: string | null;
  onboarding_completed: boolean;
  onboarding_completed_at: string | null;
};

function toState(row: Row | null, userId: string): OnboardingState {
  if (!row) {
    return {
      user_id: userId,
      account_type: null,
      goals: [],
      enabled_modules: [],
      recommended_plan: null,
      onboarding_completed: false,
      onboarding_completed_at: null,
    };
  }
  return {
    user_id: row.user_id,
    account_type: (row.account_type as AccountType | null) ?? null,
    goals: (row.goals ?? []) as GoalKey[],
    enabled_modules: (row.enabled_modules ?? []) as ModuleKey[],
    recommended_plan: (row.recommended_plan as OnboardingState["recommended_plan"]) ?? null,
    onboarding_completed: !!row.onboarding_completed,
    onboarding_completed_at: row.onboarding_completed_at,
  };
}

export async function fetchOnboarding(userId: string): Promise<OnboardingState> {
  const { data } = await sb
    .from("user_onboarding")
    .select(
      "user_id, account_type, goals, enabled_modules, recommended_plan, onboarding_completed, onboarding_completed_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  return toState((data as Row | null) ?? null, userId);
}

export async function saveOnboarding(
  userId: string,
  patch: Partial<Omit<OnboardingState, "user_id">>,
): Promise<OnboardingState> {
  const payload = {
    user_id: userId,
    ...(patch.account_type !== undefined && { account_type: patch.account_type }),
    ...(patch.goals !== undefined && { goals: patch.goals }),
    ...(patch.enabled_modules !== undefined && {
      enabled_modules: patch.enabled_modules,
    }),
    ...(patch.recommended_plan !== undefined && {
      recommended_plan: patch.recommended_plan,
    }),
    ...(patch.onboarding_completed !== undefined && {
      onboarding_completed: patch.onboarding_completed,
    }),
    ...(patch.onboarding_completed_at !== undefined && {
      onboarding_completed_at: patch.onboarding_completed_at,
    }),
  };
  const { data } = await sb
    .from("user_onboarding")
    .upsert(payload, { onConflict: "user_id" })
    .select(
      "user_id, account_type, goals, enabled_modules, recommended_plan, onboarding_completed, onboarding_completed_at",
    )
    .maybeSingle();
  return toState((data as Row | null) ?? null, userId);
}

export async function resetOnboarding(userId: string): Promise<void> {
  await sb.from("user_onboarding").upsert(
    {
      user_id: userId,
      onboarding_completed: false,
      onboarding_completed_at: null,
    },
    { onConflict: "user_id" },
  );
}
