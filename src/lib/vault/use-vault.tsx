import { useEffect, useState, useCallback, useRef } from "react";

// Master key kept in-memory only. Sessions auto-lock after inactivity.
let cachedKey: CryptoKey | null = null;
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

const INACTIVITY_MS = 5 * 60 * 1000; // 5 min
let lastActivity = Date.now();

export function setMasterKey(key: CryptoKey | null) {
  cachedKey = key;
  lastActivity = Date.now();
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

  // Inactivity auto-lock
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    function tick() {
      if (cachedKey && Date.now() - lastActivity > INACTIVITY_MS) {
        setMasterKey(null);
      }
      timerRef.current = window.setTimeout(tick, 30_000);
    }
    timerRef.current = window.setTimeout(tick, 30_000);
    const onActivity = () => {
      if (cachedKey) lastActivity = Date.now();
    };
    window.addEventListener("pointerdown", onActivity);
    window.addEventListener("keydown", onActivity);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, []);

  const lock = useCallback(() => setMasterKey(null), []);
  return { masterKey: cachedKey, isUnlocked: !!cachedKey, lock };
}
