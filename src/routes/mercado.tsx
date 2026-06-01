import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ShoppingCart,
  ListChecks,
  Calculator,
  WalletCards,
  History,
  PackageCheck,
  ChevronRight,
  BarChart3,
  Store,
  MapPin,
  Receipt,
  BadgePercent,
  Lock,
  Plus,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { cn } from "@/lib/utils";
import { usePlan } from "@/lib/use-plan";
import type { FeatureKey } from "@/lib/plans";
import { useAuth } from "@/lib/auth-context";
import { formatBRL } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { useMercadoListas } from "@/lib/mercado/listas-store";
import { useMercadosLocais } from "@/lib/mercado/mercados-store";
import { useMercadoOrcamento } from "@/lib/mercado/orcamento-store";
import {
  MercadoHeader,
  MercadoBanner,
  MercadoCategoryChips,
  MercadoShowcase,
  ProductCard,
  SectionBlock,
  type MercadoCategoryKey,
  type ProductSource,
} from "@/components/mercado/shell";

import heroHome from "@/assets/mercado/hero-home.jpg";
import heroHomeWebp from "@/assets/mercado/hero-home.webp";
import bannerMercados from "@/assets/mercado/banner-mercados.jpg";
import bannerMercadosWebp from "@/assets/mercado/banner-mercados.webp";
import bannerOrcamento from "@/assets/mercado/banner-orcamento.jpg";
import bannerOrcamentoWebp from "@/assets/mercado/banner-orcamento.webp";
import emptyComunitario from "@/assets/mercado/empty-comunitario.webp";
import catHortifruti from "@/assets/mercado/cat-hortifruti.webp";
import catAcougue from "@/assets/mercado/cat-acougue.webp";
import catPadaria from "@/assets/mercado/cat-padaria.webp";
import catBebidas from "@/assets/mercado/cat-bebidas.webp";
import catLaticinios from "@/assets/mercado/cat-laticinios.webp";
import catLimpeza from "@/assets/mercado/cat-limpeza.webp";
import catMercearia from "@/assets/mercado/cat-mercearia.webp";
import catUtilidades from "@/assets/mercado/cat-utilidades.webp";

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
    | "importarCupom"
    | "precoComunitario";
  icon: LucideIcon;
  status: CardStatus;
  to?: string;
  feature?: FeatureKey;
};

const CARDS: CardDef[] = [
  { key: "listas", icon: ListChecks, status: "open", to: "/mercado/listas" },
  { key: "calculadoras", icon: Calculator, status: "open", to: "/mercado/calculadoras" },
  { key: "orcamento", icon: WalletCards, status: "open", to: "/mercado/orcamento" },
  { key: "historico", icon: History, status: "open", to: "/mercado/historico", feature: "mercado_avancado" },
  { key: "carrinho", icon: ShoppingCart, status: "open", to: "/mercado/carrinho" },
  { key: "importarCupom", icon: Receipt, status: "open", to: "/mercado/importar-cupom", feature: "mercado_importar_cupom" },
  { key: "precoComunitario", icon: BadgePercent, status: "open", to: "/mercado/preco-comunitario", feature: "mercado_avancado" },
  { key: "mercados", icon: Store, status: "open", to: "/mercado/mercados", feature: "mercado_avancado" },
  { key: "meusMercados", icon: MapPin, status: "open", to: "/mercado/meus-mercados", feature: "mercado_avancado" },
  { key: "precos", icon: BarChart3, status: "open", to: "/mercado/precos", feature: "mercado_avancado" },
  { key: "cesta", icon: PackageCheck, status: "open", to: "/mercado/cesta", feature: "mercado_avancado" },
];

type QuickAction = {
  key: "listas" | "carrinho" | "orcamento" | "precoComunitario" | "meusMercados";
  icon: LucideIcon;
  to: string;
  feature?: FeatureKey;
  tone: "fresh" | "drinks" | "bakery" | "community" | "meat";
};

const QUICK_ACTIONS: QuickAction[] = [
  { key: "listas", icon: ListChecks, to: "/mercado/listas", tone: "fresh" },
  { key: "carrinho", icon: ShoppingCart, to: "/mercado/carrinho", tone: "drinks" },
  { key: "orcamento", icon: WalletCards, to: "/mercado/orcamento", tone: "bakery" },
  { key: "precoComunitario", icon: BadgePercent, to: "/mercado/preco-comunitario", feature: "mercado_avancado", tone: "community" },
  { key: "meusMercados", icon: MapPin, to: "/mercado/meus-mercados", feature: "mercado_avancado", tone: "meat" },
];

const CATEGORY_ICONS: Record<MercadoCategoryKey, string> = {
  hortifruti: catHortifruti,
  acougue: catAcougue,
  padaria: catPadaria,
  bebidas: catBebidas,
  laticinios: catLaticinios,
  limpeza: catLimpeza,
  mercearia: catMercearia,
  utilidades: catUtilidades,
};

const CATEGORY_MATCHERS: Record<MercadoCategoryKey, string[]> = {
  hortifruti: ["hortifruti", "fruta", "verdura", "legume", "horti"],
  acougue: ["açougue", "acougue", "carne", "frango", "peixe", "bovino", "suíno", "suino"],
  padaria: ["padaria", "pão", "pao", "bolo", "confeitaria"],
  bebidas: ["bebida", "refrigerante", "suco", "cerveja", "vinho", "água", "agua"],
  laticinios: ["laticínio", "laticinio", "leite", "queijo", "iogurte", "manteiga"],
  limpeza: ["limpeza", "sabão", "sabao", "detergente", "amaciante", "desinfetante"],
  mercearia: ["mercearia", "arroz", "feijão", "feijao", "massa", "macarrão", "macarrao", "óleo", "oleo", "açúcar", "acucar"],
  utilidades: ["utilidade", "utensílio", "utensilio", "papel", "descart", "higiene"],
};

type CommunityPriceRow = {
  id: string;
  product_name: string;
  category: string | null;
  price: number;
  unit: string | null;
  market_name: string;
  source: string;
  seen_at: string;
  image_url: string | null;
  image_source: string | null;
  image_confidence: number | null;
  brand: string | null;
  barcode: string | null;
};

const SOURCE_MAP: Record<string, ProductSource> = {
  flyer: "flyer",
  store: "store",
  receipt: "receipt",
  manual: "manual",
  online: "online",
  community: "community",
};

function MercadoHubPage() {
  const { t, i18n: i18nInst } = useTranslation("mercado");
  const { can } = usePlan();
  const { user } = useAuth();
  const listas = useMercadoListas();
  const mercados = useMercadosLocais();
  const orcamento = useMercadoOrcamento();

  const [searchValue, setSearchValue] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<MercadoCategoryKey | null>(null);
  const [recent, setRecent] = useState<CommunityPriceRow[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRecentLoading(true);
      try {
        const { data, error } = await (supabase.from("community_market_prices" as never) as any)
          .select("id,product_name,category,price,unit,market_name,source,seen_at,image_url,image_source,image_confidence,brand,barcode")
          .eq("status", "active")
          .order("seen_at", { ascending: false })
          .limit(24);
        if (!cancelled) {
          if (error) {
            setRecent([]);
          } else {
            setRecent((data ?? []) as CommunityPriceRow[]);
          }
        }
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const userName = useMemo(() => {
    if (!user) return null;
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const name = (meta.full_name as string) || (meta.name as string) || null;
    if (name) return String(name).split(" ")[0];
    if (user.email) return user.email.split("@")[0];
    return null;
  }, [user]);

  const favoriteMarket = useMemo(() => {
    const fav = mercados.find((m) => m.favorito);
    return (fav ?? mercados[0])?.nome ?? null;
  }, [mercados]);

  const activeList = useMemo(() => {
    const ongoing = listas.find((l) => l.status === "ongoing");
    if (ongoing) return ongoing;
    return listas.find((l) => l.status === "planning") ?? null;
  }, [listas]);

  const dateLocale = i18nInst.language?.startsWith("en") ? "en-US" : "pt-BR";

  const filteredRecent = useMemo(() => {
    const q = searchValue.trim().toLowerCase();
    const matchers = selectedCategory ? CATEGORY_MATCHERS[selectedCategory] : null;
    return recent
      .filter((r) => {
        if (q) {
          const hay = `${r.product_name} ${r.market_name} ${r.category ?? ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (matchers) {
          const cat = (r.category ?? "").toLowerCase();
          const name = r.product_name.toLowerCase();
          const hit = matchers.some((m) => cat.includes(m) || name.includes(m));
          if (!hit) return false;
        }
        return true;
      })
      .slice(0, 12);
  }, [recent, searchValue, selectedCategory]);

  return (
    <MobileShell wide>
      <MercadoHeader
        userName={userName}
        selectedMarket={favoriteMarket}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
      />

      {/* Hero banner */}
      <div className="mt-5">
        <MercadoBanner
          tone="community"
          imageSrc={heroHome}
          imageSrcWebp={heroHomeWebp}
          imageAlt={t("homeV2.heroTitle")}
          title={t("homeV2.heroTitle")}
          subtitle={t("homeV2.heroSubtitle")}
          priority
          cta={
            <Link
              to="/mercado/listas"
              preload="intent"
              className="inline-flex h-11 items-center gap-1.5 rounded-full bg-brand-grad px-5 text-sm font-semibold text-primary-foreground shadow-elevated transition active:scale-[0.97]"
            >
              <ListChecks className="h-4 w-4" aria-hidden="true" />
              {t("homeV2.heroCta")}
            </Link>
          }
        />
      </div>

      {/* Categories */}
      <SectionBlock
        title={t("homeV2.categoriesTitle")}
        description={t("homeV2.categoriesDesc")}
        action={
          selectedCategory ? (
            <button
              type="button"
              onClick={() => setSelectedCategory(null)}
              className="text-xs font-medium text-brand hover:underline"
            >
              {t("homeV2.categoriesClear")}
            </button>
          ) : undefined
        }
      >
        <MercadoCategoryChips
          selected={selectedCategory}
          onSelect={(k) => setSelectedCategory((prev) => (prev === k ? null : k))}
          iconFor={(k) => CATEGORY_ICONS[k]}
        />
      </SectionBlock>

      {/* Quick actions */}
      <SectionBlock
        title={t("homeV2.quickActionsTitle")}
        description={t("homeV2.quickActionsDesc")}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {QUICK_ACTIONS.map((q) => {
            const Icon = q.icon;
            const isLocked = !!q.feature && !can(q.feature);
            const to = isLocked ? "/meu-plano" : q.to;
            const tint = `var(--color-mercado-${q.tone})`;
            return (
              <Link
                key={q.key}
                to={to}
                preload="intent"
                className={cn(
                  "group relative flex min-h-[112px] flex-col justify-between rounded-2xl border border-border/60 bg-card p-3 shadow-card transition active:scale-[0.98] hover:bg-card-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                )}
                style={{
                  backgroundImage: `linear-gradient(160deg, color-mix(in oklab, ${tint} 14%, var(--card)) 0%, var(--card) 70%)`,
                }}
                aria-label={isLocked ? t("hub.lockedCta") : t(`homeV2.quickActions.${q.key}`)}
              >
                <span
                  className="grid h-10 w-10 place-items-center rounded-xl ring-1 ring-border/60"
                  style={{ backgroundColor: `color-mix(in oklab, ${tint} 22%, var(--card))`, color: tint }}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="flex items-end justify-between gap-1">
                  <span className="text-sm font-semibold leading-tight text-foreground">
                    {t(`homeV2.quickActions.${q.key}`)}
                  </span>
                  {isLocked ? (
                    <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </SectionBlock>

      {/* Recent prices */}
      <SectionBlock
        title={t("homeV2.recentTitle")}
        description={t("homeV2.recentDesc")}
        action={
          <Link
            to="/mercado/preco-comunitario"
            className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
          >
            {t("homeV2.recentSeeAll")}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        }
      >
        {recentLoading ? (
          <div className="no-scrollbar -mx-3 flex gap-3 overflow-x-auto px-3 pb-2 sm:-mx-0 sm:px-0">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[260px] w-[180px] shrink-0 animate-pulse rounded-2xl border border-border/60 bg-card-elevated/60"
              />
            ))}
          </div>
        ) : filteredRecent.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border/60 bg-card-elevated/40 p-6 text-center">
            <img
              src={emptyComunitario}
              alt=""
              className="h-24 w-24 opacity-90"
              loading="lazy"
            />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {t("homeV2.recentEmptyTitle")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("homeV2.recentEmptyDesc")}
              </p>
            </div>
            <Link
              to="/mercado/preco-comunitario"
              className="inline-flex h-11 items-center gap-1.5 rounded-full bg-brand-grad px-4 text-sm font-semibold text-primary-foreground shadow-elevated transition active:scale-[0.97]"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("homeV2.recentEmptyCta")}
            </Link>
          </div>
        ) : (
          <MercadoShowcase itemMinWidth="180px">
            {filteredRecent.map((r) => (
              <ProductCard
                key={r.id}
                name={r.product_name}
                priceLabel={formatBRL(r.price)}
                unitLabel={r.unit ?? undefined}
                imageUrl={r.image_url ?? undefined}
                brand={r.brand}
                barcode={r.barcode}
                category={(r.category ?? null) as MercadoCategoryKey | null}
                marketName={r.market_name}
                source={SOURCE_MAP[r.source] ?? "community"}
                seenAtLabel={
                  r.seen_at
                    ? new Date(r.seen_at).toLocaleDateString(dateLocale)
                    : undefined
                }
              />
            ))}
          </MercadoShowcase>
        )}
      </SectionBlock>

      {/* Next purchase */}
      <SectionBlock
        title={t("homeV2.nextPurchaseTitle")}
        description={t("homeV2.nextPurchaseDesc")}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-card">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              <ListChecks className="h-4 w-4 text-brand" aria-hidden="true" />
              {t("homeV2.nextPurchase.activeListLabel")}
            </div>
            {activeList ? (
              <>
                <p className="mt-2 line-clamp-2 text-base font-semibold text-foreground">
                  {activeList.name}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("homeV2.nextPurchase.itemsCount", { count: activeList.items })}
                </p>
                <Link
                  to="/mercado/listas/$id"
                  params={{ id: activeList.id }}
                  preload="intent"
                  className="mt-3 inline-flex h-10 items-center justify-center gap-1 rounded-full bg-brand-soft px-4 text-xs font-semibold text-brand-on-soft transition active:scale-[0.97]"
                >
                  {t("homeV2.nextPurchase.openList")}
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {t("homeV2.nextPurchase.noListTitle")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("homeV2.nextPurchase.noListDesc")}
                </p>
                <Link
                  to="/mercado/listas/nova"
                  preload="intent"
                  className="mt-3 inline-flex h-10 items-center justify-center gap-1 rounded-full bg-brand-grad px-4 text-xs font-semibold text-primary-foreground shadow-elevated transition active:scale-[0.97]"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("homeV2.nextPurchase.createList")}
                </Link>
              </>
            )}
          </div>

          <Link
            to="/mercado/carrinho"
            preload="intent"
            className="flex flex-col rounded-2xl border border-border/60 bg-card p-4 shadow-card transition active:scale-[0.99] hover:bg-card-elevated"
          >
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              <ShoppingCart className="h-4 w-4 text-brand" aria-hidden="true" />
              {t("homeV2.quickActions.carrinho")}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("hub.cards.carrinho.desc")}
            </p>
            <span className="mt-auto pt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand">
              {t("homeV2.nextPurchase.openCart")}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </Link>

          <Link
            to="/mercado/orcamento"
            preload="intent"
            className="flex flex-col rounded-2xl border border-border/60 bg-card p-4 shadow-card transition active:scale-[0.99] hover:bg-card-elevated"
          >
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              <WalletCards className="h-4 w-4 text-brand" aria-hidden="true" />
              {t("homeV2.nextPurchase.budgetLabel")}
            </div>
            <p className="mt-2 text-base font-semibold text-foreground num">
              {orcamento.valorMensal > 0
                ? formatBRL(orcamento.valorMensal)
                : t("homeV2.nextPurchase.noBudget")}
            </p>
            <span className="mt-auto pt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand">
              {t("homeV2.nextPurchase.openBudget")}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </Link>
        </div>
      </SectionBlock>

      {/* Markets near you */}
      <SectionBlock title={t("homeV2.marketsTitle")} description={t("homeV2.marketsDesc")}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <MercadoBanner
            tone="meat"
            imageSrc={bannerMercados}
            imageSrcWebp={bannerMercadosWebp}
            title={t("homeV2.marketsTitle")}
            subtitle={t("homeV2.marketsDesc")}
            cta={
              <Link
                to={can("mercado_avancado") ? "/mercado/meus-mercados" : "/meu-plano"}
                preload="intent"
                className="inline-flex h-11 items-center gap-1.5 rounded-full bg-brand-grad px-4 text-sm font-semibold text-primary-foreground shadow-elevated transition active:scale-[0.97]"
              >
                <MapPin className="h-4 w-4" aria-hidden="true" />
                {t("homeV2.marketsCta")}
                {!can("mercado_avancado") && <Lock className="h-3.5 w-3.5" aria-hidden="true" />}
              </Link>
            }
          />
          <div className="flex flex-col gap-3">
            <Link
              to={can("mercado_avancado") ? "/mercado/mercados" : "/meu-plano"}
              preload="intent"
              className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card p-4 shadow-card transition active:scale-[0.99] hover:bg-card-elevated"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand">
                  <Store className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {t("homeV2.marketsSecondaryCta")}
                </span>
              </div>
              {can("mercado_avancado") ? (
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              ) : (
                <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              )}
            </Link>
            <Link
              to={can("mercado_avancado") ? "/mercado/preco-comunitario" : "/meu-plano"}
              preload="intent"
              className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card p-4 shadow-card transition active:scale-[0.99] hover:bg-card-elevated"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand">
                  <BadgePercent className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {t("homeV2.marketsTertiaryCta")}
                </span>
              </div>
              {can("mercado_avancado") ? (
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              ) : (
                <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              )}
            </Link>
          </div>
        </div>
      </SectionBlock>

      {/* Budget banner */}
      <SectionBlock title={t("homeV2.budgetTitle")} description={t("homeV2.budgetDesc")}>
        <MercadoBanner
          tone="bakery"
          imageSrc={bannerOrcamento}
          imageSrcWebp={bannerOrcamentoWebp}
          title={t("homeV2.budgetTitle")}
          subtitle={t("homeV2.budgetDesc")}
          cta={
            <Link
              to="/mercado/orcamento"
              preload="intent"
              className="inline-flex h-11 items-center gap-1.5 rounded-full bg-brand-grad px-4 text-sm font-semibold text-primary-foreground shadow-elevated transition active:scale-[0.97]"
            >
              <WalletCards className="h-4 w-4" aria-hidden="true" />
              {t("homeV2.budgetCta")}
            </Link>
          }
        />
      </SectionBlock>

      {/* All tools — expandable */}
      <details className="mt-8 group rounded-3xl border border-border/60 bg-card shadow-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-3xl p-4 md:p-5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight md:text-lg">
              {t("homeV2.toolsTitle")}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground md:text-sm">
              {t("homeV2.toolsDesc")}
            </p>
          </div>
          <ChevronDown
            className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="grid grid-cols-1 gap-3 p-4 pt-0 md:grid-cols-2 md:p-5 md:pt-0 xl:grid-cols-3">
          {CARDS.map((card) => {
            const Icon = card.icon;
            const isLocked = !!card.feature && !can(card.feature);
            const statusKey: CardStatus | "locked" = isLocked ? "locked" : card.status;
            const statusLabel = t(`hub.status.${statusKey}`);
            const isInteractive = !!card.to && !isLocked;
            const statusClass = isLocked
              ? "bg-muted text-muted-foreground ring-1 ring-border/60"
              : card.status === "open"
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
                      isLocked
                        ? "bg-muted text-muted-foreground"
                        : isInteractive
                          ? "bg-brand-soft text-brand"
                          : "bg-card-elevated text-foreground",
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="flex items-center gap-1.5 truncate text-sm font-semibold md:text-base">
                      <span className="truncate">{t(`hub.cards.${card.key}.title`)}</span>
                      {isLocked && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    </h3>
                    <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground md:text-[13px]">
                      {isLocked ? t("hub.lockedDesc") : t(`hub.cards.${card.key}.desc`)}
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
              "group flex min-h-[120px] flex-col gap-3 rounded-2xl border border-border/60 bg-card-elevated/40 p-4 transition-colors";

            if (isLocked) {
              return (
                <Link
                  key={card.key}
                  to="/meu-plano"
                  className={cn(baseClasses, "hover:bg-card-elevated active:scale-[0.99] opacity-90")}
                  aria-label={t("hub.lockedCta")}
                >
                  {innerBody}
                </Link>
              );
            }

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
        </div>
      </details>

      <div className="h-6" aria-hidden="true" />
    </MobileShell>
  );
}
