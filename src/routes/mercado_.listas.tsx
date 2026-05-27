import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
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
  type LucideIcon,
} from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { Money } from "@/components/Money";
import { cn } from "@/lib/utils";
import { removeLista, useMercadoListas, type MercadoLista } from "@/lib/mercado/listas-store";


export const Route = createFileRoute("/mercado_/listas")({
  head: () => ({ meta: [{ title: i18n.t("mercado:meta.listasTitle", { lng: i18n.language }) }] }),
  component: MercadoListasPage,
});

type Status = "planning" | "ongoing" | "done";

function MercadoListasPage() {
  const { t, i18n: i18next } = useTranslation("mercado");
  const navigate = useNavigate();
  const userListas = useMercadoListas();

  const summary = useMemo(() => {
    const active = userListas.filter((l) => l.status !== "done").length;
    const items = userListas.reduce((a, l) => a + l.items, 0);
    const estimate = userListas.reduce((a, l) => a + (l.estimate ?? 0), 0);
    return { active, items, estimate };
  }, [userListas]);

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }
    void navigate({ to: "/mercado" });
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
          to="/"
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
      {userListas.length === 0 ? (
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
                const ok = window.confirm(t("listas.card.deleteConfirm"));
                if (!ok) return;
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
            onClick={onDelete}
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
    </article>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation("mercado");
  return (
    <section className="mt-6 rounded-3xl border border-dashed border-border bg-card p-8 text-center shadow-card">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-card-elevated text-brand ring-1 ring-border/60">
        <ListChecks className="h-7 w-7" />
      </span>
      <h2 className="mt-4 text-lg font-semibold">{t("listas.empty.title")}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {t("listas.empty.description")}
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-brand-grad px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-95 active:scale-[0.98]"
      >
        <Plus className="h-4 w-4" />
        {t("listas.empty.cta")}
      </button>
    </section>
  );
}
