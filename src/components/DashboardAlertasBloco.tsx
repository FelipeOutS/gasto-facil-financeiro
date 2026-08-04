import { Link } from "@tanstack/react-router";
import {
  Bell,
  ChevronRight,
  Sparkles,
  AlertTriangle,
  Clock,
  CalendarClock,
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
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useAlerts } from "@/lib/alerts/use-alerts";
import { categoryOf, type AlertPriority } from "@/lib/alerts/types";

function priorityMeta(p: AlertPriority) {
  switch (p) {
    case "critica":
      return {
        bg: "bg-destructive/10",
        fg: "text-destructive",
        badge: "bg-destructive/15 text-destructive",
      };
    case "alta":
      return {
        bg: "bg-warning/10",
        fg: "text-warning",
        badge: "bg-warning/15 text-warning",
      };
    case "media":
      return {
        bg: "bg-warning/10",
        fg: "text-warning",
        badge: "bg-warning/15 text-warning",
      };
    case "baixa":
    default:
      return {
        bg: "bg-success/10",
        fg: "text-success",
        badge: "bg-success/15 text-success",
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

export function DashboardAlertasBloco({ className }: { className?: string }) {
  const { t } = useTranslation("dashboard");
  const { top, visible, loading } = useAlerts();

  if (loading) return null;

  const total = visible.length;

  return (
    <section
      className={cn(
        "rounded-2xl border border-border/60 bg-card/60 p-4 motion-safe:animate-rise",
        className,
      )}
      aria-label={t("alertasBloco.aria")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-soft/60 text-brand-on-soft">
            <Bell className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold leading-tight">{t("alertasBloco.title")}</p>
            <p className="text-[11px] text-muted-foreground">
              {total === 0 ? t("alertasBloco.tudoCerto") : t("alertasBloco.precisaAtencao")}
            </p>
          </div>
        </div>
        {total > 0 && (
          <Link
            to="/alertas"
            className="shrink-0 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            {t("alertasBloco.verTodos")}
          </Link>
        )}
      </div>

      {total === 0 ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-success/10 px-3 py-2.5 text-xs text-success">
          <Sparkles className="h-4 w-4" />
          {t("alertasBloco.nadaUrgente")}
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {top.map((a) => {
            const meta = priorityMeta(a.priority);
            const Icon = iconForType(a.type);
            return (
              <li key={a.id}>
                <Link
                  to={a.action_url || "/alertas"}
                  className="flex items-center gap-3 rounded-xl border border-border/40 bg-background/40 px-3 py-2.5 transition-colors hover:bg-accent/40"
                >
                  <span
                    className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", meta.bg)}
                  >
                    <Icon className={cn("h-4 w-4", meta.fg)} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-semibold leading-tight">{a.title}</p>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          meta.badge,
                        )}
                      >
                        {t(`notifications.priority.${a.priority}`)}
                      </span>
                    </div>
                    {a.description && (
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                        {a.description}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
