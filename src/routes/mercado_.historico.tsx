import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Home, History, WalletCards, Check, CircleDashed, Receipt, ListPlus, ShoppingBag, Store, TrendingUp } from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { Money } from "@/components/Money";
import { MercadoBanner } from "@/components/mercado/shell/MercadoBanner";
import { SectionBlock } from "@/components/mercado/shell/SectionBlock";
import bannerComunitario from "@/assets/mercado/banner-comunitario.jpg";
import emptyCarrinho from "@/assets/mercado/empty-carrinho.png";
import { cn } from "@/lib/utils";
import {
  useMercadoHistorico,
  type MercadoCompraHistorico,
} from "@/lib/mercado/listas-store";


export const Route = createFileRoute("/mercado_/historico")({
  head: () => ({
    meta: [{ title: i18n.t("mercado:historico.metaTitle", { lng: i18n.language }) }],
  }),
  component: HistoricoPage,
});

function HistoricoPage() {
  const { t, i18n: i18next } = useTranslation("mercado");
  const navigate = useNavigate();
  const historico = useMercadoHistorico();

  function handleBack() {
    void navigate({ to: "/mercado", replace: true });
  }

  const dateFormatter = new Intl.DateTimeFormat(i18next.language || "pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <MobileShell wide>
      <header className="flex items-start gap-3 pt-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label={t("historico.back")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Link
          to="/app"
          aria-label={t("historico.home")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <Home className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
              <History className="h-4 w-4" />
            </span>
            <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">
              {t("historico.title")}
            </h1>
          </div>
          <p className="mt-1 text-sm leading-snug text-muted-foreground md:text-base">
            {t("historico.subtitle")}
          </p>
        </div>
      </header>

      {historico.length === 0 ? (
        <section className="mt-6 rounded-3xl border border-dashed border-border bg-card p-8 text-center shadow-card">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-card-elevated text-brand ring-1 ring-border/60">
            <History className="h-7 w-7" />
          </span>
          <h2 className="mt-4 text-lg font-semibold">{t("historico.empty.title")}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {t("historico.empty.description")}
          </p>
          <Link
            to="/mercado/listas"
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-brand-grad px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-95 active:scale-[0.98]"
          >
            {t("historico.back")}
          </Link>
        </section>
      ) : (
        <section className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {historico.map((h) => (
            <HistoricoCard key={h.id} item={h} dateFormatter={dateFormatter} />
          ))}
        </section>
      )}
    </MobileShell>
  );
}

function HistoricoCard({
  item,
  dateFormatter,
}: {
  item: MercadoCompraHistorico;
  dateFormatter: Intl.DateTimeFormat;
}) {
  const { t } = useTranslation("mercado");
  const hasBudget = typeof item.orcamento === "number" && item.orcamento > 0;
  const overBudget = hasBudget && item.economiaOuEstouro < 0;
  const diffAbs = Math.abs(item.economiaOuEstouro);
  const diffFormatted = diffAbs.toLocaleString(undefined, {
    style: "currency",
    currency: "BRL",
  });

  return (
    <article className="flex h-full flex-col gap-3 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <header className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
          <WalletCards className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">{item.nome || "—"}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-card-elevated px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-foreground/80 ring-1 ring-border/60">
              {t(`nova.fields.tipo.options.${item.tipo}`)}
            </span>
            <span className="text-[12px] text-muted-foreground">
              {t("historico.card.finishedOn")} {dateFormatter.format(new Date(item.concluidaEm))}
            </span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Tile
          icon={<Check className="h-4 w-4" />}
          label={t("historico.card.bought")}
          value={String(item.itensComprados)}
          tone="success"
        />
        <Tile
          icon={<CircleDashed className="h-4 w-4" />}
          label={t("historico.card.pending")}
          value={String(item.itensPendentes)}
          tone={item.itensPendentes > 0 ? "warning" : "muted"}
        />
        <Tile
          icon={<WalletCards className="h-4 w-4" />}
          label={t("historico.card.totalEstimated")}
          value={<Money value={item.totalEstimado} />}
        />
      </div>

      {hasBudget ? (
        <div
          className={cn(
            "rounded-2xl border p-3",
            overBudget
              ? "border-destructive/30 bg-destructive/10"
              : "border-success/30 bg-success/10",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("historico.card.budget")}
            </span>
            <span className="text-[12px] font-semibold tabular-nums">
              <Money value={item.orcamento ?? 0} />
            </span>
          </div>
          <p
            className={cn(
              "mt-1 text-[12px] font-semibold",
              overBudget ? "text-destructive" : "text-success",
            )}
          >
            {overBudget
              ? t("historico.card.overBy", { value: diffFormatted })
              : t("historico.card.savedBy", { value: diffFormatted })}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card-elevated p-3 text-[12px] text-muted-foreground">
          {t("historico.card.noBudget")}
        </div>
      )}

      <p className="truncate text-[12px] text-muted-foreground">
        {item.mercadoNome
          ? t("historico.card.market", { value: item.mercadoNome })
          : t("historico.card.marketUnknown")}
      </p>

      <p className="text-[12px] text-muted-foreground">
        {t("historico.card.progress", { percent: item.percentualConcluido })}
      </p>
    </article>
  );
}

function Tile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: "success" | "warning" | "muted";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-brand";
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-card-elevated p-2.5">
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-card ring-1 ring-border/60",
          toneClass,
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-sm font-bold tabular-nums">{value}</p>
      </div>
    </div>
  );
}
