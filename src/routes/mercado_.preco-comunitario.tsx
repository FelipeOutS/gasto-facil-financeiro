import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  Home,
  BadgePercent,
  Camera,
  Plus,
  Info,
  Trash2,
  Save,
  Loader2,
  AlertTriangle,
  X,
  Filter,
  Pencil,
} from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { formatBRL } from "@/lib/format";
import { apiFetch } from "@/lib/api-fetch";

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

type DetectedItem = {
  productName: string;
  price: number | null;
  unit: string | null;
  category: string | null;
  marketName: string | null;
  validUntil: string | null;
  notes: string | null;
  confidence: number | null;
};

type ReviewItem = DetectedItem & { id: string; include: boolean };

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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

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

  // Scan state
  const fileRef = useRef<HTMLInputElement>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanMarket, setScanMarket] = useState("");
  const [review, setReview] = useState<ReviewItem[] | null>(null);

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

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(jpeg|jpg|png|webp)$/.test(file.type)) {
      toast.error(t("communityPrices.errors.invalidImage"));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("communityPrices.errors.imageTooLarge"));
      return;
    }
    setScanLoading(true);
    try {
      const imageBase64 = await fileToBase64(file);
      const res = await apiFetch("/api/mercado-flyer-ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, marketName: scanMarket || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.message || t("communityPrices.errors.ocrFailed"));
        return;
      }
      const detected: DetectedItem[] = json.items ?? [];
      if (!detected.length) {
        toast.info(t("communityPrices.errors.noItems"));
        return;
      }
      setReview(
        detected.map((d, idx) => ({
          ...d,
          id: `r-${idx}-${Date.now()}`,
          include: true,
          marketName: d.marketName || scanMarket || null,
        })),
      );
    } catch (err) {
      console.error("[preco-comunitario] scan", err);
      toast.error(t("communityPrices.errors.uploadFailed"));
    } finally {
      setScanLoading(false);
    }
  }

  function isReviewItemValid(r: ReviewItem) {
    return (
      r.productName.trim().length > 0 &&
      r.price != null &&
      Number.isFinite(r.price) &&
      r.price > 0 &&
      !!r.marketName?.trim()
    );
  }

  async function saveReview() {
    if (!user || !review) return;
    const toSave = review.filter((r) => r.include);
    if (!toSave.length) {
      toast.error(t("communityPrices.errors.selectAtLeastOne"));
      return;
    }
    const invalid = toSave.filter((r) => !isReviewItemValid(r));
    if (invalid.length) {
      toast.error(t("communityPrices.errors.missingFields"));
      return;
    }
    const rows = toSave.map((r) => ({
      user_id: user.id,
      product_name: r.productName.trim(),
      normalized_product_name: r.productName.trim().toLowerCase(),
      category: r.category,
      price: r.price,
      unit: r.unit,
      market_name: r.marketName!.trim(),
      source: "flyer",
      seen_at: new Date().toISOString().slice(0, 10),
      valid_until: r.validUntil,
      notes: r.notes,
      confidence: r.confidence,
    }));
    const { error } = await (supabase.from(TABLE as never) as any).insert(rows);
    if (error) {
      console.error("[preco-comunitario] insert", error.message);
      toast.error(t("communityPrices.errors.saveFailed"));
      return;
    }
    toast.success(t("communityPrices.success.saved", { count: rows.length }));
    setReview(null);
    setScanMarket("");
    reload();
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
          <Label htmlFor="scanMarket" className="mt-3 block text-xs">{t("communityPrices.actions.marketLabel")}</Label>
          <Input
            id="scanMarket"
            value={scanMarket}
            onChange={(e) => setScanMarket(e.target.value)}
            placeholder={t("communityPrices.actions.marketPlaceholder")}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            capture="environment"
            className="hidden"
            onChange={onPickFile}
          />
          <Button className="mt-3 w-full min-h-11" onClick={() => fileRef.current?.click()} disabled={scanLoading}>
            {scanLoading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("communityPrices.actions.reading")}</>
            ) : (
              <><Camera className="mr-2 h-4 w-4" /> {t("communityPrices.actions.pick")}</>
            )}
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

      {/* Review dialog */}
      <Dialog open={review !== null} onOpenChange={(o) => !o && setReview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("communityPrices.review.title")}</DialogTitle>
            <DialogDescription>{t("communityPrices.review.description")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 rounded-md border border-amber-300/40 bg-amber-50/50 p-2 text-[12px] text-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t("communityPrices.review.warning")}</span>
          </div>
          <ul className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
            {review?.map((r, idx) => {
              const invalidPrice = r.include && (r.price == null || !Number.isFinite(r.price) || r.price <= 0);
              const missingProduct = r.include && !r.productName.trim();
              const missingMarket = r.include && !r.marketName?.trim();
              return (
                <li
                  key={r.id}
                  className={`rounded-xl border p-3 ${r.include ? "border-border" : "border-dashed border-muted opacity-60"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={r.include}
                        onChange={(e) =>
                          setReview((cur) => cur!.map((x, i) => (i === idx ? { ...x, include: e.target.checked } : x)))
                        }
                      />
                      {t("communityPrices.review.include")}
                      {typeof r.confidence === "number" && (
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          {t("communityPrices.review.confidence", { value: Math.round(r.confidence * 100) })}
                        </span>
                      )}
                    </label>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setReview((cur) => cur!.filter((_, i) => i !== idx))}
                      aria-label={t("communityPrices.review.remove")}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs">{t("communityPrices.review.fields.product")}</Label>
                      <Input
                        value={r.productName}
                        onChange={(e) =>
                          setReview((cur) => cur!.map((x, i) => (i === idx ? { ...x, productName: e.target.value } : x)))
                        }
                      />
                      {missingProduct && (
                        <p className="mt-1 text-[11px] text-destructive">{t("communityPrices.review.missingProduct")}</p>
                      )}
                    </div>
                    <div>
                      <Label className="text-xs">{t("communityPrices.review.fields.price")}</Label>
                      <Input
                        inputMode="decimal"
                        value={r.price ?? ""}
                        onChange={(e) => {
                          const v = e.target.value.replace(",", ".");
                          const n = v === "" ? null : Number(v);
                          setReview((cur) =>
                            cur!.map((x, i) =>
                              i === idx ? { ...x, price: Number.isFinite(n as number) ? (n as number) : null } : x,
                            ),
                          );
                        }}
                      />
                      {invalidPrice && (
                        <p className="mt-1 text-[11px] text-destructive">{t("communityPrices.review.invalidPrice")}</p>
                      )}
                    </div>
                    <div>
                      <Label className="text-xs">{t("communityPrices.review.fields.unit")}</Label>
                      <Input
                        value={r.unit ?? ""}
                        onChange={(e) =>
                          setReview((cur) =>
                            cur!.map((x, i) => (i === idx ? { ...x, unit: e.target.value || null } : x)),
                          )
                        }
                        placeholder={t("communityPrices.review.fields.unitPlaceholder")}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">{t("communityPrices.review.fields.market")}</Label>
                      <Input
                        value={r.marketName ?? ""}
                        onChange={(e) =>
                          setReview((cur) =>
                            cur!.map((x, i) => (i === idx ? { ...x, marketName: e.target.value || null } : x)),
                          )
                        }
                      />
                      {missingMarket && (
                        <p className="mt-1 text-[11px] text-destructive">{t("communityPrices.review.missingMarket")}</p>
                      )}
                    </div>
                    <div>
                      <Label className="text-xs">{t("communityPrices.review.fields.category")}</Label>
                      <Input
                        value={r.category ?? ""}
                        onChange={(e) =>
                          setReview((cur) =>
                            cur!.map((x, i) => (i === idx ? { ...x, category: e.target.value || null } : x)),
                          )
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-xs">{t("communityPrices.review.fields.validUntil")}</Label>
                      <Input
                        type="date"
                        value={r.validUntil ?? ""}
                        onChange={(e) =>
                          setReview((cur) =>
                            cur!.map((x, i) => (i === idx ? { ...x, validUntil: e.target.value || null } : x)),
                          )
                        }
                      />
                    </div>
                  </div>
                  {r.notes && <p className="mt-2 text-[11px] text-muted-foreground">{r.notes}</p>}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setReview(null)} className="min-h-11">
              {t("communityPrices.review.cancel")}
            </Button>
            <Button onClick={saveReview} className="min-h-11">
              <Save className="mr-2 h-4 w-4" /> {t("communityPrices.review.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
