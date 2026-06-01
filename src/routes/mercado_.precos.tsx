import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Home,
  BarChart3,
  Info,
  Search,
  TrendingDown,
  Clock,
  Receipt,
  ChevronRight,
  PackageSearch,
  X,
} from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import {
  MercadoBanner,
  SectionBlock,
  MercadoShowcase,
  ProductCard,
  type ProductSource,
} from "@/components/mercado/shell";
import bannerPrecos from "@/assets/mercado/banner-comunitario.jpg";
import emptyComunitario from "@/assets/mercado/empty-comunitario.png";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/mercado_/precos")({
  head: () => ({
    meta: [{ title: i18n.t("mercado:precos.metaTitle", { lng: i18n.language }) }],
  }),
  component: PrecosPage,
});

type CommunityPriceRow = {
  id: string;
  product_name: string;
  category: string | null;
  price: number;
  unit: string | null;
  market_name: string;
  source: string;
  seen_at: string;
};

const SOURCE_MAP: Record<string, ProductSource> = {
  flyer: "flyer",
  store: "store",
  receipt: "receipt",
  manual: "manual",
  online: "online",
  community: "community",
};

const ALL = "__all__";

function PrecosPage() {
  const { t, i18n: i18nInst } = useTranslation("mercado");
  const navigate = useNavigate();
  const [rows, setRows] = useState<CommunityPriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [market, setMarket] = useState<string>(ALL);
  const [source, setSource] = useState<string>(ALL);
  const [sortBy, setSortBy] = useState<"recent" | "lowest" | "highest">("recent");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await (supabase.from("community_market_prices" as never) as any)
          .select("id,product_name,category,price,unit,market_name,source,seen_at")
          .eq("status", "active")
          .order("seen_at", { ascending: false })
          .limit(200);
        if (!cancelled) {
          setRows(error || !data ? [] : (data as CommunityPriceRow[]));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const markets = useMemo(
    () => Array.from(new Set(rows.map((r) => r.market_name).filter(Boolean))).sort(),
    [rows],
  );
  const sources = useMemo(
    () => Array.from(new Set(rows.map((r) => r.source).filter(Boolean))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (q) {
        const hay = `${r.product_name} ${r.market_name} ${r.category ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (market !== ALL && r.market_name !== market) return false;
      if (source !== ALL && r.source !== source) return false;
      return true;
    });
    if (sortBy === "lowest") list = [...list].sort((a, b) => a.price - b.price);
    else if (sortBy === "highest") list = [...list].sort((a, b) => b.price - a.price);
    else
      list = [...list].sort(
        (a, b) => new Date(b.seen_at).getTime() - new Date(a.seen_at).getTime(),
      );
    return list;
  }, [rows, search, market, source, sortBy]);

  const recentFinds = useMemo(
    () => [...rows].sort((a, b) => a.price - b.price).slice(0, 6),
    [rows],
  );

  const hasFilters =
    !!search.trim() || market !== ALL || source !== ALL || sortBy !== "recent";

  function clearFilters() {
    setSearch("");
    setMarket(ALL);
    setSource(ALL);
    setSortBy("recent");
  }

  const dateLocale = i18nInst.language?.startsWith("en") ? "en-US" : "pt-BR";

  return (
    <MobileShell wide>
      <header className="flex items-start gap-3 pt-1">
        <button
          type="button"
          onClick={() => void navigate({ to: "/mercado", replace: true })}
          aria-label={t("precos.back")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <Link
          to="/app"
          aria-label={t("precos.home")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <Home className="h-5 w-5" aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
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

      {/* Safety disclaimer */}
      <section className="mt-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card-elevated text-brand ring-1 ring-border/60">
            <Info className="h-4 w-4" aria-hidden="true" />
          </span>
          <p className="text-sm leading-snug text-foreground md:text-[15px]">
            {t("priceCompareV2.disclaimer")}
          </p>
        </div>
      </section>

      {/* Filters */}
      <section className="mt-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground md:text-base">
            {t("priceCompareV2.filters.title")}
          </h2>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-9 items-center gap-1 rounded-full border border-border/60 px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              {t("priceCompareV2.filters.clear")}
            </button>
          )}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="relative">
            <span className="sr-only">{t("priceCompareV2.filters.search")}</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("priceCompareV2.filters.search")}
              className="h-11 w-full rounded-2xl border border-border/60 bg-card-elevated pl-9 pr-3 text-sm text-foreground outline-none transition-colors focus:border-brand"
            />
          </label>
          <Select value={market} onValueChange={setMarket}>
            <SelectTrigger className="h-11 rounded-2xl" aria-label={t("priceCompareV2.filters.market")}>
              <SelectValue placeholder={t("priceCompareV2.filters.market")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("priceCompareV2.filters.market")}</SelectItem>
              {markets.map((m) => (
                <SelectItem key={m} value={m}>
                  <span className="block max-w-[14rem] truncate">{m}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="h-11 rounded-2xl" aria-label={t("priceCompareV2.filters.source")}>
              <SelectValue placeholder={t("priceCompareV2.filters.source")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("priceCompareV2.filters.source")}</SelectItem>
              {sources.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`shell.product.source.${SOURCE_MAP[s] ?? "community"}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
            <SelectTrigger className="h-11 rounded-2xl" aria-label={t("priceCompareV2.filters.sort")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">
                <span className="inline-flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("priceCompareV2.sections.recentFinds")}
                </span>
              </SelectItem>
              <SelectItem value="lowest">
                <span className="inline-flex items-center gap-2">
                  <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("precosHistorico.card.min")}
                </span>
              </SelectItem>
              <SelectItem value="highest">{t("precosHistorico.card.max")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      {/* Recent finds */}
      {!loading && recentFinds.length > 0 && (
        <SectionBlock
          title={t("priceCompareV2.sections.recentFinds")}
          description={t("priceCompareV2.card.checkBeforeBuying")}
        >
          <MercadoShowcase itemMinWidth="180px">
            {recentFinds.map((r) => (
              <ProductCard
                key={r.id}
                name={r.product_name}
                priceLabel={formatBRL(r.price)}
                unitLabel={r.unit ?? undefined}
                marketName={r.market_name}
                source={SOURCE_MAP[r.source] ?? "community"}
                seenAtLabel={
                  r.seen_at ? new Date(r.seen_at).toLocaleDateString(dateLocale) : undefined
                }
              />
            ))}
          </MercadoShowcase>
        </SectionBlock>
      )}

      {/* Results */}
      <SectionBlock
        title={t("priceCompareV2.sections.results")}
        description={
          loading
            ? undefined
            : t("precosHistorico.card.recordsCount", { count: filtered.length })
        }
      >
        {loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-[112px] animate-pulse rounded-2xl border border-border/60 bg-card-elevated/60"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          hasFilters ? (
            <FilteredEmpty onClear={clearFilters} />
          ) : (
            <GlobalEmpty />
          )
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((r) => (
              <ProductCard
                key={r.id}
                layout="list"
                name={r.product_name}
                priceLabel={formatBRL(r.price)}
                unitLabel={r.unit ?? undefined}
                marketName={r.market_name}
                source={SOURCE_MAP[r.source] ?? "community"}
                seenAtLabel={
                  r.seen_at ? new Date(r.seen_at).toLocaleDateString(dateLocale) : undefined
                }
              />
            ))}
          </div>
        )}
      </SectionBlock>

      {/* Bottom CTAs */}
      <section className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
        <CTACard
          to="/mercado/preco-comunitario"
          icon={<Receipt className="h-5 w-5" aria-hidden="true" />}
          title={t("precos.ctaLocal.title")}
          desc={t("precos.ctaLocal.desc")}
        />
        <CTACard
          to="/mercado/precos-historico"
          icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />}
          title={t("priceHistoryV2.banner.title")}
          desc={t("priceHistoryV2.banner.subtitle")}
        />
      </section>
    </MobileShell>
  );
}

function GlobalEmpty() {
  const { t } = useTranslation("mercado");
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border/60 bg-card p-6 text-center shadow-card md:p-8">
      <img
        src={emptyComunitario}
        alt=""
        className="h-24 w-24 opacity-90"
        loading="lazy"
      />
      <div>
        <h3 className="text-base font-semibold text-foreground md:text-lg">
          {t("priceCompareV2.empty.title")}
        </h3>
        <p className="mx-auto mt-1 max-w-md text-sm leading-snug text-muted-foreground">
          {t("priceCompareV2.empty.description")}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link
          to="/mercado/preco-comunitario"
          className="inline-flex h-11 items-center gap-1.5 rounded-full bg-brand-grad px-4 text-sm font-semibold text-primary-foreground shadow-elevated transition active:scale-[0.97]"
        >
          {t("priceCompareV2.empty.scanFlyer")}
        </Link>
        <Link
          to="/mercado/preco-comunitario"
          className="inline-flex h-11 items-center gap-1.5 rounded-full border border-border/60 bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-card-elevated"
        >
          {t("priceCompareV2.empty.manualPrice")}
        </Link>
      </div>
    </div>
  );
}

function FilteredEmpty({ onClear }: { onClear: () => void }) {
  const { t } = useTranslation("mercado");
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border/60 bg-card p-6 text-center shadow-card md:p-8">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
        <PackageSearch className="h-6 w-6" aria-hidden="true" />
      </span>
      <div>
        <h3 className="text-base font-semibold text-foreground md:text-lg">
          {t("precosHistorico.filters.emptyMarketTitle")}
        </h3>
        <p className="mx-auto mt-1 max-w-md text-sm leading-snug text-muted-foreground">
          {t("precosHistorico.filters.emptyMarketDescription")}
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex h-11 items-center gap-1.5 rounded-full border border-border/60 bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-card-elevated"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
        {t("priceCompareV2.filters.clear")}
      </button>
    </div>
  );
}

function CTACard({
  to,
  icon,
  title,
  desc,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      to={to}
      preload="intent"
      className={cn(
        "flex items-center justify-between gap-3 rounded-3xl border border-border/60 bg-card p-4 shadow-card transition-colors hover:bg-card-elevated active:scale-[0.99] md:p-5",
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold md:text-base">{title}</p>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground md:text-[13px]">
            {desc}
          </p>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

{
  /* Unused Store import kept for future market grouping section */
}
void Store;
