import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  Home,
  Plus,
  ListChecks,
  ShoppingCart,
  WalletCards,
  CalendarDays,
  Trash2,
  RefreshCw,
  CloudOff,
  CloudCheck,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { Money } from "@/components/Money";
import { cn } from "@/lib/utils";
import { removeLista, useMercadoListas, type MercadoLista } from "@/lib/mercado/listas-store";
import { refreshMercadoListas, useMercadoListasSyncState } from "@/lib/mercado/mercado-sync";
import { useAuth } from "@/lib/auth-context";
import { useState } from "react";
import { MercadoBanner } from "@/components/mercado/shell";
import bannerOrcamento from "@/assets/mercado/banner-orcamento.jpg";
import bannerOrcamentoWebp from "@/assets/mercado/banner-orcamento.webp";
import emptyLista from "@/assets/mercado/empty-lista.webp";


export const Route = createFileRoute("/mercado_/listas")({
  head: () => ({ meta: [{ title: i18n.t("mercado:meta.listasTitle", { lng: i18n.language }) }] }),
  component: MercadoListasPage,
});

type Status = "planning" | "ongoing" | "done";

function MercadoListasPage() {
  const { t, i18n: i18next } = useTranslation("mercado");
  const navigate = useNavigate();
  const userListas = useMercadoListas();
  const syncState = useMercadoListasSyncState();
  const { user } = useAuth();
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const summary = useMemo(() => {
    const active = userListas.filter((l) => l.status !== "done").length;
    const items = userListas.reduce((a, l) => a + l.items, 0);
    const estimate = userListas.reduce((a, l) => a + (l.estimate ?? 0), 0);
    return { active, items, estimate };
  }, [userListas]);

  async function handleManualRefresh() {
    if (manualRefreshing) return;
    setManualRefreshing(true);
    const res = await refreshMercadoListas();
    setManualRefreshing(false);
    if (res.ok && user) toast.success(t("listas.sync.refreshedToast"));
    else if (!res.ok) toast.error(t("listas.sync.failed"));
  }

  function handleBack() {
    void navigate({ to: "/mercado", replace: true });
  }

  function goToNova() {
    void navigate({ to: "/mercado/listas/nova" });
  }

  function handleOpenLista(id: string) {
    void navigate({ to: "/mercado/listas/$id", params: { id } });
  }


  const dateFormatter = new Intl.DateTimeFormat(i18next.language || "pt-BR", {
    day: "2-digit",
    month: "short",
  });

  return (
    <MobileShell wide>
      {/* Header */}
      <header className="flex items-start gap-3 pt-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label={t("listas.back")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Link
          to="/app"
          aria-label={t("listas.home")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <Home className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">
            {t("listas.title")}
          </h1>
          <p className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground md:text-base">
            {t("listas.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={goToNova}
          className="hidden md:inline-flex items-center gap-2 rounded-2xl bg-brand-grad px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-95 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          {t("listas.newList")}
        </button>
      </header>

      {/* Visual banner */}
      <div className="mt-4">
        <MercadoBanner
          tone="community"
          title={t("listsV2.bannerTitle")}
          subtitle={t("listsV2.bannerSubtitle")}
          imageSrc={bannerOrcamento}
          imageSrcWebp={bannerOrcamentoWebp}
          imageAlt={t("listsV2.bannerTitle")}
          cta={
            <button
              type="button"
              onClick={goToNova}
              className="inline-flex min-h-10 items-center gap-2 rounded-full bg-brand-grad px-4 py-2 text-xs font-semibold text-primary-foreground shadow-elevated transition active:scale-[0.98]"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("listsV2.bannerCta")}
            </button>
          }
        />
      </div>

      {/* Sync status */}
      <SyncStatusBar
        state={syncState}
        loggedIn={Boolean(user)}
        manualRefreshing={manualRefreshing}
        onRefresh={() => void handleManualRefresh()}
        locale={i18next.language || "pt-BR"}
        t={t}
      />

      {/* Summary */}
      <section className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryTile
          icon={ListChecks}
          label={t("listas.summary.active")}
          value={String(summary.active)}
        />
        <SummaryTile
          icon={ShoppingCart}
          label={t("listas.summary.items")}
          value={String(summary.items)}
        />
        <SummaryTile
          icon={WalletCards}
          label={t("listas.summary.estimate")}
          value={<Money value={summary.estimate} />}
        />
      </section>

      {/* Listas */}
      {userListas.length === 0 && (syncState.status === "syncing" || manualRefreshing) ? (
        <section className="mt-5 grid place-items-center rounded-2xl border border-dashed border-border/60 bg-card/60 py-10 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("listas.sync.syncing")}
          </span>
        </section>
      ) : userListas.length === 0 ? (
        <EmptyState onCreate={goToNova} />
      ) : (
        <section className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {userListas.map((lista) => (
            <ListaCard
              key={lista.id}
              lista={lista}
              dateLabel={dateFormatter.format(new Date(lista.createdAt))}
              onOpen={() => handleOpenLista(lista.id)}
              onDelete={() => {
                if (removeLista(lista.id)) {
                  toast.success(t("listas.card.deleteSuccess"));
                } else {
                  toast.error(t("listas.card.deleteError"));
                }
              }}
            />
          ))}

        </section>
      )}

      {/* Mobile CTA at bottom */}
      <div className="mt-6 md:hidden">
        <button
          type="button"
          onClick={goToNova}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-grad px-4 py-3 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-95 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          {t("listas.newList")}
        </button>
      </div>
    </MobileShell>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-3xl border border-border/60 bg-card p-4 shadow-card">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-card-elevated text-brand ring-1 ring-border/60">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <p className="mt-0.5 truncate text-lg font-bold">{value}</p>
      </div>
    </div>
  );
}

function ListaCard({
  lista,
  dateLabel,
  onOpen,
  onDelete,
}: {
  lista: MercadoLista;
  dateLabel: string;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("mercado");
  const [confirming, setConfirming] = useState(false);
  const statusClasses: Record<Status, string> = {
    planning: "bg-warning/10 text-warning ring-1 ring-warning/20",
    ongoing: "bg-primary/10 text-primary ring-1 ring-primary/20",
    done: "bg-success/10 text-success ring-1 ring-success/20",
  };
  return (
    <article className="group flex min-h-[160px] flex-col gap-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-card-elevated text-foreground ring-1 ring-border/60">
          <CalendarDays className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{lista.name}</h2>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {t(`nova.fields.tipo.options.${lista.tipo}`)} · {dateLabel}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest",
            statusClasses[lista.status],
          )}
        >
          {t(`listas.status.${lista.status}`)}
        </span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {lista.estimate ? t("listas.card.estimate") : t("listas.card.items")}
          </p>
          <p className="mt-0.5 truncate text-lg font-bold">
            {lista.estimate ? (
              <Money value={lista.estimate} />
            ) : (
              t("listas.card.itemsCount", { count: lista.items })
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={t("listas.card.delete")}
            title={t("listas.card.delete")}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border bg-card-elevated text-destructive transition-colors hover:bg-destructive/10 active:scale-95"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card-elevated px-3.5 py-2 text-xs font-semibold text-foreground/80 transition-colors hover:text-foreground active:scale-95"
          >
            {t("listas.card.open")}
          </button>
        </div>
      </div>

      {confirming && (
        <div
          role="alertdialog"
          aria-labelledby={`del-${lista.id}-title`}
          className="rounded-2xl border border-destructive/30 bg-destructive/5 p-3"
        >
          <p
            id={`del-${lista.id}-title`}
            className="text-sm font-semibold text-destructive"
          >
            {t("listas.card.deleteConfirmTitle")}
          </p>
          <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
            {t("listas.card.deleteConfirmDescription")}
          </p>
          <p className="mt-1 truncate text-[12px] font-medium text-foreground">
            {t("listas.card.deleteConfirmName", { name: lista.name })}
          </p>
          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-card-elevated px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-card active:scale-95"
            >
              {t("listas.card.deleteCancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onDelete();
              }}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/15 active:scale-95"
            >
              <Trash2 className="h-4 w-4" />
              {t("listas.card.deleteConfirmButton")}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation("mercado");
  return (
    <section className="mt-6 overflow-hidden rounded-3xl border border-dashed border-border bg-card p-6 text-center shadow-card md:p-8">
      <img
        src={emptyLista}
        alt={t("listsV2.emptyImageAlt")}
        loading="lazy"
        className="mx-auto h-32 w-auto object-contain sm:h-40"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
      <h2 className="mt-4 text-lg font-semibold">{t("listsV2.emptyTitle")}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {t("listsV2.emptyDesc")}
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-2xl bg-brand-grad px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-95 active:scale-[0.98]"
      >
        <Plus className="h-4 w-4" />
        {t("listsV2.emptyCta")}
      </button>
      <p className="mx-auto mt-3 max-w-md text-[11px] text-muted-foreground">
        {t("listas.empty.helper")}
      </p>
    </section>
  );
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function SyncStatusBar({
  state,
  loggedIn,
  manualRefreshing,
  onRefresh,
  locale,
  t,
}: {
  state: { status: "idle" | "syncing" | "synced" | "error"; lastSyncedAt: string | null };
  loggedIn: boolean;
  manualRefreshing: boolean;
  onRefresh: () => void;
  locale: string;
  t: TFn;
}) {
  const busy = manualRefreshing || state.status === "syncing";
  let icon: ReactNode;
  let label: string;
  let tone = "text-muted-foreground";
  if (!loggedIn) {
    icon = <CloudOff className="h-3.5 w-3.5" />;
    label = t("listas.sync.localSaved");
  } else if (busy) {
    icon = <Loader2 className="h-3.5 w-3.5 animate-spin" />;
    label = t("listas.sync.syncing");
  } else if (state.status === "error") {
    icon = <CloudOff className="h-3.5 w-3.5 text-destructive" />;
    label = t("listas.sync.failed");
    tone = "text-destructive";
  } else {
    icon = <CloudCheck className="h-3.5 w-3.5" />;
    if (state.lastSyncedAt) {
      const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
        new Date(state.lastSyncedAt),
      );
      label = `${t("listas.sync.synced")} · ${t("listas.sync.lastUpdated", { time })}`;
    } else {
      label = t("listas.sync.synced");
    }
  }
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-card/60 px-3 py-2">
      <span className={cn("inline-flex items-center gap-1.5 text-[12px]", tone)}>
        {icon}
        <span className="line-clamp-1">{label}</span>
      </span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={busy}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-border bg-card-elevated px-3 py-1.5 text-[12px] font-semibold text-foreground transition hover:bg-card disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
        {busy ? t("listas.sync.refreshing") : t("listas.sync.refresh")}
      </button>
    </div>
  );
}
