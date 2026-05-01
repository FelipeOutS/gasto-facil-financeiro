import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { fetchOnboarding, saveOnboarding, resetOnboarding } from "./service";
import type { OnboardingState } from "./types";

export function useOnboarding() {
  const { user } = useAuth();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) {
      setState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const s = await fetchOnboarding(user.id);
      setState(s);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (patch: Partial<Omit<OnboardingState, "user_id">>) => {
      if (!user) return null;
      const next = await saveOnboarding(user.id, patch);
      setState(next);
      return next;
    },
    [user],
  );

  const reset = useCallback(async () => {
    if (!user) return;
    await resetOnboarding(user.id);
    await reload();
  }, [user, reload]);

  return { state, loading, save, reset, reload };
}
