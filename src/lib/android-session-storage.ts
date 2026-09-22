import type { SupportedStorage } from "@supabase/supabase-js";

/** Native biometric sessions live in Keystore-backed storage. The unlocked SDK
 * session stays in memory; reloading the WebView requires unlocking again. */
export function androidSessionStorage(
  fallback: SupportedStorage | undefined,
  enabled = typeof window !== "undefined" && !!window.AndroidSecureSession,
): SupportedStorage | undefined {
  if (!enabled) return fallback;
  const values = new Map<string, string>();
  function discardLegacy(key: string) {
    try {
      void Promise.resolve(fallback?.removeItem(key)).catch(() => undefined);
    } catch {
      /* Inaccessible legacy storage must not prevent memory-only auth. */
    }
  }
  discardLegacy("app_android_biometric_session");
  return {
    getItem(key) {
      discardLegacy(key);
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      discardLegacy(key);
      values.set(key, value);
    },
    removeItem(key) {
      discardLegacy(key);
      values.delete(key);
    },
  };
}
