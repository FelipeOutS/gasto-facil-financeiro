import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ShoppingCart,
  ListChecks,
  Calculator,
  WalletCards,
  History,
  PackageCheck,
  Sparkles,
  ChevronRight,
  BarChart3,
  Store,
  MapPin,
  Receipt,
  Lock,
  type LucideIcon,
} from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { cn } from "@/lib/utils";
import { usePlan } from "@/lib/use-plan";
import type { FeatureKey } from "@/lib/plans";

export const Route = createFileRoute("/mercado")({
  head: () => ({ meta: [{ title: i18n.t("mercado:meta.title", { lng: i18n.language }) }] }),
  component: MercadoHubPage,
});

type CardStatus = "soon" | "future" | "open";

type CardDef = {
  key:
    | "listas"
    | "calculadoras"
    | "orcamento"
    | "historico"
    | "carrinho"
    | "precos"
    | "cesta"
    | "mercados"
    | "meusMercados"
    | "importarCupom";
  icon: LucideIcon;
  status: CardStatus;
  to?: string;
  /** Etapa 16 — feature premium necessária para acessar este card. */
  feature?: FeatureKey;
};

const CARDS: CardDef[] = [
  { key: "listas", icon: ListChecks, status: "open", to: "/mercado/listas" },
  { key: "calculadoras", icon: Calculator, status: "open", to: "/mercado/calculadoras" },
  { key: "orcamento", icon: WalletCards, status: "open", to: "/mercado/orcamento" },
  { key: "historico", icon: History, status: "open", to: "/mercado/historico", feature: "mercado_avancado" },
  { key: "carrinho", icon: ShoppingCart, status: "open", to: "/mercado/carrinho" },
  { key: "importarCupom", icon: Receipt, status: "open", to: "/mercado/importar-cupom", feature: "mercado_importar_cupom" },
  { key: "mercados", icon: Store, status: "open", to: "/mercado/mercados", feature: "mercado_avancado" },
  { key: "meusMercados", icon: MapPin, status: "open", to: "/mercado/meus-mercados", feature: "mercado_avancado" },
  { key: "precos", icon: BarChart3, status: "future", to: "/mercado/precos", feature: "mercado_avancado" },
  { key: "cesta", icon: PackageCheck, status: "open", to: "/mercado/cesta", feature: "mercado_avancado" },
];

function MercadoHubPage() {
  const { t } = useTranslation("mercado");
  const { can } = usePlan();

  return (
    <MobileShell wide>
      <header className="flex items-start gap-3 pt-1">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
          <ShoppingCart className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t("hub.title")}</h1>
          <p className="mt-1 text-sm leading-snug text-muted-foreground md:text-base">
            {t("hub.subtitle")}
          </p>
        </div>
      </header>

      <section className="mt-5 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card-elevated text-brand ring-1 ring-border/60">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm leading-snug text-foreground md:text-[15px]">{t("hub.intro")}</p>
            <p className="mt-1 text-[11px] text-muted-foreground md:text-xs">{t("hub.futureNote")}</p>
          </div>
        </div>
      </section>

      <section className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {CARDS.map((card) => {
          const Icon = card.icon;
          const statusLabel = t(`hub.status.${card.status}`);
          const isInteractive = !!card.to;
          const statusClass =
            card.status === "open"
              ? "bg-brand-grad text-primary-foreground shadow-elevated"
              : card.status === "soon"
                ? "bg-brand-soft text-brand-on-soft"
                : "bg-card-elevated text-muted-foreground ring-1 ring-border/60";

          const innerBody = (
            <>
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "grid h-11 w-11 shrink-0 place-items-center rounded-2xl ring-1 ring-border/60",
                    isInteractive
                      ? "bg-brand-soft text-brand"
                      : "bg-card-elevated text-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold md:text-base">
                    {t(`hub.cards.${card.key}.title`)}
                  </h2>
                  <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground md:text-[13px]">
                    {t(`hub.cards.${card.key}.desc`)}
                  </p>
                </div>
                {isInteractive && (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </div>
              <div className="mt-auto flex items-center justify-end">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest",
                    statusClass,
                  )}
                >
                  {statusLabel}
                </span>
              </div>
            </>
          );

          const baseClasses =
            "group flex min-h-[120px] flex-col gap-3 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5 transition-colors";

          if (isInteractive) {
            return (
              <Link
                key={card.key}
                to={card.to!}
                preload="intent"
                preloadDelay={0}
                className={cn(baseClasses, "hover:bg-card-elevated active:scale-[0.99]")}
              >
                {innerBody}
              </Link>
            );
          }

          return (
            <article key={card.key} className={baseClasses} aria-disabled="true">
              {innerBody}
            </article>
          );
        })}
      </section>
    </MobileShell>
  );
}
