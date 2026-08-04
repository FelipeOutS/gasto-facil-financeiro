import { useEffect, useState, useCallback, useRef } from "react";

// Master key kept in-memory only. Auto-lock on inactivity OR on losing visibility
// for too long. Logout (handled elsewhere) must also call setMasterKey(null).

let cachedKey: CryptoKey | null = null;
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

const INACTIVITY_MS = 5 * 60 * 1000;
const HIDDEN_LOCK_MS = 60 * 1000;
let lastActivity = Date.now();
let hiddenSince: number | null = null;

// In-memory cache of decrypted secrets per entry id. Lives only while
// the vault is unlocked; cleared on lock.
type Secret = { username?: string; password?: string; notes?: string };
const secretCache = new Map<string, Secret>();

export function getCachedSecret(id: string): Secret | undefined {
  return secretCache.get(id);
}
export function setCachedSecret(id: string, s: Secret) {
  secretCache.set(id, s);
}
export function clearSecretCache() {
  secretCache.clear();
}
export function evictCached(id: string) {
  secretCache.delete(id);
}

export function setMasterKey(key: CryptoKey | null) {
  cachedKey = key;
  lastActivity = Date.now();
  hiddenSince = null;
  if (!key) clearSecretCache();
  emit();
}
export function getMasterKey(): CryptoKey | null {
  return cachedKey;
}
export function bumpActivity() {
  lastActivity = Date.now();
}

export function useVaultKey(): {
  masterKey: CryptoKey | null;
  isUnlocked: boolean;
  lock: () => void;
} {
  const [, force] = useState(0);
  useEffect(() => {
    const cb = () => force((n) => n + 1);
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);

  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    function tick() {
      if (cachedKey) {
        const inactive = Date.now() - lastActivity > INACTIVITY_MS;
        const hiddenTooLong = hiddenSince !== null && Date.now() - hiddenSince > HIDDEN_LOCK_MS;
        if (inactive || hiddenTooLong) setMasterKey(null);
      }
      timerRef.current = window.setTimeout(tick, 15_000);
    }
    timerRef.current = window.setTimeout(tick, 15_000);

    const onActivity = () => {
      if (cachedKey) lastActivity = Date.now();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenSince = Date.now();
      } else {
        // Returning to foreground: check immediately
        if (cachedKey && hiddenSince !== null && Date.now() - hiddenSince > HIDDEN_LOCK_MS) {
          setMasterKey(null);
        }
        hiddenSince = null;
        lastActivity = Date.now();
      }
    };

    window.addEventListener("pointerdown", onActivity);
    window.addEventListener("keydown", onActivity);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const lock = useCallback(() => setMasterKey(null), []);
  return { masterKey: cachedKey, isUnlocked: !!cachedKey, lock };
}
