import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Home,
  Store,
  Info,
  PackageSearch,
  Award,
  TrendingDown,
  Sparkles,
} from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";

import { cn } from "@/lib/utils";
import {
  useResumoMercados,
  type ResumoMercadoCard,
  type ResumoMercadoStatus,
} from "@/lib/mercado/precos-history";

export const Route = createFileRoute("/mercado_/mercados")({
  head: () => ({
    meta: [{ title: i18n.t("mercado:mercados.metaTitle", { lng: i18n.language }) }],
  }),
  component: ComparativoMercadosPage,
});

function ComparativoMercadosPage() {
  const { t, i18n: i18nInst } = useTranslation("mercado");
  const navigate = useNavigate();
  const resumo = useResumoMercados();

  function handleBack() {
    void navigate({ to: "/mercado", replace: true });
  }

  const dateFormatter = new Intl.DateTimeFormat(i18nInst.language || "pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const isEmpty = resumo.totalRegistros === 0;
  const onlyUnknown =
    !isEmpty && resumo.totalMercadosNomeados === 0 && resumo.hasSemMercado;

  return (
    <MobileShell wide>
      <header className="flex items-start gap-3 pt-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label={t("mercados.back")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Link
          to="/app"
          aria-label={t("mercados.home")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <Home className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
              <Store className="h-4 w-4" />
            </span>
            <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">
              {t("mercados.title")}
            </h1>
          </div>
          <p className="mt-1 text-sm leading-snug text-muted-foreground md:text-base">
            {t("mercados.subtitle")}
          </p>
        </div>
      </header>

      <section className="mt-5 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card-elevated text-brand ring-1 ring-border/60">
            <Info className="h-4 w-4" />
          </span>
          <p className="text-sm leading-snug text-foreground md:text-[15px]">
            {t("mercados.localNotice")}
          </p>
        </div>
      </section>

      {isEmpty ? (
        <EmptyState t={t} />
      ) : (
        <>
          <SummaryBlock resumo={resumo} t={t} />

          {onlyUnknown && <NoMarketBanner t={t} />}

          <section className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {resumo.mercados.map((m) => (
              <MercadoCard
                key={m.mercadoKey}
                m={m}
                t={t}
                dateFormatter={dateFormatter}
              />
            ))}
          </section>
        </>
      )}
    </MobileShell>
  );
}

function EmptyState({ t }: { t: (k: string) => string }) {
  return (
    <section className="mt-5 grid place-items-center rounded-3xl border border-dashed border-border/60 bg-card p-8 text-center shadow-card">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
        <PackageSearch className="h-6 w-6" />
      </span>
      <h2 className="mt-3 text-base font-semibold md:text-lg">
        {t("mercados.empty.title")}
      </h2>
      <p className="mt-1 max-w-md text-sm leading-snug text-muted-foreground">
        {t("mercados.empty.desc")}
      </p>
      <Link
        to="/mercado/listas"
        className="mt-4 inline-flex h-11 items-center justify-center rounded-2xl bg-brand-grad px-5 text-sm font-semibold text-primary-foreground shadow-elevated active:scale-[0.99]"
      >
        {t("mercados.empty.cta")}
      </Link>
    </section>
  );
}

function NoMarketBanner({ t }: { t: (k: string) => string }) {
  return (
    <section className="mt-5 rounded-3xl border border-warning/30 bg-warning/10 p-4 shadow-card md:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card text-warning ring-1 ring-warning/30">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold md:text-lg">
            {t("mercados.noMarketState.title")}
          </h2>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">
            {t("mercados.noMarketState.desc")}
          </p>
          <Link
            to="/mercado/precos-historico"
            className="mt-3 inline-flex h-10 items-center justify-center rounded-2xl border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-card-elevated"
          >
            {t("mercados.noMarketState.cta")}
          </Link>
        </div>
      </div>
    </section>
  );
}

function SummaryBlock({
  resumo,
  t,
}: {
  resumo: ReturnType<typeof useResumoMercados>;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <section className="mt-5 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <h2 className="text-base font-semibold md:text-lg">{t("mercados.summary.title")}</h2>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <SummaryTile
          label={t("mercados.summary.markets", { count: resumo.totalMercadosNomeados })}
          value={resumo.totalMercadosNomeados}
        />
        <SummaryTile
          label={t("mercados.summary.products", { count: resumo.totalProdutos })}
          value={resumo.totalProdutos}
        />
        <SummaryTile
          label={t("mercados.summary.records", { count: resumo.totalRegistros })}
          value={resumo.totalRegistros}
        />
        <div className="rounded-2xl border border-border/60 bg-card-elevated p-3">
          <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("mercados.summary.topMarketLabel")}
          </p>
          <p className="mt-1 truncate text-sm font-bold md:text-base">
            {resumo.mercadoComMaisRegistros ?? t("mercados.summary.topMarketEmpty")}
          </p>
        </div>
      </div>
    </section>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card-elevated p-3">
      <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold tabular-nums md:text-xl">{value}</p>
    </div>
  );
}

const STATUS_TONE: Record<
  ResumoMercadoStatus,
  { ring: string; text: string; bg: string }
> = {
  melhor: { ring: "ring-success/30", text: "text-success", bg: "bg-success/10" },
  medio: { ring: "ring-border/60", text: "text-foreground", bg: "bg-card-elevated" },
  pouco_dado: { ring: "ring-warning/30", text: "text-warning", bg: "bg-warning/10" },
};

function MercadoCard({
  m,
  t,
  dateFormatter,
}: {
  m: ResumoMercadoCard;
  t: (k: string, opts?: Record<string, unknown>) => string;
  dateFormatter: Intl.DateTimeFormat;
}) {
  const tone = STATUS_TONE[m.status];
  const statusLabel = t(
    `mercados.status.${m.status === "pouco_dado" ? "poucoDado" : m.status}`,
  );
  const statusDesc = t(
    `mercados.statusDesc.${m.status === "pouco_dado" ? "poucoDado" : m.status}`,
  );

  const nome = m.semMercado ? t("mercados.card.unknownMarket") : m.mercadoNome;

  return (
    <article className="flex flex-col gap-3 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <header className="flex items-start gap-3 min-w-0">
        <span
          className={cn(
            "grid h-11 w-11 shrink-0 place-items-center rounded-2xl ring-1",
            m.semMercado
              ? "bg-card-elevated text-muted-foreground ring-border/60"
              : "bg-brand-soft text-brand ring-border/60",
          )}
        >
          {m.semMercado ? <Store className="h-5 w-5" /> : <Award className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold md:text-lg">{nome}</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {t("mercados.card.products", { count: m.produtos })} ·{" "}
            {t("mercados.card.records", { count: m.registros })}
          </p>
        </div>
      </header>

      <div
        className={cn(
          "rounded-2xl p-3 ring-1",
          tone.bg,
          tone.ring,
        )}
      >
        <p className={cn("text-sm font-semibold", tone.text)}>{statusLabel}</p>
        <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{statusDesc}</p>
        {m.diffMedioPercent !== null && !m.semMercado && (
          <p className="mt-1 text-[11px] font-medium tabular-nums text-muted-foreground">
            {m.diffMedioPercent < 0
              ? t("mercados.card.diffAverageBelow", { value: Math.abs(m.diffMedioPercent) })
              : m.diffMedioPercent > 0
                ? t("mercados.card.diffAverageAbove", { value: m.diffMedioPercent })
                : t("mercados.card.diffAverageEqual")}
          </p>
        )}
      </div>

      <div>
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          <TrendingDown className="h-3.5 w-3.5" />
          {t("mercados.card.bestPricesTitle")}
        </p>
        {m.melhoresProdutos.filter((p) => p.diffPercent < 0).length === 0 ? (
          <p className="mt-2 text-[12px] text-muted-foreground">
            {t("mercados.card.noBestPrices")}
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {m.melhoresProdutos
              .filter((p) => p.diffPercent < 0)
              .map((p) => (
                <li
                  key={p.produtoKey}
                  className="rounded-2xl border border-border/60 bg-card-elevated p-2.5"
                >
                  <p className="truncate text-[13px] font-semibold">{p.produtoNome}</p>
                  <p className="mt-0.5 truncate text-[11px] tabular-nums text-muted-foreground">
                    {t("mercados.card.priceVsAverage", {
                      price: formatBRL(p.precoNesteMercado),
                      avg: formatBRL(p.precoMedioGlobal),
                    })}
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium tabular-nums text-success">
                    {t("mercados.card.diffBelow", { value: Math.abs(p.diffPercent) })}
                  </p>
                </li>
              ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {t("mercados.card.lastDate", {
          date: dateFormatter.format(new Date(m.ultimoEm)),
        })}
      </p>
    </article>
  );
}

function formatBRL(value: number): string {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  } catch {
    return `R$ ${value.toFixed(2)}`;
  }
}
