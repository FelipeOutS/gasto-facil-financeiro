import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Home, BarChart3, Info, PackageSearch, Store, ChevronRight } from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { Money } from "@/components/Money";
import { MercadoBanner } from "@/components/mercado/shell/MercadoBanner";
import bannerComunitario from "@/assets/mercado/banner-comunitario.jpg";
import bannerComunitarioWebp from "@/assets/mercado/banner-comunitario.webp";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  MERCADO_FILTRO_ALL,
  MERCADO_FILTRO_SEM,
  agruparResumosPorProduto,
  buildMercadosDisponiveis,
  filterRegistrosPrecoPorMercado,
  useHistoricoPrecos,
} from "@/lib/mercado/precos-history";

export const Route = createFileRoute("/mercado_/precos-historico")({
  head: () => ({
    meta: [{ title: i18n.t("mercado:precosHistorico.metaTitle", { lng: i18n.language }) }],
  }),
  component: PrecosHistoricoPage,
});

function PrecosHistoricoPage() {
  const { t, i18n: i18nInst } = useTranslation("mercado");
  const navigate = useNavigate();
  const registros = useHistoricoPrecos();
  const [filtro, setFiltro] = useState<string>(MERCADO_FILTRO_ALL);

  const mercados = useMemo(() => buildMercadosDisponiveis(registros), [registros]);

  // If the active filter no longer exists in the data (e.g. user deleted history),
  // gracefully fall back to "all" — pure computation, no effect needed.
  // The Select and the filter logic BOTH consume filtroEfetivo to stay in sync.
  const filtroEfetivo = useMemo(() => {
    if (filtro === MERCADO_FILTRO_ALL || filtro === MERCADO_FILTRO_SEM) return filtro;
    const exists = mercados.some((m) => m.toLowerCase() === filtro.toLowerCase());
    return exists ? filtro : MERCADO_FILTRO_ALL;
  }, [filtro, mercados]);

  const registrosFiltrados = useMemo(
    () => filterRegistrosPrecoPorMercado(registros, filtroEfetivo),
    [registros, filtroEfetivo],
  );
  const resumos = useMemo(
    () => agruparResumosPorProduto(registrosFiltrados),
    [registrosFiltrados],
  );


  function handleBack() {
    void navigate({ to: "/mercado", replace: true });
  }

  const dateFormatter = new Intl.DateTimeFormat(i18nInst.language || "pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const isAll = filtroEfetivo === MERCADO_FILTRO_ALL;
  const isSem = filtroEfetivo === MERCADO_FILTRO_SEM;
  const isMarket = !isAll && !isSem;

  const summaryText = isAll
    ? t("precosHistorico.filters.showingAll")
    : isSem
      ? t("precosHistorico.filters.showingNoMarket")
      : t("precosHistorico.filters.showingMarket", { value: filtroEfetivo });

  const hasAnyHistory = registros.length > 0;

  return (
    <MobileShell wide>
      <header className="flex items-start gap-3 pt-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label={t("precosHistorico.back")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Link
          to="/app"
          aria-label={t("precosHistorico.home")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <Home className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
              <BarChart3 className="h-4 w-4" />
            </span>
            <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">
              {t("precosHistorico.title")}
            </h1>
          </div>
          <p className="mt-1 text-sm leading-snug text-muted-foreground md:text-base">
            {t("precosHistorico.subtitle")}
          </p>
        </div>
      </header>

      <div className="mt-4">
        <MercadoBanner
          title={t("priceHistoryV2.banner.title")}
          subtitle={t("priceHistoryV2.banner.subtitle")}
          imageSrc={bannerComunitario}
          imageSrcWebp={bannerComunitarioWebp}
          tone="community"
        />
      </div>



      {/* Aviso local */}
      <section className="mt-5 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card-elevated text-brand ring-1 ring-border/60">
            <Info className="h-4 w-4" />
          </span>
          <p className="text-sm leading-snug text-foreground md:text-[15px]">
            {t("precosHistorico.localNotice")}
          </p>
        </div>
      </section>

      {/* CTA: comparativo por mercado */}
      <Link
        to="/mercado/mercados"
        preload="intent"
        className="mt-4 flex items-center justify-between gap-3 rounded-3xl border border-border/60 bg-card p-4 shadow-card transition-colors hover:bg-card-elevated active:scale-[0.99] md:p-5"
      >
        <div className="flex items-start gap-3 min-w-0">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
            <Store className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold md:text-base">
              {t("mercados.ctaFromHistorico.title")}
            </p>
            <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground md:text-[13px]">
              {t("mercados.ctaFromHistorico.desc")}
            </p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>

      {hasAnyHistory && (
        <section className="mt-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card-elevated text-brand ring-1 ring-border/60">
                <Store className="h-4 w-4" />
              </span>
              <label
                htmlFor="mercado-filtro"
                className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
              >
                {t("precosHistorico.filters.label")}
              </label>
            </div>
            <div className="w-full md:max-w-xs">
              <Select value={filtroEfetivo} onValueChange={setFiltro}>
                <SelectTrigger id="mercado-filtro" className="h-11 rounded-2xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MERCADO_FILTRO_ALL}>
                    {t("precosHistorico.filters.all")}
                  </SelectItem>
                  <SelectItem value={MERCADO_FILTRO_SEM}>
                    {t("precosHistorico.filters.noMarket")}
                  </SelectItem>
                  {mercados.map((m) => (
                    <SelectItem key={m} value={m}>
                      <span className="block max-w-[14rem] truncate">{m}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="mt-3 text-xs leading-snug text-muted-foreground md:text-sm">
            {summaryText}
          </p>
        </section>
      )}

      {!hasAnyHistory ? (
        <EmptyHistory t={t} />
      ) : resumos.length === 0 ? (
        <FilteredEmpty isSem={isSem} t={t} />
      ) : (
        <section className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {resumos.map((r) => (
            <article
              key={r.produtoKey}
              className="flex flex-col gap-3 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5"
            >
              <header className="min-w-0">
                <h2 className="truncate text-base font-semibold md:text-lg">{r.produtoNome}</h2>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {t("precosHistorico.card.recordsCount", { count: r.registros })}
                  {r.unidade ? ` · ${r.unidade}` : ""}
                </p>
              </header>

              <div className="grid grid-cols-2 gap-2">
                <Tile label={t("precosHistorico.card.min")} value={<Money value={r.precoMin} />} tone="success" />
                <Tile label={t("precosHistorico.card.max")} value={<Money value={r.precoMax} />} tone="destructive" />
                <Tile label={t("precosHistorico.card.avg")} value={<Money value={r.precoMedio} />} />
                <Tile label={t("precosHistorico.card.last")} value={<Money value={r.ultimoPreco} />} />
              </div>

              <p className="truncate text-[11px] text-muted-foreground">
                {isSem
                  ? t("precosHistorico.card.marketUnknown")
                  : isMarket
                    ? t("precosHistorico.card.filteredBy", { value: filtroEfetivo })
                    : r.mercados.length === 0
                      ? t("precosHistorico.card.marketUnknown")
                      : r.mercados.length === 1
                        ? t("precosHistorico.card.marketSingle", { value: r.mercados[0] })
                        : t("precosHistorico.card.marketMultiple", { count: r.mercados.length })}
              </p>

              <p className="text-[11px] text-muted-foreground">
                {t("precosHistorico.card.lastDate", {
                  date: dateFormatter.format(new Date(r.ultimoEm)),
                })}
              </p>
            </article>
          ))}
        </section>
      )}
    </MobileShell>
  );
}

function EmptyHistory({ t }: { t: (k: string) => string }) {
  return (
    <section className="mt-5 grid place-items-center rounded-3xl border border-dashed border-border/60 bg-card p-8 text-center shadow-card">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
        <PackageSearch className="h-6 w-6" />
      </span>
      <h2 className="mt-3 text-base font-semibold md:text-lg">
        {t("precosHistorico.empty.title")}
      </h2>
      <p className="mt-1 max-w-md text-sm leading-snug text-muted-foreground">
        {t("precosHistorico.empty.desc")}
      </p>
      <Link
        to="/mercado/listas"
        className="mt-4 inline-flex h-11 items-center justify-center rounded-2xl bg-brand-grad px-5 text-sm font-semibold text-primary-foreground shadow-elevated active:scale-[0.99]"
      >
        {t("precosHistorico.empty.cta")}
      </Link>
    </section>
  );
}

function FilteredEmpty({
  isSem,
  t,
}: {
  isSem: boolean;
  t: (k: string) => string;
}) {
  return (
    <section className="mt-5 grid place-items-center rounded-3xl border border-dashed border-border/60 bg-card p-8 text-center shadow-card">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
        <PackageSearch className="h-6 w-6" />
      </span>
      <h2 className="mt-3 text-base font-semibold md:text-lg">
        {isSem
          ? t("precosHistorico.filters.emptyNoMarketTitle")
          : t("precosHistorico.filters.emptyMarketTitle")}
      </h2>
      <p className="mt-1 max-w-md text-sm leading-snug text-muted-foreground">
        {isSem
          ? t("precosHistorico.filters.emptyNoMarketDescription")
          : t("precosHistorico.filters.emptyMarketDescription")}
      </p>
    </section>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "success" | "destructive";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "destructive"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-2xl border border-border/60 bg-card-elevated p-3">
      <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-sm font-bold tabular-nums md:text-base ${toneClass}`}>{value}</p>
    </div>
  );
}
