import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useAlerts } from "@/lib/alerts/use-alerts";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { NotificationsPanel } from "@/components/NotificationBell";

/**
 * Botão flutuante de notificações (apenas mobile, `lg:hidden`).
 *
 * - position: fixed, canto inferior direito (right:16px / bottom:92px).
 * - Fica acima da BottomNav e não cobre o botão central de adicionar.
 * - Respeita safe-area-inset-bottom de iPhones.
 * - Sino balança ao montar e a cada ~12s quando há notificações não lidas.
 * - Respeita `prefers-reduced-motion: reduce` automaticamente via `motion-safe:`.
 * - Ao tocar, abre um bottom sheet com as notificações.
 */
export function MobileNotificationsFab() {
  const { t } = useTranslation("dashboard");
  const { visible, unreadCount } = useAlerts();
  const hasUrgente = visible.some((a) => a.priority === "critica" || a.priority === "alta");
  const [open, setOpen] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  // Re-dispara a animação de balanço a cada ~12s enquanto houver notificações.
  useEffect(() => {
    if (unreadCount <= 0 || open) return;
    const id = window.setInterval(() => setShakeKey((k) => k + 1), 12000);
    return () => window.clearInterval(id);
  }, [unreadCount, open]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={
            unreadCount > 0
              ? t("notifications.ariaUnread", { count: unreadCount })
              : t("notifications.ariaDefault")
          }
          className={cn(
            "fixed right-4 z-40 grid h-12 w-12 place-items-center rounded-full lg:hidden",
            "border border-border/70 bg-card text-foreground shadow-lg shadow-black/10",
            "backdrop-blur transition active:scale-95",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
          style={{
            bottom: "calc(92px + env(safe-area-inset-bottom, 0px))",
          }}
        >
          <Bell
            key={shakeKey}
            aria-hidden="true"
            className={cn(
              "h-5 w-5",
              unreadCount > 0 && "motion-safe:animate-[bell-shake_1s_ease-in-out_1]",
            )}
          />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className={cn(
                "absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1",
                "text-[10px] font-bold leading-none text-white shadow-sm ring-2 ring-background",
                hasUrgente ? "bg-destructive" : "bg-amber-500",
              )}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="p-0 rounded-t-2xl max-h-[85vh] overflow-hidden border-border/70"
      >
        <NotificationsPanel onClose={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
