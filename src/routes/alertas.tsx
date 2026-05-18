import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell,
  Check,
  CheckCheck,
  ChevronRight,
  Eye,
  EyeOff,
  Sparkles,
  Trash2,
  Filter,
  AlertTriangle,
  Clock,
  CalendarClock,
  TrendingUp,
  CreditCard,
  Receipt,
  Repeat,
  PieChart,
  Wallet,
  ShieldAlert,
  Crown,
  type LucideIcon,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAlerts } from "@/lib/alerts/use-alerts";
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  categoryOf,
  type AlertCategory,
  type AlertPriority,
  type UserAlert,
} from "@/lib/alerts/types";
import { filterByCategory } from "@/lib/alerts/service";
import i18n from "@/i18n";

export const Route = createFileRoute("/alertas")({
  head: () => {
    const t = i18n.getFixedT(i18n.language, "misc");
    return {
      meta: [
        { title: t("alertas.metaTitle") },
        { name: "description", content: t("alertas.metaDesc") },
      ],
    };
  },
  component: AlertasPage,
});

type FilterKey =
  | "todos"
  | "nao_lidos"
  | "importantes"
  | AlertCategory;

const FILTER_KEYS: FilterKey[] = [
  "todos", "nao_lidos", "importantes", "cartoes", "contas", "contas_receber",
  "assinaturas", "gastos", "orcamento", "investimentos", "sistema",
];


function priorityTone(p: AlertPriority): { ring: string; bg: string; fg: string; dot: string } {
  switch (p) {
    case "critica":
      return {
        ring: "border-destructive/40",
        bg: "bg-destructive/10",
        fg: "text-destructive",
        dot: "bg-destructive",
      };
    case "alta":
      return {
        ring: "border-orange-500/40",
        bg: "bg-orange-500/10",
        fg: "text-orange-600 dark:text-orange-400",
        dot: "bg-orange-500",
      };
    case "media":
      return {
        ring: "border-amber-500/40",
        bg: "bg-amber-500/10",
        fg: "text-amber-700 dark:text-amber-300",
        dot: "bg-amber-500",
      };
    case "baixa":
    default:
      return {
        ring: "border-emerald-500/40",
        bg: "bg-emerald-500/10",
        fg: "text-emerald-700 dark:text-emerald-300",
        dot: "bg-emerald-500",
      };
  }
}

function iconForType(type: string): LucideIcon {
  const cat = categoryOf(type);
  if (type.includes("vencida") || type.includes("estouro")) return AlertTriangle;
  if (type.includes("hoje")) return Clock;
  if (type.includes("amanha") || type.includes("vencendo") || type.includes("em5")) return CalendarClock;
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
      return PieChart;
    case "investimentos":
      return TrendingUp;
    case "sistema":
      return type.startsWith("plano_") ? Crown : ShieldAlert;
    default:
      return Bell;
  }
}

function useFormatRelativo() {
  const { t, i18n: i18nInst } = useTranslation("misc");
  return (iso: string): string => {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return t("alertas.rel.now");
    if (mins < 60) return t("alertas.rel.min", { n: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("alertas.rel.hour", { n: hours });
    const days = Math.floor(hours / 24);
    if (days < 7) return t("alertas.rel.day", { n: days });
    return d.toLocaleDateString(i18nInst.language === "en" ? "en-US" : "pt-BR", { day: "2-digit", month: "short" });
  };
}


function AlertCard({
  alert,
  onMarkRead,
  onResolve,
  onIgnore,
  onDelete,
}: {
  alert: UserAlert;
  onMarkRead: () => void;
  onResolve: () => void;
  onIgnore: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("misc");
  const formatRelativo = useFormatRelativo();
  const tone = priorityTone(alert.priority);
  const Icon = iconForType(alert.type);
  const isUnread = alert.status === "unread";

  return (
    <article
      className={cn(
        "relative rounded-2xl border bg-card/60 p-4 transition-all",
        tone.ring,
        isUnread && "shadow-sm",
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tone.bg)}>
          <Icon className={cn("h-5 w-5", tone.fg)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold leading-snug">
                {alert.title}
                {isUnread && (
                  <span
                    className={cn(
                      "ml-2 inline-block h-2 w-2 rounded-full align-middle",
                      tone.dot,
                    )}
                    aria-label={t("alertas.unread")}
                  />
                )}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {alert.description}
              </p>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                tone.bg,
                tone.fg,
              )}
            >
              {PRIORITY_LABEL[alert.priority]}
            </span>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>
              {CATEGORY_LABEL[categoryOf(alert.type)]} · {formatRelativo(alert.created_at)}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {alert.action_url && (
              <Button asChild size="sm" variant="default" className="h-8 px-3 text-xs">
                <Link to={alert.action_url}>
                  {alert.action_label || t("alertas.see")}
                  <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            )}
            {isUnread && (
              <Button size="sm" variant="ghost" onClick={onMarkRead} className="h-8 px-2.5 text-xs">
                <Eye className="mr-1 h-3.5 w-3.5" />
                {t("alertas.markRead")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onResolve} className="h-8 px-2.5 text-xs">
              <Check className="mr-1 h-3.5 w-3.5" />
              {t("alertas.resolve")}
            </Button>
            <Button size="sm" variant="ghost" onClick={onIgnore} className="h-8 px-2.5 text-xs text-muted-foreground">
              <EyeOff className="mr-1 h-3.5 w-3.5" />
              {t("alertas.ignore")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onDelete}
              className="ml-auto h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              aria-label={t("alertas.delete")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

function AlertasPage() {
  const { t } = useTranslation("misc");
  const { visible, loading, syncing, setStatus, markAllRead, remove, unreadCount } = useAlerts();
  const [filter, setFilter] = useState<FilterKey>("todos");

  const filtered = useMemo(() => filterByCategory(visible, filter), [visible, filter]);

  return (
    <MobileShell>
      <header className="pt-2 animate-rise">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              {t("alertas.kicker")}
            </p>
            <h1 className="mt-0.5 text-[26px] font-bold leading-tight tracking-tight">{t("alertas.title")}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("alertas.subtitle")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" onClick={markAllRead} className="h-9 px-3 text-xs">
                <CheckCheck className="mr-1.5 h-4 w-4" />
                {t("alertas.markAll")}
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Filtros */}
      <div className="mt-4 -mx-4 sm:-mx-5 md:-mx-6 px-4 sm:px-5 md:px-6 overflow-x-auto">
        <div className="flex w-max items-center gap-2 pb-1">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          {FILTER_KEYS.map((k) => {
            const active = filter === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/60 bg-card/60 text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`alertas.filters.${k}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Lista */}
      <section className="mt-5 space-y-3">
        {loading ? (
          <>
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-card/60 px-6 py-14 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
              <Sparkles className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h2 className="mt-4 text-base font-semibold">{t("alertas.emptyTitle")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("alertas.emptyDesc")}
              {syncing && t("alertas.checking")}
            </p>
          </div>
        ) : (
          filtered.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              onMarkRead={() => setStatus(a.id, "read")}
              onResolve={() => setStatus(a.id, "resolved")}
              onIgnore={() => setStatus(a.id, "ignored")}
              onDelete={() => remove(a.id)}
            />
          ))
        )}
      </section>
    </MobileShell>
  );
}
