import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  AlertTriangle,
  Clock,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Receipt,
  PieChart as PieChartIcon,
  Repeat,
  TrendingUp,
  ShieldAlert,
  Crown,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAlerts } from "@/lib/alerts/use-alerts";
import { categoryOf, type AlertPriority, type UserAlert } from "@/lib/alerts/types";

function priorityMeta(p: AlertPriority): { bg: string; fg: string; badge: string } {
  switch (p) {
    case "critica":
      return {
        bg: "bg-destructive/10",
        fg: "text-destructive",
        badge: "bg-destructive/15 text-destructive",
      };
    case "alta":
      return {
        bg: "bg-orange-500/10",
        fg: "text-orange-600 dark:text-orange-400",
        badge: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
      };
    case "media":
      return {
        bg: "bg-amber-500/10",
        fg: "text-amber-700 dark:text-amber-300",
        badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      };
    case "baixa":
    default:
      return {
        bg: "bg-emerald-500/10",
        fg: "text-emerald-700 dark:text-emerald-300",
        badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
      };
  }
}

function iconForType(type: string): LucideIcon {
  if (type.includes("vencida") || type.includes("estouro")) return AlertTriangle;
  if (type.includes("hoje")) return Clock;
  if (type.includes("amanha") || type.includes("vencendo") || type.includes("em5"))
    return CalendarClock;
  const cat = categoryOf(type);
  switch (cat) {
    case "cartoes":
      return CreditCard;
    case "contas":
      return Receipt;
    case "contas_receber":
      return Wallet;
    case "assinaturas":
      return Repeat;
    case "orcamento":
      return PieChartIcon;
    case "investimentos":
      return TrendingUp;
    case "sistema":
      return type.startsWith("plano_") ? Crown : ShieldAlert;
    default:
      return Bell;
  }
}

function ItemRow({ alert, onClose }: { alert: UserAlert; onClose: () => void }) {
  const { t } = useTranslation("dashboard");
  const meta = priorityMeta(alert.priority);
  const Icon = iconForType(alert.type);
  return (
    <li className="flex gap-3 px-4 py-3 border-b border-border/40 last:border-b-0">
      <div
        className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", meta.bg)}
      >
        <Icon className={cn("h-4 w-4", meta.fg)} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-semibold">{alert.title}</p>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
              meta.badge,
            )}
          >
            {t(`notifications.priority.${alert.priority}`)}
          </span>
        </div>
        {alert.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{alert.description}</p>
        )}
        {alert.action_url && (
          <div className="mt-1.5 flex items-center justify-end">
            <Button
              asChild
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={onClose}
            >
              <Link to={alert.action_url}>
                {alert.action_label || t("notifications.actionDefault")}
              </Link>
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

export function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("dashboard");
  const { visible, unreadCount } = useAlerts();
  const total = visible.length;
  const top = visible.slice(0, 6);

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-4 pb-3 border-b border-border/60">
        <h3 className="text-base font-semibold leading-tight">{t("notifications.title")}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {unreadCount > 0
            ? unreadCount === 1
              ? t("notifications.novosSing", { count: unreadCount })
              : t("notifications.novosPlur", { count: unreadCount })
            : t("notifications.padrao")}
        </p>
      </div>

      {total === 0 ? (
        <div className="px-6 py-8 text-center motion-safe:animate-fade-in">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
            <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="mt-3 text-sm font-semibold">{t("notifications.tudoCerto")}</p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            {t("notifications.tudoCertoSub")}
          </p>
        </div>
      ) : (
        <ul className="max-h-[60vh] overflow-y-auto">
          {top.map((a) => (
            <ItemRow key={a.id} alert={a} onClose={onClose} />
          ))}
        </ul>
      )}

      <div className="border-t border-border/60 px-3 py-2">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="w-full justify-center text-xs"
          onClick={onClose}
        >
          <Link to="/alertas">{t("notifications.verTodos")}</Link>
        </Button>
      </div>
    </div>
  );
}

export function NotificationBell() {
  const { t } = useTranslation("dashboard");
  const [open, setOpen] = useState(false);
  const { visible, unreadCount } = useAlerts();
  const total = visible.length;
  const hasUrgente = visible.some((a) => a.priority === "critica" || a.priority === "alta");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            unreadCount > 0
              ? t("notifications.ariaUnread", { count: unreadCount })
              : t("notifications.ariaDefault")
          }
          className={cn(
            "relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
            "border border-border/60 bg-card/60 backdrop-blur transition-all",
            "hover:bg-accent hover:border-border",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <Bell
            className={cn(
              "h-[18px] w-[18px] transition-colors",
              total > 0 ? "text-foreground" : "text-muted-foreground",
              unreadCount > 0 &&
                !open &&
                "motion-safe:animate-[bell-shake_2.4s_ease-in-out_infinite]",
            )}
          />
          {unreadCount > 0 && (
            <span
              className={cn(
                "absolute -right-0.5 -top-0.5 flex min-w-[18px] h-[18px] items-center justify-center rounded-full px-1",
                "text-[10px] font-bold leading-none text-white shadow-sm",
                "motion-safe:animate-[badge-pop_280ms_ease-out]",
                hasUrgente ? "bg-destructive" : "bg-amber-500",
              )}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[340px] p-0 overflow-hidden border-border/70 shadow-xl"
      >
        <NotificationsPanel onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
