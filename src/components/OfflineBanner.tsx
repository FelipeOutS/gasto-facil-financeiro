import { useEffect, useRef } from "react";
import { WifiOff } from "lucide-react";
import { toast } from "sonner";
import { useOnlineStatus } from "@/lib/use-online-status";

/**
 * Discreet top banner + toasts for connectivity changes.
 * Does NOT log the user out or clear session — purely informational.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (!online) {
        toast.error("Você está sem conexão. Algumas funções podem ficar indisponíveis.", {
          id: "offline-status",
          duration: 4000,
        });
      }
      return;
    }
    if (online) {
      toast.success("Conexão restabelecida.", { id: "offline-status", duration: 2500 });
    } else {
      toast.error("Você está sem conexão. Algumas funções podem ficar indisponíveis.", {
        id: "offline-status",
        duration: 4000,
      });
    }
  }, [online]);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-destructive/90 px-4 py-1.5 text-xs font-medium text-destructive-foreground backdrop-blur"
    >
      <WifiOff className="h-3.5 w-3.5" />
      <span>Você está sem conexão. Algumas funções podem ficar indisponíveis.</span>
    </div>
  );
}
