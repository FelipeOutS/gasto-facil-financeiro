import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Home,
  TrendingUp,
  DollarSign,
  MapPin,
  Clock,
  Users,
  Shield,
  BarChart3,
  Info,
  Store,
} from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { Money } from "@/components/Money";
import { cn } from "@/lib/utils";
import { MercadoBanner } from "@/components/mercado/shell/MercadoBanner";
import bannerPrecos from "@/assets/mercado/banner-comunitario.jpg";

export const Route = createFileRoute("/mercado_/precos")({
  head: () => ({
    meta: [{ title: i18n.t("mercado:precos.metaTitle", { lng: i18n.language }) }],
  }),
  component: PrecosPage,
});

function PrecosPage() {
  const { t } = useTranslation("mercado");
  const navigate = useNavigate();

  function handleBack() {
    void navigate({ to: "/mercado", replace: true });
  }

  const featureCards = [
    {
      key: "averagePrice" as const,
      icon: TrendingUp,
    },
    {
      key: "minMax" as const,
      icon: DollarSign,
    },
    {
      key: "markets" as const,
      icon: MapPin,
    },
    {
      key: "history" as const,
      icon: Clock,
    },
    {
      key: "community" as const,
      icon: Users,
    },
  ];

  const steps = [1, 2, 3, 4] as const;
  const privacyPoints = [1, 2, 3, 4, 5] as const;

  return (
    <MobileShell wide>
      <header className="flex items-start gap-3 pt-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label={t("precos.back")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Link
          to="/app"
          aria-label={t("precos.home")}
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
              {t("precos.title")}
            </h1>
          </div>
          <p className="mt-1 text-sm leading-snug text-muted-foreground md:text-base">
            {t("precos.subtitle")}
          </p>
        </div>
      </header>

      <div className="mt-4">
        <MercadoBanner
          title={t("priceCompareV2.banner.title")}
          subtitle={t("priceCompareV2.banner.subtitle")}
          imageSrc={bannerPrecos}
          tone="community"
        />
      </div>

      {/* Intro */}
      <section className="mt-5 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card-elevated text-brand ring-1 ring-border/60">
            <Info className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm leading-snug text-foreground md:text-[15px]">
              {t("precos.intro.text")}
            </p>
            <span
              className={cn(
                "mt-2 inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest",
                "bg-warning/15 text-warning ring-1 ring-warning/30",
              )}
            >
              {t("precos.badge.preparing")}
            </span>
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {featureCards.map((card) => {
          const Icon = card.icon;
          return (
            <article
              key={card.key}
              className="flex min-h-[120px] flex-col gap-3 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold md:text-base">
                    {t(`precos.featureCards.${card.key}.title`)}
                  </h2>
                  <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground md:text-[13px]">
                    {t(`precos.featureCards.${card.key}.desc`)}
                  </p>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {/* Mock example */}
      <section className="mt-5 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold md:text-lg">{t("precos.mock.title")}</h2>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest",
              "bg-warning/15 text-warning ring-1 ring-warning/30",
            )}
          >
            {t("precos.mock.status")}
          </span>
        </div>

        <p className="mt-1 text-[12px] text-muted-foreground">{t("precos.mock.disclaimer")}</p>

        <div className="mt-4 rounded-2xl border border-border/60 bg-card-elevated p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold md:text-base">
                {t("precos.mock.productName")}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t("precos.mock.lastUpdate")}
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <MockTile label={t("precos.mock.averageLabel")} value={<Money value={28.9} />} />
            <MockTile
              label={t("precos.mock.minLabel")}
              value={<Money value={24.99} />}
              tone="success"
            />
            <MockTile
              label={t("precos.mock.maxLabel")}
              value={<Money value={34.9} />}
              tone="destructive"
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mt-5 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
        <h2 className="text-base font-semibold md:text-lg">{t("precos.howItWorks.title")}</h2>
        <ol className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {steps.map((n) => (
            <li
              key={n}
              className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card-elevated p-3"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-bold text-brand">
                {n}
              </span>
              <p className="text-[13px] leading-snug text-foreground">
                {t(`precos.howItWorks.step${n}`)}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* Privacy */}
      <section className="mt-5 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
            <Shield className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold md:text-lg">{t("precos.privacy.title")}</h2>
          </div>
        </div>
        <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {privacyPoints.map((n) => (
            <li
              key={n}
              className="flex items-start gap-2 rounded-2xl border border-border/60 bg-card-elevated p-3"
            >
              <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" />
              <p className="text-[13px] leading-snug text-foreground">
                {t(`precos.privacy.point${n}`)}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-4 rounded-2xl border border-border/60 bg-card-elevated p-3 text-[13px] leading-snug text-muted-foreground">
          {t("precos.privacy.futureOptIn")}
        </p>
      </section>

      {/* CTA: histórico local */}
      <section className="mt-5">
        <Link
          to="/mercado/precos-historico"
          preload="intent"
          className="flex items-center justify-between gap-3 rounded-3xl border border-border/60 bg-card p-4 shadow-card transition-colors hover:bg-card-elevated active:scale-[0.99] md:p-5"
        >
          <div className="flex items-start gap-3 min-w-0">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
              <Clock className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold md:text-base">
                {t("precos.ctaLocal.title")}
              </p>
              <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground md:text-[13px]">
                {t("precos.ctaLocal.desc")}
              </p>
            </div>
          </div>
        </Link>
      </section>

      {/* CTA: comparativo por mercado */}
      <section className="mt-3">
        <Link
          to="/mercado/mercados"
          preload="intent"
          className="flex items-center justify-between gap-3 rounded-3xl border border-border/60 bg-card p-4 shadow-card transition-colors hover:bg-card-elevated active:scale-[0.99] md:p-5"
        >
          <div className="flex items-start gap-3 min-w-0">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
              <Store className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold md:text-base">
                {t("mercados.ctaFromPrecos.title")}
              </p>
              <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground md:text-[13px]">
                {t("mercados.ctaFromPrecos.desc")}
              </p>
            </div>
          </div>
        </Link>
      </section>
    </MobileShell>
  );
}

function MockTile({
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
    <div className="rounded-2xl border border-border/60 bg-card p-3">
      <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-1 text-base font-bold tabular-nums", toneClass)}>{value}</p>
    </div>
  );
}
