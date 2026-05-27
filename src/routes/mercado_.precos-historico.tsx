import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Home, BarChart3, Info, PackageSearch } from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { Money } from "@/components/Money";
import { useResumosPrecos } from "@/lib/mercado/precos-history";

export const Route = createFileRoute("/mercado_/precos-historico")({
  head: () => ({
    meta: [{ title: i18n.t("mercado:precosHistorico.metaTitle", { lng: i18n.language }) }],
  }),
  component: PrecosHistoricoPage,
});

function PrecosHistoricoPage() {
  const { t, i18n: i18nInst } = useTranslation("mercado");
  const navigate = useNavigate();
  const resumos = useResumosPrecos();

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }
    void navigate({ to: "/mercado" });
  }

  const dateFormatter = new Intl.DateTimeFormat(i18nInst.language || "pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <MobileShell wide>
      <header className="flex items-start gap-3 pt-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label={t("precosHistorico.back")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Link
          to="/app"
          aria-label={t("precosHistorico.home")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
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

      {resumos.length === 0 ? (
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
                {r.mercados.length === 0
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
