import { useCallback, useSyncExternalStore } from "react";

// Memory-only controller. Its lifetime follows the key, not route subscribers.
const INACTIVITY_MS = 5 * 60 * 1000;
const HIDDEN_LOCK_MS = 60 * 1000;
let cachedKey: CryptoKey | null = null;
let owner: string | null = null;
let sessionExpiresAt = 0;
let lastActivity = 0;
let hiddenSince: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let watching = false;
const listeners = new Set<() => void>();
type Secret = { username?: string; password?: string; notes?: string };
const secretCache = new Map<string, Secret>();
function emit() {
  for (const listener of listeners) listener();
}
function stopWatching() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (!watching) return;
  window.removeEventListener("pointerdown", bumpActivity);
  window.removeEventListener("keydown", bumpActivity);
  document.removeEventListener("visibilitychange", onVisibility);
  watching = false;
}
function clearKey(notify = true) {
  const changed = cachedKey !== null;
  cachedKey = null;
  hiddenSince = null;
  secretCache.clear();
  stopWatching();
  if (changed) {
    if (notify) emit();
    else queueMicrotask(emit); // Snapshot reads must not update another component during render.
  }
}
function deadline() {
  return Math.min(
    lastActivity + INACTIVITY_MS,
    sessionExpiresAt,
    hiddenSince === null ? Infinity : hiddenSince + HIDDEN_LOCK_MS,
  );
}
function valid(notify = true) {
  if (cachedKey && (!owner || Date.now() >= deadline())) clearKey(notify);
  return cachedKey;
}
function schedule() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (!valid()) return;
  timer = setTimeout(
    () => {
      if (valid()) schedule();
    },
    Math.max(1, deadline() - Date.now()),
  );
}
function onVisibility() {
  // Validate before resetting timestamps: delayed foreground events cannot revive a key.
  if (!valid()) return;
  if (document.visibilityState === "hidden") hiddenSince ??= Date.now();
  else {
    hiddenSince = null;
    lastActivity = Date.now();
  }
  schedule();
}
function startWatching() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  window.addEventListener("pointerdown", bumpActivity);
  window.addEventListener("keydown", bumpActivity);
  document.addEventListener("visibilitychange", onVisibility);
}

/** Called synchronously by the persistent AuthProvider before publishing auth state. */
export function setVaultSession(session: { user: { id: string }; expires_at?: number } | null) {
  valid();
  const nextOwner = session?.user.id ?? null;
  const expiresAt = (session?.expires_at ?? 0) * 1000;
  if (nextOwner !== owner || expiresAt <= Date.now()) clearKey();
  owner = nextOwner;
  sessionExpiresAt = expiresAt;
  schedule();
}
export function setMasterKey(key: CryptoKey | null, userId?: string) {
  if (!key) {
    clearKey();
    return;
  }
  // Reject an asynchronous unlock completed after logout or an account switch.
  if (!owner || userId !== owner || sessionExpiresAt <= Date.now()) {
    throw new Error("A sessão do Cofre mudou ou expirou. Desbloqueie novamente.");
  }
  secretCache.clear();
  cachedKey = key;
  lastActivity = Date.now();
  hiddenSince =
    typeof document !== "undefined" && document.visibilityState === "hidden" ? Date.now() : null;
  startWatching();
  schedule();
  emit();
}
export function getMasterKey(): CryptoKey | null {
  return valid(false);
}
export function bumpActivity() {
  if (!valid() || document.visibilityState === "hidden") return;
  lastActivity = Date.now();
  schedule();
}
export function getCachedSecret(id: string): Secret | undefined {
  return valid(false) ? secretCache.get(id) : undefined;
}
export function setCachedSecret(id: string, secret: Secret, key: CryptoKey) {
  if (valid() === key) secretCache.set(id, secret);
}
export function clearSecretCache() {
  secretCache.clear();
}
export function evictCached(id: string) {
  secretCache.delete(id);
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const serverSnapshot = () => null;
export function useVaultKey() {
  const masterKey = useSyncExternalStore(subscribe, getMasterKey, serverSnapshot);
  const lock = useCallback(() => setMasterKey(null), []);
  return { masterKey, isUnlocked: !!masterKey, lock };
}
