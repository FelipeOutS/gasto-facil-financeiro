/**
 * V2.3.2 — Importação de preços públicos do Joanin Online.
 *
 * 3 estados:
 *  1) Confirm: dialog explicando a fonte e disclaimer.
 *  2) Loading: chamando /api/mercado-joanin-import.
 *  3) Review: lista com checkbox/edição, salva em community_market_prices.
 *
 * Nenhum HTML é exibido. Nenhum cookie/token aparece. Imagens da fonte não são
 * baixadas nem salvas. Deduplica por (productName normalizado + market + dia).
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Cloud,
  Loader2,
  Save,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api-fetch";

const TABLE = "community_market_prices" as const;

type ImportedItem = {
  productName: string;
  price: number;
  oldPrice: number | null;
  unit: string | null;
  category: string | null;
  marketName: string;
  sourceName: string;
  sourceUrl: string;
  seenAt: string;
  validUntil: string | null;
  city: string | null;
  neighborhood: string | null;
  notes: string;
  confidence: number;
};

type ReviewItem = ImportedItem & {
  id: string;
  include: boolean;
};

type Step = "confirm" | "loading" | "review";

export type OnlineImportWizardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function newId(prefix: string, idx: number) {
  return `${prefix}_${idx}_${Math.random().toString(36).slice(2, 8)}`;
}

export function OnlineImportWizard({
  open,
  onOpenChange,
  onSaved,
}: OnlineImportWizardProps) {
  const { t, i18n } = useTranslation("mercado");
  const { user } = useAuth();
  const [step, setStep] = useState<Step>("confirm");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep("confirm");
      setItems([]);
      setFetchedAt("");
      setSaving(false);
    }
  }, [open]);

  const dateLocale = i18n.language?.startsWith("en") ? "en-US" : "pt-BR";
  const formattedFetchedAt = useMemo(() => {
    if (!fetchedAt) return "";
    try {
      return new Date(fetchedAt).toLocaleString(dateLocale, {
        dateStyle: "short",
        timeStyle: "short",
      });
    } catch {
      return fetchedAt;
    }
  }, [fetchedAt, dateLocale]);

  async function runImport() {
    setStep("loading");
    try {
      const res = await apiFetch("/api/mercado-joanin-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (res.status === 429) {
        toast.error(t("communityPrices.onlineImport.errors.rateLimited"));
        onOpenChange(false);
        return;
      }
      if (res.status === 403) {
        toast.error(
          (json as { message?: string })?.message ??
            t("communityPrices.onlineImport.errors.importFailed"),
        );
        onOpenChange(false);
        return;
      }
      if (!res.ok) {
        toast.error(t("communityPrices.onlineImport.errors.importFailed"));
        onOpenChange(false);
        return;
      }
      const code = (json as { code?: string }).code;
      const incoming = (json as { items?: ImportedItem[] }).items ?? [];
      if (code === "site_unavailable") {
        toast.error(t("communityPrices.onlineImport.errors.siteUnavailable"));
        onOpenChange(false);
        return;
      }
      if (code === "no_products_found" || incoming.length === 0) {
        toast.warning(t("communityPrices.onlineImport.errors.noProductsFound"));
        onOpenChange(false);
        return;
      }
      const fetchedAtIso = (json as { fetchedAt?: string }).fetchedAt ?? new Date().toISOString();
      setFetchedAt(fetchedAtIso);
      setItems(
        incoming.map((it, idx) => ({
          ...it,
          id: newId("oi", idx),
          include: true,
        })),
      );
      setStep("review");
    } catch (err) {
      console.error("[online-import] erro", err);
      toast.error(t("communityPrices.onlineImport.errors.importFailed"));
      onOpenChange(false);
    }
  }

  function isItemValid(r: ReviewItem) {
    return (
      r.productName.trim().length > 0 &&
      r.price != null &&
      Number.isFinite(r.price) &&
      r.price > 0
    );
  }

  async function saveAll() {
    if (!user) return;
    const toSave = items.filter((r) => r.include && isItemValid(r));
    if (!toSave.length) {
      toast.error(t("communityPrices.onlineImport.errors.selectAtLeastOne"));
      return;
    }
    setSaving(true);
    const today = new Date().toISOString().slice(0, 10);

    // Deduplicação: busca existentes de hoje para esse mercado/source
    try {
      const { data: existing } = await (supabase.from(TABLE as never) as any)
        .select("id,product_name,price,seen_at,status")
        .eq("user_id", user.id)
        .eq("market_name", toSave[0].marketName)
        .eq("source", "store")
        .gte("seen_at", today)
        .limit(500);

      const existingMap = new Map<string, { id: string; price: number }>();
      if (Array.isArray(existing)) {
        for (const row of existing as Array<{ id: string; product_name: string; price: number }>) {
          existingMap.set(normalize(row.product_name), {
            id: row.id,
            price: Number(row.price),
          });
        }
      }

      const inserts: Array<Record<string, unknown>> = [];
      const updates: Array<{ id: string; price: number }> = [];

      for (const r of toSave) {
        const key = normalize(r.productName);
        const dup = existingMap.get(key);
        const noteParts = [
          r.notes,
          t("communityPrices.onlineImport.noteSourceLine"),
        ];
        if (r.oldPrice && r.oldPrice !== r.price) {
          noteParts.push(
            t("communityPrices.onlineImport.oldPriceNote", {
              value: r.oldPrice.toFixed(2).replace(".", ","),
            }),
          );
        }
        if (dup) {
          if (Math.abs(dup.price - r.price) > 0.001) {
            updates.push({ id: dup.id, price: r.price });
          }
          continue;
        }
        inserts.push({
          user_id: user.id,
          product_name: r.productName.trim(),
          normalized_product_name: key,
          category: r.category?.trim() ? r.category.trim() : null,
          price: r.price,
          unit: r.unit?.trim() ? r.unit.trim() : null,
          market_name: r.marketName,
          market_id: null,
          source: "store",
          status: "active",
          seen_at: today,
          valid_until: r.validUntil && /^\d{4}-\d{2}-\d{2}$/.test(r.validUntil) ? r.validUntil : null,
          city: r.city,
          neighborhood: r.neighborhood,
          notes: noteParts.filter(Boolean).join(" · "),
          confidence:
            typeof r.confidence === "number" && Number.isFinite(r.confidence)
              ? r.confidence
              : 0.85,
        });
      }

      if (inserts.length > 0) {
        const { error } = await (supabase.from(TABLE as never) as any).insert(inserts);
        if (error) throw new Error(error.message);
      }
      for (const upd of updates) {
        const { error } = await (supabase.from(TABLE as never) as any)
          .update({ price: upd.price, seen_at: today })
          .eq("id", upd.id)
          .eq("user_id", user.id);
        if (error) throw new Error(error.message);
      }

      toast.success(
        t("communityPrices.onlineImport.success", {
          count: inserts.length + updates.length,
        }),
      );
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      console.error("[online-import] save", err);
      toast.error(t("communityPrices.onlineImport.errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("communityPrices.onlineImport.title")}</DialogTitle>
          <DialogDescription>
            {t("communityPrices.onlineImport.description")}
          </DialogDescription>
        </DialogHeader>

        {step === "confirm" && (
          <div className="space-y-3">
            <div className="rounded-md border border-amber-300/50 bg-amber-50/60 p-3 text-[12px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
              <p>{t("communityPrices.onlineImport.confirmMessage")}</p>
              <p className="mt-2 text-[11px] opacity-80">{t("communityPrices.onlineImport.cardScopeNotice")}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("communityPrices.onlineImport.sourceLabel", {
                source: "Joanin Online",
              })}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="min-h-11"
              >
                {t("communityPrices.onlineImport.cancel")}
              </Button>
              <Button onClick={runImport} className="min-h-11">
                <Cloud className="mr-2 h-4 w-4" />
                {t("communityPrices.onlineImport.fetchCta")}
              </Button>
            </div>
          </div>
        )}

        {step === "loading" && (
          <div className="flex flex-col items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mb-3 h-6 w-6 animate-spin" />
            {t("communityPrices.onlineImport.loading")}
          </div>
        )}

        {step === "review" && (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-muted/20 p-2 text-[11px] text-muted-foreground">
              <p>
                {t("communityPrices.onlineImport.reviewSummary", {
                  count: items.length,
                  source: "Joanin Online",
                  date: formattedFetchedAt,
                })}
              </p>
              <p className="mt-1">{t("communityPrices.onlineImport.reviewScopeNote")}</p>
              <p className="mt-1">{t("communityPrices.onlineImport.reviewDisclaimer")}</p>
            </div>

            <ul className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
              {items.map((r, idx) => {
                const invalidPrice =
                  r.include && (r.price == null || !Number.isFinite(r.price) || r.price <= 0);
                const missingProduct = r.include && !r.productName.trim();
                return (
                  <li
                    key={r.id}
                    className={`rounded-xl border p-3 ${r.include ? "border-border" : "border-dashed border-muted opacity-60"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex flex-wrap items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={r.include}
                          onChange={(e) =>
                            setItems((cur) =>
                              cur.map((x, i) =>
                                i === idx ? { ...x, include: e.target.checked } : x,
                              ),
                            )
                          }
                        />
                        {t("communityPrices.review.include")}
                        {r.oldPrice && r.oldPrice !== r.price && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                            {t("communityPrices.onlineImport.oldPriceBadge", {
                              value: r.oldPrice.toFixed(2).replace(".", ","),
                            })}
                          </span>
                        )}
                      </label>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setItems((cur) => cur.filter((_, i) => i !== idx))}
                        aria-label={t("communityPrices.review.remove")}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <Label className="text-xs">
                          {t("communityPrices.review.fields.product")}
                        </Label>
                        <Input
                          value={r.productName}
                          onChange={(e) =>
                            setItems((cur) =>
                              cur.map((x, i) =>
                                i === idx ? { ...x, productName: e.target.value } : x,
                              ),
                            )
                          }
                        />
                        {missingProduct && (
                          <p className="mt-1 text-[11px] text-destructive">
                            {t("communityPrices.review.missingProduct")}
                          </p>
                        )}
                      </div>
                      <div>
                        <Label className="text-xs">
                          {t("communityPrices.review.fields.price")}
                        </Label>
                        <Input
                          inputMode="decimal"
                          value={r.price ?? ""}
                          onChange={(e) => {
                            const v = e.target.value.replace(",", ".");
                            const n = v === "" ? null : Number(v);
                            setItems((cur) =>
                              cur.map((x, i) =>
                                i === idx
                                  ? {
                                      ...x,
                                      price:
                                        Number.isFinite(n as number) && (n as number) > 0
                                          ? (n as number)
                                          : (0 as number),
                                    }
                                  : x,
                              ),
                            );
                          }}
                        />
                        {invalidPrice && (
                          <p className="mt-1 text-[11px] text-destructive">
                            {t("communityPrices.review.invalidPrice")}
                          </p>
                        )}
                      </div>
                      <div>
                        <Label className="text-xs">
                          {t("communityPrices.review.fields.unit")}
                        </Label>
                        <Input
                          value={r.unit ?? ""}
                          onChange={(e) =>
                            setItems((cur) =>
                              cur.map((x, i) =>
                                i === idx ? { ...x, unit: e.target.value || null } : x,
                              ),
                            )
                          }
                          placeholder={t("communityPrices.review.fields.unitPlaceholder")}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">
                          {t("communityPrices.review.fields.category")}
                        </Label>
                        <Input
                          value={r.category ?? ""}
                          onChange={(e) =>
                            setItems((cur) =>
                              cur.map((x, i) =>
                                i === idx ? { ...x, category: e.target.value || null } : x,
                              ),
                            )
                          }
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-xs">
                          {t("communityPrices.review.fields.validUntil")}
                        </Label>
                        <Input
                          type="date"
                          value={r.validUntil ?? ""}
                          onChange={(e) =>
                            setItems((cur) =>
                              cur.map((x, i) =>
                                i === idx
                                  ? { ...x, validUntil: e.target.value || null }
                                  : x,
                              ),
                            )
                          }
                        />
                      </div>
                    </div>
                    <p className="mt-2 text-[10px] italic text-muted-foreground">
                      {t("communityPrices.onlineImport.itemFooter", {
                        source: r.sourceName,
                        date: formattedFetchedAt,
                      })}
                    </p>
                  </li>
                );
              })}
            </ul>

            {items.length === 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300/40 bg-amber-50/50 p-2 text-[12px] text-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{t("communityPrices.onlineImport.errors.noProductsFound")}</span>
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button
                variant="ghost"
                onClick={() => setStep("confirm")}
                className="min-h-11"
                disabled={saving}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("communityPrices.onlineImport.back")}
              </Button>
              <Button
                onClick={saveAll}
                className="min-h-11"
                disabled={saving || items.length === 0}
              >
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {t("communityPrices.onlineImport.saveReviewed")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
