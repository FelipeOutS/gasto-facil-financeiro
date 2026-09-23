import { useEffect, useState } from "react";
import { fetchVaultSettings, type VaultSettingsRow } from "./service";

export type VaultBootstrapState = "loading" | "needs_setup" | "needs_unlock" | "ready" | "error";
export const VAULT_SETTINGS_TIMEOUT_MS = 15000;

export function useVaultBootstrap(userId: string | undefined, isUnlocked: boolean) {
  const [bootstrapState, setBootstrapState] = useState<VaultBootstrapState>("loading");
  const [settings, setSettings] = useState<VaultSettingsRow | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    setBootstrapState("loading");
    const timer = setTimeout(() => {
      if (!active) return;
      active = false;
      setBootstrapState("error");
    }, VAULT_SETTINGS_TIMEOUT_MS);
    fetchVaultSettings(userId)
      .then((row) => {
        if (!active) return;
        setSettings(row);
        setBootstrapState(row === null ? "needs_setup" : isUnlocked ? "ready" : "needs_unlock");
      })
      .catch(() => {
        // Unknown is not absent. Keep cached settings and the key untouched.
        if (active) setBootstrapState("error");
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [userId, isUnlocked, attempt]);
  return {
    bootstrapState,
    setBootstrapState,
    settings,
    setSettings,
    retry: () => {
      setBootstrapState("loading");
      setAttempt((value) => value + 1);
    },
  };
}
