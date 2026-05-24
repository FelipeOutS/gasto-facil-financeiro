import { useEffect, useRef, useState } from "react";

/**
 * Online detection with active probing.
 *
 * - Starts as `true` to avoid false-offline flashes on load.
 * - Uses `navigator.onLine` only as a hint (it lies in iframes / WebViews).
 * - Confirms offline with a real `fetch` to /api/health (with timeout).
 * - Requires multiple consecutive probe failures before declaring offline.
 */

const HEALTH_URL = "/api/health";
const PROBE_TIMEOUT_MS = 3000;
const FAILURES_TO_OFFLINE = 2;

async function probe(): Promise<boolean> {
  if (typeof fetch === "undefined") return true;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${HEALTH_URL}?t=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
      credentials: "same-origin",
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function useOnlineStatus(): boolean {
  // Assume online until proven otherwise — prevents false-offline on first paint.
  const [online, setOnline] = useState<boolean>(true);
  const failuresRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const confirm = async () => {
      const ok = await probe();
      if (cancelled) return;
      if (ok) {
        failuresRef.current = 0;
        setOnline(true);
      } else {
        failuresRef.current += 1;
        if (failuresRef.current >= FAILURES_TO_OFFLINE) {
          setOnline(false);
        }
      }
    };

    const handleOffline = () => {
      // Browser hint says offline — verify with a probe before flipping UI.
      void confirm();
    };
    const handleOnline = () => {
      failuresRef.current = 0;
      setOnline(true);
      void confirm();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // If the browser already thinks we're offline at mount, verify it.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      void confirm();
    }

    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return online;
}

/**
 * Synchronous best-effort check usable inside event handlers.
 * Only returns false when the browser is confidently offline.
 */
export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

/**
 * Confirms connectivity with a real network probe before allowing an action.
 * Returns true when online; otherwise shows a friendly toast and returns false.
 *
 * Use ONLY on actions that genuinely require the network
 * (save expense, import, AI, payment, WhatsApp, sync, etc.).
 */
export async function requireOnline(message?: string): Promise<boolean> {
  const msg = message ?? "Sem conexão no momento. Tente novamente quando a internet voltar.";
  // Fast path: browser is confident we're offline.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    try {
      const { toast } = await import("sonner");
      toast.error(msg);
    } catch {
      /* noop */
    }
    return false;
  }
  // Otherwise verify with a real probe.
  const ok = await probe();
  if (!ok) {
    try {
      const { toast } = await import("sonner");
      toast.error(msg);
    } catch {
      /* noop */
    }
  }
  return ok;
}
