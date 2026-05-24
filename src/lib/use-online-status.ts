import { useEffect, useState } from "react";

/**
 * Tracks browser online/offline status.
 * SSR-safe: defaults to `true` when `navigator` is unavailable.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() => {
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    // Sync once on mount (covers WebView edge cases)
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}

/** Synchronous check usable inside event handlers. */
export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

/**
 * Guard for actions that require connectivity.
 * Returns true when online; otherwise shows a friendly toast and returns false.
 */
export async function requireOnline(message?: string): Promise<boolean> {
  if (isOnline()) return true;
  try {
    const { toast } = await import("sonner");
    toast.error(message ?? "Sem conexão no momento. Tente novamente quando a internet voltar.");
  } catch {
    /* noop */
  }
  return false;
}
