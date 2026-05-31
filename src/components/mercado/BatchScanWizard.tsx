/**
 * V2.3.2 — Preço Comunitário: wizard de leitura em lote de panfletos.
 *
 * 4 etapas:
 *  1) Mercado: escolher mercado salvo (useMercadosLocais) ou informar manualmente.
 *  2) Fotos: selecionar até 20 imagens (jpg/png/webp, 10 MB cada).
 *  3) Processamento: fila sequencial chamando /api/mercado-flyer-ocr por imagem,
 *     com status por foto e retry individual.
 *  4) Revisão: lista única com badge "Foto N", validação por item, salva no
 *     Supabase (`community_market_prices`) usando market_name/market_id quando
 *     vier de um mercado salvo. Nada é gravado antes de o usuário confirmar.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Save,
  Store,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api-fetch";
import { useMercadosLocais } from "@/lib/mercado/mercados-store";

const MAX_PHOTOS = 20;
const MAX_BYTES = 10 * 1024 * 1024;
const TABLE = "community_market_prices" as const;

type Step = "market" | "photos" | "processing" | "review";

type PhotoStatus = "pending" | "processing" | "done" | "empty" | "error";

type EmptyReason = "no_text_detected" | "text_found_but_no_items" | "text_found_but_no_prices" | null;
type ErrorReason =
  | "ocr_config_missing"
  | "vision_api_error"
  | "gemini_gateway_error"
  | "invalid_image_payload"
  | "network"
  | "rate_limited"
  | "credits"
  | "unknown_error"
  | null;

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

type Photo = {
  id: string;
  file: File;
  previewUrl: string;
  status: PhotoStatus;
  errorMessage?: string;
  emptyReason?: EmptyReason;
  errorReason?: ErrorReason;
  usedFallback?: boolean;
  items: DetectedItem[];
};


type ReviewItem = DetectedItem & {
  id: string;
  include: boolean;
  sourcePhotoIndex: number; // 1-based
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

/**
 * Redimensiona uma imagem mantendo proporção, com o maior lado em até MAX_SIDE.
 * Mantém qualidade alta (0.92) — panfletos têm textos pequenos.
 * Se falhar (ex.: HEIC), faz fallback para o arquivo original em base64.
 */
const MAX_SIDE = 2800;
const JPEG_QUALITY = 0.92;
async function fileToProcessedDataUrl(file: File): Promise<string> {
  try {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("decode-failed"));
        i.src = url;
      });
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) throw new Error("empty-image");
      const longest = Math.max(w, h);
      const scale = longest > MAX_SIDE ? MAX_SIDE / longest : 1;
      const tw = Math.round(w * scale);
      const th = Math.round(h * scale);
      const canvas = document.createElement("canvas");
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no-context");
      ctx.drawImage(img, 0, 0, tw, th);
      // Use JPEG p/ texto pequeno + bom compromisso de tamanho.
      const out = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      if (!out || out.length < 200) throw new Error("encode-empty");
      return out;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    // Fallback: envia original (servidor valida MIME e tamanho).
    return fileToBase64(file);
  }
}

function newId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export type BatchScanWizardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
};

export function BatchScanWizard({ open, onOpenChange, onSaved }: BatchScanWizardProps) {
  const { t } = useTranslation("mercado");
  const { user } = useAuth();
  const savedMarkets = useMercadosLocais();
  const fileRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef(false);

  const [step, setStep] = useState<Step>("market");
  const [selectedMarketId, setSelectedMarketId] = useState<string>("");
  const [manualMode, setManualMode] = useState(false);
  const [manualMarket, setManualMarket] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [currentProcessing, setCurrentProcessing] = useState(0); // index 0-based being processed
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [saving, setSaving] = useState(false);

  // Reset when closed
  useEffect(() => {
    if (!open) {
      stopRef.current = true;
      // revoke object URLs
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setStep("market");
      setSelectedMarketId("");
      setManualMode(false);
      setManualMarket("");
      setPhotos([]);
      setCurrentProcessing(0);
      setReviewItems([]);
      setSaving(false);
    } else {
      stopRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Cleanup previews on unmount
  useEffect(() => {
    return () => {
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedMarket = useMemo(
    () => savedMarkets.find((m) => m.id === selectedMarketId) ?? null,
    [savedMarkets, selectedMarketId],
  );
  const marketName = manualMode
    ? manualMarket.trim()
    : selectedMarket?.nome.trim() ?? "";
  const marketId = manualMode ? null : selectedMarket?.id ?? null;

  function goNextFromMarket() {
    if (!marketName) {
      toast.error(t("communityPrices.batch.marketRequired"));
      return;
    }
    setStep("photos");
  }

  function addFiles(filesList: FileList | null) {
    if (!filesList) return;
    const incoming = Array.from(filesList);
    const accepted: Photo[] = [];
    let invalid = 0;
    let tooLarge = 0;
    for (const file of incoming) {
      if (photos.length + accepted.length >= MAX_PHOTOS) break;
      if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) {
        invalid++;
        continue;
      }
      if (file.size > MAX_BYTES) {
        tooLarge++;
        continue;
      }
      accepted.push({
        id: newId(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: "pending",
        items: [],
      });
    }
    if (invalid) toast.error(t("communityPrices.batch.invalidImage"));
    if (tooLarge) toast.error(t("communityPrices.batch.imageTooLarge"));
    if (photos.length + accepted.length >= MAX_PHOTOS && incoming.length > accepted.length) {
      toast.info(t("communityPrices.batch.maxPhotos", { max: MAX_PHOTOS }));
    }
    if (accepted.length) setPhotos((cur) => [...cur, ...accepted]);
  }

  function removePhoto(id: string) {
    setPhotos((cur) => {
      const found = cur.find((p) => p.id === id);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return cur.filter((p) => p.id !== id);
    });
  }

  function aggregateReview(currentPhotos: Photo[]): ReviewItem[] {
    const out: ReviewItem[] = [];
    currentPhotos.forEach((photo, idx) => {
      photo.items.forEach((it, k) => {
        out.push({
          ...it,
          id: `${photo.id}-${k}`,
          include: true,
          sourcePhotoIndex: idx + 1,
          marketName: marketName || it.marketName,
        });
      });
    });
    return out;
  }

  async function processPhoto(photo: Photo): Promise<Photo> {
    try {
      const base64 = await fileToProcessedDataUrl(photo.file);
      const res = await apiFetch("/api/mercado-flyer-ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, marketName: marketName || undefined }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        let reason: ErrorReason = "unknown_error";
        if (json?.code === "ocr_config_missing") reason = "ocr_config_missing";
        else if (json?.code === "vision_api_error") reason = "vision_api_error";
        else if (json?.code === "gemini_gateway_error") reason = "gemini_gateway_error";
        else if (json?.code === "invalid_image_payload" || json?.code === "unsupported_image_format") reason = "invalid_image_payload";
        else if (json?.code === "rate_limited" || res.status === 429) reason = "rate_limited";
        else if (res.status === 402) reason = "credits";
        return {
          ...photo,
          status: "error",
          errorReason: reason,
          errorMessage: json?.error || "",
        };
      }
      const items: DetectedItem[] = Array.isArray(json.items) ? json.items : [];
      if (items.length === 0) {
        const code = json?.code as string | undefined;
        const emptyReason: EmptyReason =
          code === "no_text_detected"
            ? "no_text_detected"
            : code === "text_found_but_no_items"
              ? "text_found_but_no_items"
              : code === "text_found_but_no_prices"
                ? "text_found_but_no_prices"
                : null;
        return {
          ...photo,
          status: "empty",
          items: [],
          emptyReason,
          errorReason: undefined,
          errorMessage: undefined,
          usedFallback: Boolean(json?.debugInfo?.usedFallback),
        };
      }
      return {
        ...photo,
        status: "done",
        items,
        emptyReason: undefined,
        errorReason: undefined,
        errorMessage: undefined,
        usedFallback: Boolean(json?.debugInfo?.usedFallback),
      };
    } catch (err) {
      console.error("[batch-scan] processPhoto", err);
      return { ...photo, status: "error", errorReason: "network", errorMessage: "network" };
    }
  }


  async function runQueue() {
    setStep("processing");
    stopRef.current = false;
    // Snapshot the queue at start, mark all pending->processing-on-demand
    const queue = photos.map((p, i) => ({ ...p, status: p.status === "done" ? p.status : ("pending" as PhotoStatus), index: i }));
    let working = photos.slice();
    for (let i = 0; i < queue.length; i++) {
      if (stopRef.current) break;
      if (working[i].status === "done") continue;
      setCurrentProcessing(i);
      working = working.map((p, idx) => (idx === i ? { ...p, status: "processing" as PhotoStatus } : p));
      setPhotos(working);
      const next = await processPhoto(working[i]);
      working = working.map((p, idx) => (idx === i ? next : p));
      setPhotos(working);
    }
    const review = aggregateReview(working);
    setReviewItems(review);
    setStep("review");
  }

  async function retryPhoto(id: string) {
    const i = photos.findIndex((p) => p.id === id);
    if (i < 0) return;
    setCurrentProcessing(i);
    let working = photos.map((p, idx) =>
      idx === i ? { ...p, status: "processing" as PhotoStatus, errorMessage: undefined } : p,
    );
    setPhotos(working);
    const next = await processPhoto(working[i]);
    working = working.map((p, idx) => (idx === i ? next : p));
    setPhotos(working);
    setReviewItems(aggregateReview(working));
  }

  const doneCount = photos.filter((p) => p.status === "done" || p.status === "empty").length;
  const errorCount = photos.filter((p) => p.status === "error").length;
  const withItemsCount = photos.filter((p) => p.status === "done").length;
  const noTextCount = photos.filter(
    (p) => p.status === "empty" && p.emptyReason === "no_text_detected",
  ).length;
  const textNoItemsCount = photos.filter(
    (p) => p.status === "empty" && p.emptyReason === "text_found_but_no_items",
  ).length;
  const technicalErrorCount = photos.filter((p) => p.status === "error").length;
  const allFailed = photos.length > 0 && errorCount === photos.length;
  const someFailed = errorCount > 0 && errorCount < photos.length;
  const noItems = step === "review" && reviewItems.length === 0;

  function getPhotoIssueLabel(photo: Photo): string {
    if (photo.status === "empty") {
      if (photo.emptyReason === "no_text_detected") return t("communityPrices.batch.errorNoText");
      if (photo.emptyReason === "text_found_but_no_items") return t("communityPrices.batch.errorTextNoItems");
      return t("communityPrices.batch.photoEmpty");
    }
    if (photo.status !== "error") return "";
    if (photo.errorReason === "ocr_config_missing") return t("communityPrices.batch.errorOcrConfigMissing");
    if (photo.errorReason === "vision_api_error") return t("communityPrices.batch.errorVisionApi");
    if (photo.errorReason === "invalid_image_payload") return t("communityPrices.batch.errorInvalidImagePayload");
    if (photo.errorReason === "rate_limited") return t("communityPrices.batch.errorRateLimited");
    if (photo.errorReason === "credits") return t("communityPrices.batch.errorCredits");
    if (photo.errorReason === "network") return t("communityPrices.batch.errorNetwork");
    return t("communityPrices.batch.errorUnknown");
  }


  // Duplicate detection (same productName + price)
  const hasDuplicates = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of reviewItems) {
      const key = `${r.productName.trim().toLowerCase()}|${r.price ?? ""}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return Array.from(seen.values()).some((n) => n > 1);
  }, [reviewItems]);

  function isItemValid(r: ReviewItem) {
    return (
      r.productName.trim().length > 0 &&
      r.price != null &&
      Number.isFinite(r.price) &&
      r.price > 0 &&
      !!(r.marketName ?? marketName)?.trim()
    );
  }

  async function saveAll() {
    if (!user) return;
    const toSave = reviewItems.filter((r) => r.include);
    if (!toSave.length) {
      toast.error(t("communityPrices.errors.selectAtLeastOne"));
      return;
    }
    const invalid = toSave.filter((r) => !isItemValid(r));
    if (invalid.length) {
      toast.error(t("communityPrices.errors.missingFields"));
      return;
    }
    setSaving(true);
    const today = new Date().toISOString().slice(0, 10);
    const rows = toSave.map((r) => ({
      user_id: user.id,
      product_name: r.productName.trim(),
      normalized_product_name: r.productName.trim().toLowerCase(),
      category: r.category,
      price: r.price,
      unit: r.unit,
      market_name: marketName,
      market_id: marketId,
      source: "flyer",
      seen_at: today,
      valid_until: r.validUntil,
      notes: r.notes
        ? `${r.notes} · ${t("communityPrices.batch.sourcePhoto", { index: r.sourcePhotoIndex })}`
        : t("communityPrices.batch.sourcePhoto", { index: r.sourcePhotoIndex }),
      confidence: r.confidence,
    }));
    const { error } = await (supabase.from(TABLE as never) as any).insert(rows);
    setSaving(false);
    if (error) {
      console.error("[batch-scan] insert", error.message);
      toast.error(t("communityPrices.batch.saveFailed"));
      return;
    }
    toast.success(
      t("communityPrices.batch.saveSuccess", { count: rows.length, market: marketName }),
    );
    onOpenChange(false);
    onSaved?.();
  }

  const stepNumber = step === "market" ? 1 : step === "photos" ? 2 : step === "processing" ? 3 : 4;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("communityPrices.batch.title")}</DialogTitle>
          <DialogDescription>
            {t("communityPrices.batch.stepLabel", { current: stepNumber, total: 4 })}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: market */}
        {step === "market" && (
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">{t("communityPrices.batch.marketStepTitle")}</h3>
              <p className="text-xs text-muted-foreground">{t("communityPrices.batch.marketStepDescription")}</p>
            </div>

            {!manualMode && (
              <div>
                <Label className="text-xs">{t("communityPrices.batch.savedMarketsLabel")}</Label>
                {savedMarkets.length === 0 ? (
                  <div className="mt-1 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                    <p>{t("communityPrices.batch.noSavedMarkets")}</p>
                    <Button asChild variant="link" size="sm" className="mt-1 h-auto p-0 text-xs">
                      <Link to="/mercado/meus-mercados" onClick={() => onOpenChange(false)}>
                        <Store className="mr-1 h-3.5 w-3.5" />
                        {t("communityPrices.batch.addMarketCta")}
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <select
                    className="mt-1 flex h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    value={selectedMarketId}
                    onChange={(e) => setSelectedMarketId(e.target.value)}
                  >
                    <option value="">{t("communityPrices.batch.selectMarket")}</option>
                    {savedMarkets.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nome}
                        {m.bairro || m.cidade ? ` · ${[m.bairro, m.cidade].filter(Boolean).join(", ")}` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={manualMode}
                onChange={(e) => setManualMode(e.target.checked)}
              />
              {t("communityPrices.batch.manualMarketToggle")}
            </label>

            {manualMode && (
              <div>
                <Label className="text-xs">{t("communityPrices.batch.manualMarketLabel")}</Label>
                <Input
                  value={manualMarket}
                  onChange={(e) => setManualMarket(e.target.value)}
                  placeholder={t("communityPrices.batch.manualMarketPlaceholder")}
                />
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => onOpenChange(false)} className="min-h-11">
                {t("communityPrices.batch.cancel")}
              </Button>
              <Button onClick={goNextFromMarket} className="min-h-11" disabled={!marketName}>
                {t("communityPrices.batch.next")} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: photos */}
        {step === "photos" && (
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">{t("communityPrices.batch.photosStepTitle")}</h3>
              <p className="text-xs text-muted-foreground">
                {t("communityPrices.batch.photosStepDescription")}{" "}
                {t("communityPrices.batch.maxPhotos", { max: MAX_PHOTOS })}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("communityPrices.batch.reviewMarketBadge", { name: marketName })}
              </p>
            </div>

            <div className="rounded-md border border-border bg-muted/30 p-2 text-[11px] text-muted-foreground">
              💡 {t("communityPrices.batch.photoTip")}
            </div>


            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              multiple
              capture="environment"
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />

            {photos.length === 0 ? (
              <Button
                variant="secondary"
                className="min-h-11 w-full"
                onClick={() => fileRef.current?.click()}
              >
                <Camera className="mr-2 h-4 w-4" />
                {t("communityPrices.batch.choosePhotos")}
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {t("communityPrices.batch.selectedPhotos", { count: photos.length })}
                </p>
                <ul className="grid max-h-[40vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
                  {photos.map((p, idx) => (
                    <li key={p.id} className="relative overflow-hidden rounded-md border border-border bg-muted/30">
                      <img
                        src={p.previewUrl}
                        alt={t("communityPrices.batch.photoLabel", { index: idx + 1 })}
                        className="aspect-square w-full object-cover"
                        loading="lazy"
                      />
                      <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removePhoto(p.id)}
                        aria-label={t("communityPrices.batch.removePhoto")}
                        className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
                <Button
                  variant="ghost"
                  className="min-h-11 w-full"
                  onClick={() => fileRef.current?.click()}
                  disabled={photos.length >= MAX_PHOTOS}
                >
                  <ImageIcon className="mr-2 h-4 w-4" />
                  {t("communityPrices.batch.addMorePhotos")}
                </Button>
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button variant="ghost" onClick={() => setStep("market")} className="min-h-11">
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("communityPrices.batch.back")}
              </Button>
              <Button
                onClick={runQueue}
                className="min-h-11"
                disabled={photos.length === 0}
              >
                <Camera className="mr-2 h-4 w-4" />
                {t("communityPrices.batch.processPhotos")}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: processing */}
        {step === "processing" && (
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">{t("communityPrices.batch.processingTitle")}</h3>
              <p className="text-xs text-muted-foreground">
                {doneCount < photos.length
                  ? t("communityPrices.batch.processingPhoto", {
                      current: Math.min(currentProcessing + 1, photos.length),
                      total: photos.length,
                    })
                  : t("communityPrices.batch.processingDone")}
              </p>
            </div>

            <ul className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
              {photos.map((p, idx) => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 rounded-md border border-border bg-card p-2"
                >
                  <img
                    src={p.previewUrl}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold">
                      {t("communityPrices.batch.photoLabel", { index: idx + 1 })}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {p.status === "pending" && t("communityPrices.batch.photoPending")}
                      {p.status === "processing" && (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {t("communityPrices.batch.photoProcessing")}
                        </span>
                      )}
                      {p.status === "done" && (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <Check className="h-3 w-3" />
                          {t("communityPrices.batch.photoDone", { count: p.items.length })}
                        </span>
                      )}
                      {p.status === "empty" && (
                        <span className="text-amber-700 dark:text-amber-400">
                          {p.emptyReason === "no_text_detected"
                            ? t("communityPrices.batch.errorNoText")
                            : p.emptyReason === "text_found_but_no_items"
                              ? t("communityPrices.batch.errorTextNoItems")
                              : t("communityPrices.batch.photoEmpty")}
                        </span>
                      )}
                      {p.status === "error" && (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <AlertTriangle className="h-3 w-3" />
                          {getPhotoIssueLabel(p)}
                        </span>
                      )}

                    </p>
                  </div>
                  {p.status === "error" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => retryPhoto(p.id)}
                    >
                      <RefreshCw className="mr-1 h-3.5 w-3.5" />
                      {t("communityPrices.batch.retryPhoto")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button
                variant="ghost"
                onClick={() => {
                  stopRef.current = true;
                  setStep("photos");
                }}
                className="min-h-11"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("communityPrices.batch.back")}
              </Button>
              <Button
                onClick={() => {
                  stopRef.current = true;
                  setReviewItems(aggregateReview(photos));
                  setStep("review");
                }}
                className="min-h-11"
                disabled={doneCount + errorCount < photos.length}
              >
                {t("communityPrices.batch.continueToReview")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: review */}
        {step === "review" && (
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">{t("communityPrices.batch.reviewTitle")}</h3>
              <p className="text-xs text-muted-foreground">{t("communityPrices.batch.reviewDescription")}</p>
              <p className="mt-1 inline-flex rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-on-soft">
                {t("communityPrices.batch.reviewMarketBadge", { name: marketName })}
              </p>
            </div>

            {photos.length > 0 && (
              <div className="space-y-1 rounded-md border border-border bg-muted/20 p-2 text-[11px] text-muted-foreground">
                <div>
                  {t("communityPrices.batch.readSummary", {
                    read: withItemsCount,
                    total: photos.length,
                  })}
                </div>
                <div>{t("communityPrices.batch.summaryItemsFound", { count: reviewItems.length })}</div>
                {noTextCount > 0 && (
                  <div>{t("communityPrices.batch.summaryNoText", { count: noTextCount })}</div>
                )}
                {textNoItemsCount > 0 && (
                  <div>
                    {t("communityPrices.batch.summaryTextNoItems", { count: textNoItemsCount })}
                  </div>
                )}
                {errorCount > 0 && (
                  <div>{t("communityPrices.batch.summaryErrors", { count: errorCount })}</div>
                )}
                {technicalErrorCount > 0 && (
                  <div>{t("communityPrices.batch.summaryTechnicalErrors", { count: technicalErrorCount })}</div>
                )}
              </div>
            )}

            {photos.some((p) => p.status === "error" || p.status === "empty") && (
              <ul className="space-y-1 rounded-md border border-border bg-muted/20 p-2 text-[11px] text-muted-foreground">
                {photos.map((p, idx) => {
                  const issue = getPhotoIssueLabel(p);
                  if (!issue) return null;
                  return (
                    <li key={p.id} className="flex items-start gap-1">
                      <span className="font-semibold">{t("communityPrices.batch.photoLabel", { index: idx + 1 })}:</span>
                      <span>{issue}</span>
                    </li>
                  );
                })}
              </ul>
            )}


            {allFailed && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[12px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{t("communityPrices.batch.allFailed")}</span>
              </div>
            )}
            {someFailed && !allFailed && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300/40 bg-amber-50/50 p-2 text-[12px] text-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{t("communityPrices.batch.someFailed")}</span>
              </div>
            )}
            {noItems && !allFailed && (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-center text-xs text-muted-foreground">
                <p>{t("communityPrices.batch.noItemsFound")}</p>
                <p className="mt-1 text-[11px]">{t("communityPrices.batch.tryCloserPhoto")}</p>
              </div>
            )}
            {hasDuplicates && reviewItems.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300/40 bg-amber-50/50 p-2 text-[12px] text-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{t("communityPrices.batch.duplicateWarning")}</span>
              </div>
            )}

            {reviewItems.length > 0 && (
              <ul className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
                {reviewItems.map((r, idx) => {
                  const invalidPrice = r.include && (r.price == null || !Number.isFinite(r.price) || r.price <= 0);
                  const missingProduct = r.include && !r.productName.trim();
                  const lowConfidence = typeof r.confidence === "number" && r.confidence < 0.5;
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
                              setReviewItems((cur) =>
                                cur.map((x, i) => (i === idx ? { ...x, include: e.target.checked } : x)),
                              )
                            }
                          />
                          {t("communityPrices.review.include")}
                          <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            {t("communityPrices.batch.sourcePhoto", { index: r.sourcePhotoIndex })}
                          </span>
                          {typeof r.confidence === "number" && (
                            <span className="text-[10px] text-muted-foreground">
                              {t("communityPrices.review.confidence", { value: Math.round(r.confidence * 100) })}
                            </span>
                          )}
                          {lowConfidence && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                              <AlertTriangle className="h-3 w-3" />
                              {t("communityPrices.batch.lowConfidenceBadge")}
                            </span>
                          )}
                        </label>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setReviewItems((cur) => cur.filter((_, i) => i !== idx))}
                          aria-label={t("communityPrices.review.remove")}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      {lowConfidence && (
                        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                          {t("communityPrices.batch.lowConfidenceHint")}
                        </p>
                      )}
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div>
                          <Label className="text-xs">{t("communityPrices.review.fields.product")}</Label>
                          <Input
                            value={r.productName}
                            onChange={(e) =>
                              setReviewItems((cur) =>
                                cur.map((x, i) => (i === idx ? { ...x, productName: e.target.value } : x)),
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
                          <Label className="text-xs">{t("communityPrices.review.fields.price")}</Label>
                          <Input
                            inputMode="decimal"
                            value={r.price ?? ""}
                            onChange={(e) => {
                              const v = e.target.value.replace(",", ".");
                              const n = v === "" ? null : Number(v);
                              setReviewItems((cur) =>
                                cur.map((x, i) =>
                                  i === idx
                                    ? { ...x, price: Number.isFinite(n as number) ? (n as number) : null }
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
                          <Label className="text-xs">{t("communityPrices.review.fields.unit")}</Label>
                          <Input
                            value={r.unit ?? ""}
                            onChange={(e) =>
                              setReviewItems((cur) =>
                                cur.map((x, i) => (i === idx ? { ...x, unit: e.target.value || null } : x)),
                              )
                            }
                            placeholder={t("communityPrices.review.fields.unitPlaceholder")}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">{t("communityPrices.review.fields.category")}</Label>
                          <Input
                            value={r.category ?? ""}
                            onChange={(e) =>
                              setReviewItems((cur) =>
                                cur.map((x, i) => (i === idx ? { ...x, category: e.target.value || null } : x)),
                              )
                            }
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <Label className="text-xs">{t("communityPrices.review.fields.validUntil")}</Label>
                          <Input
                            type="date"
                            value={r.validUntil ?? ""}
                            onChange={(e) =>
                              setReviewItems((cur) =>
                                cur.map((x, i) => (i === idx ? { ...x, validUntil: e.target.value || null } : x)),
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
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button variant="ghost" onClick={() => setStep("photos")} className="min-h-11" disabled={saving}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("communityPrices.batch.back")}
              </Button>
              <Button onClick={saveAll} className="min-h-11" disabled={saving || reviewItems.length === 0}>
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {t("communityPrices.batch.saveReviewed")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
