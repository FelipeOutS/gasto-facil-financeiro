import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  Home,
  BadgePercent,
  Camera,
  Cloud,
  Plus,
  Trash2,
  Save,
  Loader2,
  Filter,
  Pencil,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BatchScanWizard } from "@/components/mercado/BatchScanWizard";
import { OnlineImportWizard } from "@/components/mercado/OnlineImportWizard";
import {
  MercadoBanner,
  ProductCard,
  SectionBlock,
  MERCADO_CATEGORIES,
  type MercadoCategoryKey,
  type ProductSource,
} from "@/components/mercado/shell";
import bannerComunitario from "@/assets/mercado/banner-comunitario.jpg";
import bannerComunitarioWebp from "@/assets/mercado/banner-comunitario.webp";
import emptyComunitario from "@/assets/mercado/empty-comunitario.webp";
import { lookupProductImage } from "@/lib/mercado/product-image.functions";
import { toPersistableImage } from "@/lib/mercado/product-image-persist";
import { ImageOff, Search as SearchIcon, X as XIcon } from "lucide-react";



export const Route = createFileRoute("/mercado_/preco-comunitario")({
  head: () => ({
    meta: [{ title: i18n.t("mercado:communityPrices.title", { lng: i18n.language, defaultValue: "Preço Comunitário" }) }],
  }),
  component: PrecoComunitarioPage,
});

type SourceKey = "flyer" | "store" | "receipt" | "manual";
type SortKey = "recent" | "lowest" | "highest" | "expiring";

type CommunityPrice = {
  id: string;
  user_id: string;
  product_name: string;
  category: string | null;
  price: number;
  unit: string | null;
  market_name: string;
  source: SourceKey;
  seen_at: string;
  valid_until: string | null;
  city: string | null;
  neighborhood: string | null;
  notes: string | null;
  confidence: number | null;
  status: string;
  created_at: string;
  image_url: string | null;
  image_source: string | null;
  image_confidence: number | null;
  brand: string | null;
  barcode: string | null;
};

type ManualForm = {
  productName: string;
  price: string;
  unit: string;
  category: string;
  marketName: string;
  source: SourceKey;
  seenAt: string;
  validUntil: string;
  city: string;
  neighborhood: string;
  notes: string;
  brand: string;
  barcode: string;
  imageUrl: string | null;
  imageSource: string | null;
  imageConfidence: number | null;
  imageRemoved: boolean;
};

const TABLE = "community_market_prices" as const;
const SOURCE_KEYS: SourceKey[] = ["flyer", "store", "receipt", "manual"];

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

const SOURCE_MAP: Record<string, ProductSource> = {
  flyer: "flyer",
  store: "store",
  receipt: "receipt",
  manual: "manual",
};


const emptyManualForm = (): ManualForm => ({
  productName: "",
  price: "",
  unit: "",
  category: "",
  marketName: "",
  source: "manual",
  seenAt: new Date().toISOString().slice(0, 10),
  validUntil: "",
  city: "",
  neighborhood: "",
  notes: "",
  brand: "",
  barcode: "",
  imageUrl: null,
  imageSource: null,
  imageConfidence: null,
  imageRemoved: false,
});


function PrecoComunitarioPage() {
  const { t, i18n: i18nInst } = useTranslation("mercado");
  const dateLocale = i18nInst.language?.startsWith("en") ? "en-US" : "pt-BR";
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(dateLocale);

  const { user } = useAuth();
  const [items, setItems] = useState<CommunityPrice[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterProduct, setFilterProduct] = useState("");
  const [filterMarket, setFilterMarket] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterSource, setFilterSource] = useState<SourceKey | "">("");
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  const [categoryChip, setCategoryChip] = useState<MercadoCategoryKey | "todos" | "outros">("todos");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Batch scan wizard
  const [batchOpen, setBatchOpen] = useState(false);
  const [onlineImportOpen, setOnlineImportOpen] = useState(false);




  // Manual state
  const [manualOpen, setManualOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [manualForm, setManualForm] = useState<ManualForm>(emptyManualForm());
  const [imageSearching, setImageSearching] = useState(false);
  const [imageSearched, setImageSearched] = useState(false);

  async function searchManualImage() {
    const name = manualForm.productName.trim();
    if (name.length < 2) {
      toast.error(t("communityPrices.errors.manualRequired"));
      return;
    }
    setImageSearching(true);
    setImageSearched(false);
    try {
      const result = await lookupProductImage({
        data: {
          productName: name,
          brand: manualForm.brand.trim() || null,
          barcode: manualForm.barcode.trim() || null,
        },
      });
      const persistable = toPersistableImage(result);
      setManualForm((f) => ({
        ...f,
        imageUrl: persistable.image_url,
        imageSource: persistable.image_source,
        imageConfidence: persistable.image_confidence,
        imageRemoved: false,
      }));
      if (!persistable.image_url) {
        toast.info(t("communityPrices.image.noImageFound"));
      } else {
        toast.success(t("communityPrices.image.imageFound"));
      }
    } catch (err) {
      console.error("[preco-comunitario] image lookup", err);
      toast.info(t("communityPrices.image.noImageFound"));
    } finally {
      setImageSearching(false);
      setImageSearched(true);
    }
  }

  async function reload() {
    setLoading(true);
    const { data, error } = await (supabase.from(TABLE as never) as any)
      .select("*")
      .eq("status", "active")
      .order("seen_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("[preco-comunitario] load", error.message);
      toast.error(t("communityPrices.errors.loadFailed"));
    } else {
      setItems((data ?? []) as CommunityPrice[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Backfill incremental de imagem para itens do próprio usuário sem
  // image_url salvo. Roda lazy, em segundo plano, com concorrência baixa.
  // Cada id é tentado no máximo uma vez por sessão (sucesso ou falha).
  const backfillAttempted = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!user || loading || items.length === 0) return;
    const candidates = items.filter(
      (it) =>
        it.user_id === user.id &&
        !it.image_url &&
        !backfillAttempted.current.has(it.id) &&
        (it.product_name?.trim().length ?? 0) >= 2,
    );
    if (candidates.length === 0) return;

    let cancelled = false;
    const queue = candidates.slice(0, 24); // proteção: lote pequeno por render
    queue.forEach((it) => backfillAttempted.current.add(it.id));

    (async () => {
      const CONCURRENCY = 2;
      let cursor = 0;
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (!cancelled && cursor < queue.length) {
          const it = queue[cursor++];
          try {
            const result = await lookupProductImage({
              data: {
                productName: it.product_name,
                brand: it.brand,
                barcode: it.barcode,
              },
            });
            const persistable = toPersistableImage(result);
            if (!persistable.image_url || cancelled) continue;
            const { error } = await (supabase.from(TABLE as never) as any)
              .update({
                image_url: persistable.image_url,
                image_source: persistable.image_source,
                image_confidence: persistable.image_confidence,
              })
              .eq("id", it.id)
              .eq("user_id", user.id)
              .is("image_url", null);
            if (error || cancelled) continue;
            setItems((curr) =>
              curr.map((row) =>
                row.id === it.id
                  ? {
                      ...row,
                      image_url: persistable.image_url,
                      image_source: persistable.image_source,
                      image_confidence: persistable.image_confidence,
                    }
                  : row,
              ),
            );
          } catch {
            // silencioso — backfill é best-effort
          }
        }
      });
      await Promise.all(workers);
    })();

    return () => {
      cancelled = true;
    };
  }, [items, loading, user]);

  const filtered = useMemo(() => {
    const p = filterProduct.trim().toLowerCase();
    const m = filterMarket.trim().toLowerCase();
    const c = filterCategory.trim().toLowerCase();
    const chipMatchers: string[] | null =
      categoryChip !== "todos" && categoryChip !== "outros"
        ? CATEGORY_MATCHERS[categoryChip]
        : null;
    const chipIsOutros = categoryChip === "outros";
    const arr = items.filter((it) => {
      if (p && !it.product_name.toLowerCase().includes(p)) return false;
      if (m && !it.market_name.toLowerCase().includes(m)) return false;
      if (c && !(it.category ?? "").toLowerCase().includes(c)) return false;
      if (filterSource && it.source !== filterSource) return false;
      if (chipIsOutros || chipMatchers) {
        const cat = (it.category ?? "").toLowerCase();
        const name = it.product_name.toLowerCase();
        if (chipIsOutros) {
          const inAny = MERCADO_CATEGORIES.some((k) =>
            CATEGORY_MATCHERS[k].some((mm) => cat.includes(mm) || name.includes(mm)),
          );
          if (inAny) return false;
        } else if (chipMatchers) {
          const hit = chipMatchers.some((mm) => cat.includes(mm) || name.includes(mm));
          if (!hit) return false;
        }
      }
      return true;
    });
    const sorted = [...arr];
    if (sortBy === "lowest") sorted.sort((a, b) => a.price - b.price);
    else if (sortBy === "highest") sorted.sort((a, b) => b.price - a.price);
    else if (sortBy === "expiring") {
      sorted.sort((a, b) => {
        const av = a.valid_until ? new Date(a.valid_until).getTime() : Number.POSITIVE_INFINITY;
        const bv = b.valid_until ? new Date(b.valid_until).getTime() : Number.POSITIVE_INFINITY;
        return av - bv;
      });
    } else {
      sorted.sort((a, b) => new Date(b.seen_at).getTime() - new Date(a.seen_at).getTime());
    }
    return sorted;
  }, [items, filterProduct, filterMarket, filterCategory, filterSource, sortBy, categoryChip]);

  const activeFiltersCount =
    (filterProduct ? 1 : 0) +
    (filterMarket ? 1 : 0) +
    (filterCategory ? 1 : 0) +
    (filterSource ? 1 : 0) +
    (sortBy !== "recent" ? 1 : 0);
  const hasFilters = activeFiltersCount > 0 || categoryChip !== "todos";

  const bestFinds = useMemo(() => {
    if (items.length === 0) return [];
    return [...items].sort((a, b) => a.price - b.price).slice(0, 6);
  }, [items]);

  function clearFilters() {
    setFilterProduct("");
    setFilterMarket("");
    setFilterCategory("");
    setFilterSource("");
    setSortBy("recent");
    setCategoryChip("todos");
  }






  function openManual(item?: CommunityPrice) {
    if (item) {
      setEditingId(item.id);
      setManualForm({
        productName: item.product_name,
        price: String(item.price).replace(".", ","),
        unit: item.unit ?? "",
        category: item.category ?? "",
        marketName: item.market_name,
        source: item.source,
        seenAt: item.seen_at,
        validUntil: item.valid_until ?? "",
        city: item.city ?? "",
        neighborhood: item.neighborhood ?? "",
        notes: item.notes ?? "",
        brand: item.brand ?? "",
        barcode: item.barcode ?? "",
        imageUrl: item.image_url,
        imageSource: item.image_source,
        imageConfidence: item.image_confidence,
        imageRemoved: false,
      });
    } else {
      setEditingId(null);
      setManualForm(emptyManualForm());
    }
    setManualOpen(true);
  }

  async function saveManual() {
    if (!user) return;
    const price = Number(manualForm.price.replace(",", "."));
    if (!manualForm.productName.trim() || !manualForm.marketName.trim() || !Number.isFinite(price) || price <= 0) {
      toast.error(t("communityPrices.errors.manualRequired"));
      return;
    }
    const imageFields = manualForm.imageRemoved || !manualForm.imageUrl
      ? { image_url: null, image_source: null, image_confidence: null }
      : {
          image_url: manualForm.imageUrl,
          image_source: manualForm.imageSource ?? "manual",
          image_confidence: manualForm.imageConfidence,
        };
    const payload: Record<string, unknown> = {
      product_name: manualForm.productName.trim(),
      normalized_product_name: manualForm.productName.trim().toLowerCase(),
      category: manualForm.category || null,
      price,
      unit: manualForm.unit || null,
      market_name: manualForm.marketName.trim(),
      source: manualForm.source,
      seen_at: manualForm.seenAt || new Date().toISOString().slice(0, 10),
      valid_until: manualForm.validUntil || null,
      city: manualForm.city || null,
      neighborhood: manualForm.neighborhood || null,
      notes: manualForm.notes || null,
      brand: manualForm.brand.trim() || null,
      barcode: manualForm.barcode.trim() || null,
      ...imageFields,
    };
    if (editingId) {
      const { error } = await (supabase.from(TABLE as never) as any)
        .update(payload)
        .eq("id", editingId)
        .eq("user_id", user.id);
      if (error) {
        console.error("[preco-comunitario] update", error.message);
        toast.error(t("communityPrices.errors.saveFailed"));
        return;
      }
      toast.success(t("communityPrices.success.updated"));
    } else {
      payload.user_id = user.id;
      const { error } = await (supabase.from(TABLE as never) as any).insert(payload);
      if (error) {
        console.error("[preco-comunitario] manual insert", error.message);
        toast.error(t("communityPrices.errors.saveFailed"));
        return;
      }
      toast.success(t("communityPrices.success.manualSaved"));
    }
    setManualOpen(false);
    setEditingId(null);
    setManualForm(emptyManualForm());
    reload();
  }

  async function removeItem(id: string) {
    if (!user) return;
    if (!window.confirm(t("communityPrices.list.confirmRemove"))) return;
    const { error } = await (supabase.from(TABLE as never) as any)
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) {
      console.error("[preco-comunitario] delete", error.message);
      toast.error(t("communityPrices.errors.removeFailed"));
      return;
    }
    setItems((curr) => curr.filter((it) => it.id !== id));
    toast.success(t("communityPrices.success.removed"));
  }

  const sourceLabel = (s: string) =>
    t(`communityPrices.source.${s}`, { defaultValue: s });

  return (
    <MobileShell wide>
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label={t("communityPrices.back")}>
          <Link to="/mercado"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <Button asChild variant="ghost" size="icon" aria-label={t("communityPrices.home")}>
          <Link to="/"><Home className="h-5 w-5" /></Link>
        </Button>
      </div>

      <header className="mt-2 flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
          <BadgePercent className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t("communityPrices.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("communityPrices.subtitle")}</p>
        </div>
      </header>

      {/* Banner principal */}
      <div className="mt-5">
        <MercadoBanner
          tone="community"
          imageSrc={bannerComunitario}
          imageSrcWebp={bannerComunitarioWebp}
          title={t("communityPrices.v2.bannerTitle")}
          subtitle={t("communityPrices.v2.bannerSubtitle")}
        />
      </div>

      {/* Ações rápidas */}
      <section className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          {
            key: "scan",
            icon: Camera,
            tone: "var(--color-mercado-fresh)",
            title: t("communityPrices.actions.scanTitle"),
            desc: t("communityPrices.actions.scanDescription"),
            cta: t("communityPrices.v2.actions.scanCta"),
            onClick: () => setBatchOpen(true),
          },
          {
            key: "online",
            icon: Cloud,
            tone: "var(--color-mercado-community)",
            title: t("communityPrices.onlineImport.cardTitle"),
            desc: t("communityPrices.onlineImport.cardDescription"),
            cta: t("communityPrices.v2.actions.onlineCta"),
            onClick: () => setOnlineImportOpen(true),
          },
          {
            key: "manual",
            icon: Plus,
            tone: "var(--color-mercado-bakery)",
            title: t("communityPrices.actions.manualTitle"),
            desc: t("communityPrices.actions.manualDescription"),
            cta: t("communityPrices.v2.actions.manualCta"),
            onClick: () => openManual(),
          },
        ].map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.key}
              type="button"
              onClick={a.onClick}
              className="group flex min-h-[148px] flex-col items-start gap-2 rounded-2xl border border-border/60 bg-card p-4 text-left shadow-card transition active:scale-[0.98] hover:bg-card-elevated"
              style={{
                backgroundImage: `linear-gradient(160deg, color-mix(in oklab, ${a.tone} 14%, var(--card)) 0%, var(--card) 70%)`,
              }}
            >
              <span
                className="grid h-10 w-10 place-items-center rounded-xl ring-1 ring-border/60"
                style={{ backgroundColor: `color-mix(in oklab, ${a.tone} 22%, var(--card))`, color: a.tone }}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h2 className="text-sm font-semibold text-foreground">{a.title}</h2>
              <p className="text-xs leading-snug text-muted-foreground">{a.desc}</p>
              <span className="mt-auto inline-flex h-9 items-center rounded-full bg-brand-grad px-3 text-xs font-semibold text-primary-foreground shadow-elevated">
                {a.cta}
              </span>
            </button>
          );
        })}
      </section>

      {/* Chips de categoria */}
      <SectionBlock
        title={t("communityPrices.v2.categoryChips.title")}
        className="mt-6"
        action={
          categoryChip !== "todos" ? (
            <button
              type="button"
              onClick={() => setCategoryChip("todos")}
              className="text-xs font-medium text-brand hover:underline"
            >
              {t("communityPrices.filters.clear")}
            </button>
          ) : undefined
        }
      >
        <div
          className="no-scrollbar -mx-3 flex snap-x snap-mandatory gap-2 overflow-x-auto px-3 pb-1 sm:-mx-0 sm:px-0"
          role="listbox"
          aria-label={t("communityPrices.v2.categoryChips.title")}
        >
          {(["todos", ...MERCADO_CATEGORIES, "outros"] as const).map((k) => {
            const selected = categoryChip === k;
            return (
              <button
                key={k}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => setCategoryChip(k)}
                className={cn(
                  "shrink-0 snap-start whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-medium transition active:scale-[0.97]",
                  selected
                    ? "border-transparent bg-brand-grad text-primary-foreground shadow-elevated"
                    : "border-border/60 bg-card text-foreground hover:bg-card-elevated",
                )}
              >
                {t(`communityPrices.v2.categoryChips.${k}`)}
              </button>
            );
          })}
        </div>
      </SectionBlock>

      {/* Filtros (expansível) */}
      <section className="mt-4 rounded-2xl border border-border/60 bg-card shadow-card">
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 p-3"
          aria-expanded={filtersOpen}
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            {filtersOpen
              ? t("communityPrices.v2.filters.close")
              : t("communityPrices.v2.filters.open")}
            {activeFiltersCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand-on-soft">
                {t("communityPrices.v2.filters.applied", { count: activeFiltersCount })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasFilters && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  clearFilters();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    clearFilters();
                  }
                }}
                className="text-[11px] font-semibold text-brand hover:underline"
              >
                {t("communityPrices.filters.clear")}
              </span>
            )}
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                filtersOpen && "rotate-180",
              )}
            />
          </div>
        </button>
        {filtersOpen && (
          <div className="grid grid-cols-1 gap-2 border-t border-border/60 p-3 sm:grid-cols-2">
            <Input
              placeholder={t("communityPrices.filters.product")}
              value={filterProduct}
              onChange={(e) => setFilterProduct(e.target.value)}
            />
            <Input
              placeholder={t("communityPrices.filters.market")}
              value={filterMarket}
              onChange={(e) => setFilterMarket(e.target.value)}
            />
            <Input
              placeholder={t("communityPrices.filters.category")}
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
            />
            <select
              className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value as SourceKey | "")}
              aria-label={t("communityPrices.filters.source")}
            >
              <option value="">{t("communityPrices.filters.allSources")}</option>
              {SOURCE_KEYS.map((s) => (
                <option key={s} value={s}>
                  {sourceLabel(s)}
                </option>
              ))}
            </select>
            <select
              className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm sm:col-span-2"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              aria-label={t("communityPrices.filters.sort")}
            >
              <option value="recent">{t("communityPrices.filters.sortOptions.recent")}</option>
              <option value="lowest">{t("communityPrices.filters.sortOptions.lowest")}</option>
              <option value="highest">{t("communityPrices.filters.sortOptions.highest")}</option>
              <option value="expiring">{t("communityPrices.filters.sortOptions.expiring")}</option>
            </select>
          </div>
        )}
      </section>

      {/* Melhores achados */}
      {bestFinds.length > 0 && (
        <SectionBlock
          title={
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-brand" aria-hidden="true" />
              {t("communityPrices.v2.bestFinds.title")}
            </span>
          }
          description={t("communityPrices.v2.bestFinds.description")}
        >
          <div
            className="no-scrollbar -mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-2 sm:-mx-0 sm:px-0"
            role="region"
            aria-label={t("communityPrices.v2.bestFinds.title")}
          >
            {bestFinds.map((it) => (
              <div key={`best-${it.id}`} className="w-[150px] shrink-0 snap-start">
                <ProductCard
                  name={it.product_name}
                  priceLabel={formatBRL(it.price)}
                  unitLabel={it.unit ?? undefined}
                  imageUrl={it.image_url ?? undefined}
                  brand={it.brand}
                  barcode={it.barcode}
                  category={(it.category ?? null) as MercadoCategoryKey | null}
                  marketName={it.market_name}
                  source={SOURCE_MAP[it.source] ?? "community"}
                  seenAtLabel={fmtDate(it.seen_at)}
                />
              </div>
            ))}
          </div>
        </SectionBlock>
      )}


      {/* Produtos encontrados */}
      <SectionBlock
        title={t("communityPrices.v2.found.title")}
        description={
          !loading
            ? t("communityPrices.v2.found.count", { count: filtered.length })
            : undefined
        }
      >
        {loading ? (
          <div className="grid place-items-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border/60 bg-card-elevated/40 p-6 text-center">
              <img
                src={emptyComunitario}
                alt=""
                loading="lazy"
                className="h-28 w-28 opacity-90"
              />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {t("communityPrices.v2.empty.title")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("communityPrices.v2.empty.description")}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={() => setBatchOpen(true)} className="min-h-11">
                  <Camera className="mr-2 h-4 w-4" />
                  {t("communityPrices.v2.empty.scanCta")}
                </Button>
                <Button
                  onClick={() => openManual()}
                  variant="secondary"
                  className="min-h-11"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t("communityPrices.v2.empty.manualCta")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border/60 bg-card-elevated/40 p-6 text-center">
              <p className="text-sm font-semibold text-foreground">
                {t("communityPrices.empty.noResults.title")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("communityPrices.empty.noResults.description")}
              </p>
            </div>
          )
        ) : (
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filtered.map((it) => {
              const owned = user?.id === it.user_id;
              const validUntilLabel = it.valid_until
                ? t("communityPrices.list.validUntil", { date: fmtDate(it.valid_until) })
                : null;
              return (
                <li key={it.id} className="relative">
                  <ProductCard
                    name={it.product_name}
                    priceLabel={formatBRL(it.price)}
                    unitLabel={it.unit ?? undefined}
                    marketName={it.market_name}
                    source={SOURCE_MAP[it.source] ?? "community"}
                    seenAtLabel={fmtDate(it.seen_at)}
                    extra={
                      <div className="mt-1 space-y-1">
                        {validUntilLabel && (
                          <p className="text-[10px] text-muted-foreground">{validUntilLabel}</p>
                        )}
                        {it.notes && (
                          <p className="line-clamp-2 text-[10px] text-muted-foreground">{it.notes}</p>
                        )}
                        <p className="text-[10px] italic text-muted-foreground">
                          {t("communityPrices.itemHint")}
                        </p>
                      </div>
                    }
                  />
                  {owned && (
                    <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openManual(it)}
                        className="grid h-7 w-7 place-items-center rounded-full bg-background/85 text-foreground shadow-card backdrop-blur transition hover:text-brand"
                        aria-label={t("communityPrices.list.edit")}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(it.id)}
                        className="grid h-7 w-7 place-items-center rounded-full bg-background/85 text-foreground shadow-card backdrop-blur transition hover:text-destructive"
                        aria-label={t("communityPrices.list.remove")}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionBlock>


      {/* Batch scan wizard */}
      <BatchScanWizard open={batchOpen} onOpenChange={setBatchOpen} onSaved={reload} />
      <OnlineImportWizard
        open={onlineImportOpen}
        onOpenChange={setOnlineImportOpen}
        onSaved={reload}
        onOpenFlyerScan={() => setBatchOpen(true)}
      />



      {/* Manual dialog */}
      <Dialog open={manualOpen} onOpenChange={(o) => { setManualOpen(o); if (!o) setEditingId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId ? t("communityPrices.manual.editTitle") : t("communityPrices.manual.title")}
            </DialogTitle>
            <DialogDescription>{t("communityPrices.manual.description")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="text-xs">{t("communityPrices.manual.fields.product")}</Label>
              <Input
                value={manualForm.productName}
                onChange={(e) => setManualForm((f) => ({ ...f, productName: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">{t("communityPrices.manual.fields.price")}</Label>
              <Input
                inputMode="decimal"
                value={manualForm.price}
                onChange={(e) => setManualForm((f) => ({ ...f, price: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">{t("communityPrices.manual.fields.unit")}</Label>
              <Input
                value={manualForm.unit}
                onChange={(e) => setManualForm((f) => ({ ...f, unit: e.target.value }))}
                placeholder={t("communityPrices.manual.fields.unitPlaceholder")}
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">{t("communityPrices.manual.fields.market")}</Label>
              <Input
                value={manualForm.marketName}
                onChange={(e) => setManualForm((f) => ({ ...f, marketName: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">{t("communityPrices.manual.fields.category")}</Label>
              <Input
                value={manualForm.category}
                onChange={(e) => setManualForm((f) => ({ ...f, category: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">{t("communityPrices.manual.fields.source")}</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={manualForm.source}
                onChange={(e) => setManualForm((f) => ({ ...f, source: e.target.value as SourceKey }))}
              >
                {SOURCE_KEYS.map((s) => (
                  <option key={s} value={s}>{sourceLabel(s)}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">{t("communityPrices.manual.fields.seenAt")}</Label>
              <Input
                type="date"
                value={manualForm.seenAt}
                onChange={(e) => setManualForm((f) => ({ ...f, seenAt: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">{t("communityPrices.manual.fields.validUntil")}</Label>
              <Input
                type="date"
                value={manualForm.validUntil}
                onChange={(e) => setManualForm((f) => ({ ...f, validUntil: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">{t("communityPrices.manual.fields.city")}</Label>
              <Input
                value={manualForm.city}
                onChange={(e) => setManualForm((f) => ({ ...f, city: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">{t("communityPrices.manual.fields.neighborhood")}</Label>
              <Input
                value={manualForm.neighborhood}
                onChange={(e) => setManualForm((f) => ({ ...f, neighborhood: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">{t("communityPrices.manual.fields.notes")}</Label>
              <Textarea
                rows={2}
                value={manualForm.notes}
                onChange={(e) => setManualForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder={t("communityPrices.manual.fields.notesPlaceholder")}
              />
            </div>
            <div>
              <Label className="text-xs">{t("communityPrices.image.brand")}</Label>
              <Input
                value={manualForm.brand}
                onChange={(e) => setManualForm((f) => ({ ...f, brand: e.target.value }))}
                placeholder={t("communityPrices.image.brandPlaceholder")}
                maxLength={100}
              />
            </div>
            <div>
              <Label className="text-xs">{t("communityPrices.image.barcode")}</Label>
              <Input
                value={manualForm.barcode}
                onChange={(e) =>
                  setManualForm((f) => ({
                    ...f,
                    barcode: e.target.value.replace(/[^0-9A-Za-z._-]/g, "").slice(0, 32),
                  }))
                }
                placeholder={t("communityPrices.image.barcodePlaceholder")}
                inputMode="numeric"
              />
            </div>
            <div className="sm:col-span-2 space-y-2 rounded-lg border border-border/60 bg-card-elevated/30 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={searchManualImage}
                  disabled={imageSearching || manualForm.productName.trim().length < 2}
                  className="min-h-9"
                >
                  {imageSearching ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <SearchIcon className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {imageSearching
                    ? t("communityPrices.image.searching")
                    : t("communityPrices.image.searchImage")}
                </Button>
                {manualForm.imageUrl && !manualForm.imageRemoved && (
                  <button
                    type="button"
                    onClick={() =>
                      setManualForm((f) => ({ ...f, imageRemoved: true, imageUrl: null }))
                    }
                    className="inline-flex h-9 items-center gap-1 rounded-full border border-border/60 px-2.5 text-[11px] font-medium text-muted-foreground hover:text-destructive"
                  >
                    <XIcon className="h-3 w-3" />
                    {t("communityPrices.image.removeImage")}
                  </button>
                )}
              </div>
              {manualForm.imageUrl && !manualForm.imageRemoved ? (
                <div className="flex items-start gap-2">
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border/60 bg-muted">
                    <img
                      src={manualForm.imageUrl}
                      alt={t("communityPrices.image.previewAlt", {
                        name: manualForm.productName || "—",
                      })}
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <p className="text-[10px] italic text-muted-foreground">
                    {t("communityPrices.image.illustrativeImage")}
                  </p>
                </div>
              ) : imageSearched && !manualForm.imageUrl ? (
                <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <ImageOff className="h-3 w-3" />
                  {t("communityPrices.image.noImageFound")}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => { setManualOpen(false); setEditingId(null); setImageSearched(false); }} className="min-h-11">
              {t("communityPrices.manual.cancel")}
            </Button>
            <Button onClick={saveManual} className="min-h-11">
              <Save className="mr-2 h-4 w-4" /> {t("communityPrices.manual.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </MobileShell>
  );
}
