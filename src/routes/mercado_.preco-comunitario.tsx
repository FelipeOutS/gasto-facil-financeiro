import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
import emptyComunitario from "@/assets/mercado/empty-comunitario.png";



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
};

const TABLE = "community_market_prices" as const;
const SOURCE_KEYS: SourceKey[] = ["flyer", "store", "receipt", "manual"];

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

  const filtered = useMemo(() => {
    const p = filterProduct.trim().toLowerCase();
    const m = filterMarket.trim().toLowerCase();
    const c = filterCategory.trim().toLowerCase();
    const arr = items.filter((it) => {
      if (p && !it.product_name.toLowerCase().includes(p)) return false;
      if (m && !it.market_name.toLowerCase().includes(m)) return false;
      if (c && !(it.category ?? "").toLowerCase().includes(c)) return false;
      if (filterSource && it.source !== filterSource) return false;
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
  }, [items, filterProduct, filterMarket, filterCategory, filterSource, sortBy]);

  const hasFilters =
    !!filterProduct || !!filterMarket || !!filterCategory || !!filterSource || sortBy !== "recent";

  function clearFilters() {
    setFilterProduct("");
    setFilterMarket("");
    setFilterCategory("");
    setFilterSource("");
    setSortBy("recent");
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

      <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-300/50 bg-amber-50/60 p-3 text-[13px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{t("communityPrices.disclaimer")}</p>
      </div>

      {/* Ações */}
      <section className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-card">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Camera className="h-4 w-4" /> {t("communityPrices.actions.scanTitle")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("communityPrices.actions.scanDescription")}</p>
          <Button className="mt-3 w-full min-h-11" onClick={() => setBatchOpen(true)}>
            <Camera className="mr-2 h-4 w-4" /> {t("communityPrices.batch.openCta")}
          </Button>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-card">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Plus className="h-4 w-4" /> {t("communityPrices.actions.manualTitle")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("communityPrices.actions.manualDescription")}</p>
          <Button className="mt-3 w-full min-h-11" variant="secondary" onClick={() => openManual()}>
            <Plus className="mr-2 h-4 w-4" /> {t("communityPrices.actions.newManual")}
          </Button>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-card sm:col-span-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Cloud className="h-4 w-4" /> {t("communityPrices.onlineImport.cardTitle")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("communityPrices.onlineImport.cardDescription")}</p>
          <p className="mt-2 text-[11px] text-muted-foreground/80">{t("communityPrices.onlineImport.cardScopeNotice")}</p>
          <Button className="mt-3 w-full min-h-11" variant="outline" onClick={() => setOnlineImportOpen(true)}>
            <Cloud className="mr-2 h-4 w-4" /> {t("communityPrices.onlineImport.cardCta")}
          </Button>
        </div>
      </section>

      {/* Filtros */}
      <section className="mt-5 rounded-2xl border border-border/60 bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Filter className="h-3.5 w-3.5" /> {t("communityPrices.filters.title")}
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-[11px] font-semibold text-brand hover:underline"
            >
              {t("communityPrices.filters.clear")}
            </button>
          )}
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
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
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value as SourceKey | "")}
            aria-label={t("communityPrices.filters.source")}
          >
            <option value="">{t("communityPrices.filters.allSources")}</option>
            {SOURCE_KEYS.map((s) => (
              <option key={s} value={s}>{sourceLabel(s)}</option>
            ))}
          </select>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm sm:col-span-2"
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
      </section>

      {/* Lista */}
      <section className="mt-4">
        {loading ? (
          <div className="grid place-items-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          items.length === 0 ? (
            <EmptyState
              title={t("communityPrices.empty.none.title")}
              description={t("communityPrices.empty.none.description")}
            />
          ) : (
            <EmptyState
              title={t("communityPrices.empty.noResults.title")}
              description={t("communityPrices.empty.noResults.description")}
            />
          )
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {filtered.map((it) => {
              const owned = user?.id === it.user_id;
              return (
                <li key={it.id} className="rounded-2xl border border-border/60 bg-card p-4 shadow-card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{it.product_name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {it.market_name}
                        {it.unit ? ` · ${it.unit}` : ""}
                        {it.category ? ` · ${it.category}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-bold text-brand">{formatBRL(it.price)}</p>
                      <span className="mt-0.5 inline-flex rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-on-soft">
                        {sourceLabel(it.source)}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="min-w-0 truncate">
                      {t("communityPrices.list.seenOn", { date: fmtDate(it.seen_at) })}
                      {it.valid_until
                        ? ` · ${t("communityPrices.list.validUntil", { date: fmtDate(it.valid_until) })}`
                        : ""}
                    </span>
                    {owned && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openManual(it)}
                          className="rounded p-1 text-muted-foreground hover:text-brand"
                          aria-label={t("communityPrices.list.edit")}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeItem(it.id)}
                          className="rounded p-1 text-muted-foreground hover:text-destructive"
                          aria-label={t("communityPrices.list.remove")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  {it.notes && <p className="mt-1 text-[11px] text-muted-foreground">{it.notes}</p>}
                  <p className="mt-2 text-[10px] italic text-muted-foreground">{t("communityPrices.itemHint")}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

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
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => { setManualOpen(false); setEditingId(null); }} className="min-h-11">
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
