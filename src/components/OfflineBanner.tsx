import { useEffect, useRef } from "react";
import { WifiOff } from "lucide-react";
import { toast } from "sonner";
import { useOnlineStatus } from "@/lib/use-online-status";

/**
 * Discreet banner + toasts for connectivity changes.
 * - Starts hidden (assumes online) — no flash on load.
 * - Only appears after a confirmed offline state.
 * - Auto-dismisses when connectivity returns.
 * - Never logs out, redirects, or clears session.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      toast.error("Você está sem conexão. Algumas funções podem ficar indisponíveis.", {
        id: "offline-status",
        duration: 4000,
      });
    } else if (wasOffline.current) {
      wasOffline.current = false;
      toast.success("Conexão restabelecida.", { id: "offline-status", duration: 2500 });
    }
  }, [online]);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 border-b border-border bg-muted/95 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-muted/70"
    >
      <WifiOff className="h-3.5 w-3.5" />
      <span>Você está sem conexão. Algumas funções podem ficar indisponíveis.</span>
    </div>
  );
}
