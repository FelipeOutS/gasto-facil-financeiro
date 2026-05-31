import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
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
import { PremiumCard } from "@/components/ui/premium-card";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
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

type PriorityTone = {
  tone: StatusTone;
  ring: string;
  iconBg: string;
  iconFg: string;
  dot: string;
};

function priorityTone(p: AlertPriority): PriorityTone {
  switch (p) {
    case "critica":
      return {
        tone: "destructive",
        ring: "border-destructive/50",
        iconBg: "bg-destructive/15",
        iconFg: "text-destructive",
        dot: "bg-destructive",
      };
    case "alta":
      return {
        tone: "warning",
        ring: "border-warning/40",
        iconBg: "bg-warning/15",
        iconFg: "text-warning",
        dot: "bg-warning",
      };
    case "media":
      return {
        tone: "info",
        ring: "border-primary/30",
        iconBg: "bg-primary/10",
        iconFg: "text-primary",
        dot: "bg-primary",
      };
    case "baixa":
    default:
      return {
        tone: "muted",
        ring: "border-border/60",
        iconBg: "bg-muted/50",
        iconFg: "text-muted-foreground",
        dot: "bg-muted-foreground",
      };
  }
}

function iconForType(type: string): LucideIcon {
  const cat = categoryOf(type);
  if (type === "cartao_cobranca_suspeita") return ShieldAlert;
  if (
    type === "gasto_acima_media_estabelecimento" ||
    type === "gasto_fora_padrao_categoria" ||
    type === "gastos_aumento" ||
    type === "assinatura_aumento"
  ) return TrendingUp;
  if (type === "assinatura_esquecida") return Clock;
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
        "relative rounded-2xl border bg-card p-4 transition-all",
        tone.ring,
        isUnread ? "shadow-card" : "opacity-90",
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tone.iconBg)}>
          <Icon className={cn("h-5 w-5", tone.iconFg)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold leading-snug">
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
              {alert.description && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {alert.description}
                </p>
              )}
            </div>
            <StatusBadge tone={tone.tone} className="shrink-0">
              {PRIORITY_LABEL[alert.priority]}
            </StatusBadge>
          </div>

          <div className="mt-2 text-[11px] text-muted-foreground">
            {CATEGORY_LABEL[categoryOf(alert.type)]} · {formatRelativo(alert.created_at)}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {alert.action_url && (
              <Button asChild size="sm" variant="default" className="min-h-11 px-3 text-xs">
                <Link to={alert.action_url}>
                  {alert.action_label || t("alertas.see")}
                  <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            )}
            {isUnread && (
              <Button size="sm" variant="ghost" onClick={onMarkRead} className="min-h-11 px-2.5 text-xs">
                <Eye className="mr-1 h-3.5 w-3.5" />
                {t("alertas.markRead")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onResolve} className="min-h-11 px-2.5 text-xs">
              <Check className="mr-1 h-3.5 w-3.5" />
              {t("alertas.resolve")}
            </Button>
            <Button size="sm" variant="ghost" onClick={onIgnore} className="min-h-11 px-2.5 text-xs text-muted-foreground">
              <EyeOff className="mr-1 h-3.5 w-3.5" />
              {t("alertas.ignore")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onDelete}
              className="ml-auto min-h-11 w-11 p-0 text-muted-foreground hover:text-destructive"
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

type Tier = "critica" | "atencao" | "informativos";

function tierOf(p: AlertPriority): Tier {
  if (p === "critica") return "critica";
  if (p === "alta" || p === "media") return "atencao";
  return "informativos";
}

function AlertasPage() {
  const { t } = useTranslation("misc");
  const { visible, loading, syncing, setStatus, markAllRead, remove, unreadCount } = useAlerts();
  const [filter, setFilter] = useState<FilterKey>("todos");

  const filtered = useMemo(() => filterByCategory(visible, filter), [visible, filter]);

  const stats = useMemo(() => {
    const total = visible.length;
    const critical = visible.filter((a) => a.priority === "critica").length;
    const important = visible.filter((a) => a.priority === "alta").length;
    const unread = unreadCount;
    return { total, critical, important, unread };
  }, [visible, unreadCount]);

  // Agrupamento por tier apenas quando filtro é "todos" e há volume.
  const grouped = useMemo(() => {
    if (filter !== "todos" || filtered.length < 6) return null;
    const groups: Record<Tier, UserAlert[]> = { critica: [], atencao: [], informativos: [] };
    for (const a of filtered) groups[tierOf(a.priority)].push(a);
    return groups;
  }, [filter, filtered]);

  const summaryHeadline = stats.total === 0
    ? t("alertas.summary.allClearTitle")
    : stats.total === 1
      ? t("alertas.summary.oneToReview")
      : t("alertas.summary.manyToReview", { n: stats.total });

  return (
    <MobileShell>
      <header className="pt-2 animate-rise">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
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
              <Button variant="ghost" size="sm" onClick={markAllRead} className="min-h-11 px-3 text-xs">
                <CheckCheck className="mr-1.5 h-4 w-4" />
                {t("alertas.markAll")}
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Resumo */}
      {!loading && (
        <PremiumCard
          variant={stats.critical > 0 ? "highlight" : "default"}
          rounded="2xl"
          padding="default"
          className="mt-4 animate-rise"
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                  stats.total === 0
                    ? "bg-success/15 text-success"
                    : stats.critical > 0
                      ? "bg-destructive/15 text-destructive"
                      : "bg-primary/10 text-primary",
                )}
              >
                {stats.total === 0 ? <Sparkles className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold leading-tight">{summaryHeadline}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {stats.total === 0
                    ? t("alertas.summary.allClearDesc")
                    : t("alertas.subtitle")}
                </p>
              </div>
            </div>
            {stats.total > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <SummaryStat label={t("alertas.summary.total")} value={stats.total} tone="default" />
                <SummaryStat label={t("alertas.summary.critical")} value={stats.critical} tone="destructive" />
                <SummaryStat label={t("alertas.summary.important")} value={stats.important} tone="warning" />
                <SummaryStat label={t("alertas.summary.unread")} value={stats.unread} tone="info" />
              </div>
            )}
          </div>
        </PremiumCard>
      )}

      {/* Onboarding leve — somente quando não há alertas */}
      {!loading && stats.total === 0 && (
        <section className="mt-3 rounded-2xl border border-border/60 bg-card-elevated/60 p-4 animate-rise">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("alertas.onboarding.title")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("alertas.onboarding.description")}
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground/90">
            {t("alertas.onboarding.inApp")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm" className="min-h-11">
              <Link to="/contas-a-pagar">{t("alertas.onboarding.cta")}</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="min-h-11">
              <Link to="/orcamento">{t("alertas.onboarding.secondaryCta")}</Link>
            </Button>
          </div>
          <p className="mt-3 text-[12px] text-muted-foreground">
            {t("alertas.onboarding.helper")}
          </p>
        </section>
      )}


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
                    : "border-border/60 bg-card text-muted-foreground hover:text-foreground",
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
          <EmptyState
            variant="default"
            icon={<Sparkles className="h-6 w-6" />}
            title={t("alertas.summary.allClearTitle")}
            description={
              <>
                {t(`alertas.empty.${filter}`)}
                {syncing && t("alertas.checking")}
              </>
            }
          />
        ) : grouped ? (
          <div className="space-y-6">
            {(["critica", "atencao", "informativos"] as Tier[]).map((tier) => {
              const items = grouped[tier];
              if (items.length === 0) return null;
              return (
                <div key={tier} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t(`alertas.groups.${tier}`)}
                    </h2>
                    <span className="text-xs text-muted-foreground">· {items.length}</span>
                  </div>
                  <div className="space-y-3">
                    {items.map((a) => (
                      <AlertCard
                        key={a.id}
                        alert={a}
                        onMarkRead={() => setStatus(a.id, "read")}
                        onResolve={() => setStatus(a.id, "resolved")}
                        onIgnore={() => setStatus(a.id, "ignored")}
                        onDelete={() => remove(a.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
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

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: ReactNode;
  value: number;
  tone: "default" | "destructive" | "warning" | "info";
}) {
  const toneClass =
    tone === "destructive"
      ? "text-destructive"
      : tone === "warning"
        ? "text-warning"
        : tone === "info"
          ? "text-primary"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-0.5 text-lg font-semibold tabular-nums", toneClass)}>
        {value}
      </div>
    </div>
  );
}
