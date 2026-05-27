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
  type LucideIcon,
} from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { Money } from "@/components/Money";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/mercado/listas")({
  head: () => ({ meta: [{ title: i18n.t("mercado:meta.listasTitle", { lng: i18n.language }) }] }),
  component: MercadoListasPage,
});

type Status = "planning" | "ongoing" | "done";

type MockLista = {
  id: string;
  nameKey: "compraMes" | "reposicaoSemana" | "churrascoSabado";
  items: number;
  estimate: number;
  progress: number; // 0-100
  status: Status;
};

const MOCK_LISTAS: MockLista[] = [
  { id: "m1", nameKey: "compraMes", items: 32, estimate: 685.4, progress: 18, status: "planning" },
  { id: "m2", nameKey: "reposicaoSemana", items: 12, estimate: 184.9, progress: 62, status: "ongoing" },
  { id: "m3", nameKey: "churrascoSabado", items: 9, estimate: 312.0, progress: 100, status: "done" },
];

function MercadoListasPage() {
  const { t } = useTranslation("mercado");
  const navigate = useNavigate();

  const listas = MOCK_LISTAS;
  const summary = useMemo(() => {
    const active = listas.filter((l) => l.status !== "done").length;
    const items = listas.reduce((a, l) => a + l.items, 0);
    const estimate = listas.reduce((a, l) => a + l.estimate, 0);
    return { active, items, estimate };
  }, [listas]);

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }
    void navigate({ to: "/mercado" });
  }

  function handleNewList() {
    toast.info(t("listas.newListToast"));
  }

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
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">
              {t("listas.title")}
            </h1>
            <span className="hidden sm:inline-flex items-center rounded-full bg-card-elevated px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground ring-1 ring-border/60">
              {t("listas.previewBadge")}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground md:text-base">
            {t("listas.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={handleNewList}
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
      {listas.length === 0 ? (
        <EmptyState onCreate={handleNewList} />
      ) : (
        <section className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {listas.map((lista) => (
            <ListaCard key={lista.id} lista={lista} />
          ))}
        </section>
      )}

      {/* Mobile CTA at bottom */}
      <div className="mt-6 md:hidden">
        <button
          type="button"
          onClick={handleNewList}
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

function ListaCard({ lista }: { lista: MockLista }) {
  const { t } = useTranslation("mercado");
  const statusClasses: Record<Status, string> = {
    planning: "bg-warning/10 text-warning ring-1 ring-warning/20",
    ongoing: "bg-primary/10 text-primary ring-1 ring-primary/20",
    done: "bg-success/10 text-success ring-1 ring-success/20",
  };
  return (
    <article
      aria-disabled="true"
      className="group flex min-h-[160px] flex-col gap-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-card-elevated text-foreground ring-1 ring-border/60">
          <CalendarDays className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{t(`listas.mock.${lista.nameKey}`)}</h2>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {t("listas.card.itemsCount", { count: lista.items })}
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

      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("listas.card.estimate")}
          </p>
          <p className="mt-0.5 truncate text-lg font-bold">
            <Money value={lista.estimate} />
          </p>
        </div>
        <div className="min-w-0 flex-1 max-w-[55%]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("listas.card.progress")}
            </span>
            <span className="text-[11px] font-semibold tabular-nums text-foreground">
              {lista.progress}%
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={lista.progress}
            className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-card-elevated ring-1 ring-border/60"
          >
            <div
              className={cn(
                "h-full rounded-full transition-all",
                lista.status === "done"
                  ? "bg-success"
                  : lista.status === "ongoing"
                    ? "bg-primary"
                    : "bg-warning",
              )}
              style={{ width: `${Math.max(0, Math.min(100, lista.progress))}%` }}
            />
          </div>
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
