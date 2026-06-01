/**
 * Pré-visualização e remoção de imagem sugerida automaticamente para um
 * item de produto (usado no review do OCR e no modal manual). Faz lookup
 * lazy via `useProductImage` (cache/dedup compartilhado).
 *
 * A imagem é sempre tratada como ILUSTRATIVA/sugerida — nunca substitui
 * conferência humana. Se o lookup falhar, mostra mensagem amigável e não
 * bloqueia o salvamento.
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ImageOff, Loader2, X } from "lucide-react";
import { useProductImage } from "@/lib/mercado/use-product-image";
import type { ProductImageResult } from "@/lib/mercado/product-image.functions";

export type ProductImageReviewProps = {
  productName: string;
  brand?: string | null;
  barcode?: string | null;
  removed: boolean;
  onRemove: () => void;
  onResult?: (result: ProductImageResult | null) => void;
  /** Quando false, não dispara o lookup (ex.: produto sem nome ainda). */
  enabled?: boolean;
};

export function ProductImageReview({
  productName,
  brand,
  barcode,
  removed,
  onRemove,
  onResult,
  enabled = true,
}: ProductImageReviewProps) {
  const { t } = useTranslation("mercado");
  const active = enabled && !removed && productName.trim().length >= 2;
  const { data, isLoading } = useProductImage(
    { productName, brand, barcode },
    { enabled: active },
  );

  // Repassa o resultado mais recente sem reagir a mudanças no callback.
  const cbRef = useRef(onResult);
  useEffect(() => {
    cbRef.current = onResult;
  });
  useEffect(() => {
    if (!active) return;
    if (isLoading) return;
    cbRef.current?.(data ?? null);
  }, [active, isLoading, data]);

  if (removed) return null;

  if (isLoading) {
    return (
      <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        {t("communityPrices.image.searching")}
      </div>
    );
  }

  const url = data?.imageUrl ?? null;
  if (!url) {
    return (
      <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ImageOff className="h-3 w-3" aria-hidden="true" />
        {t("communityPrices.image.noImageFound")}
      </div>
    );
  }

  const isBrandLogo = data?.source === "brand_logo";

  return (
    <div className="mt-2 flex items-start gap-2 rounded-lg border border-border/60 bg-card-elevated/40 p-2">
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted">
        <img
          src={url}
          alt={t("communityPrices.image.previewAlt", { name: productName })}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={
            isBrandLogo ? "h-full w-full object-contain p-1" : "h-full w-full object-cover"
          }
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {isBrandLogo
            ? t("communityPrices.image.brandLogo", { defaultValue: "logo da marca" })
            : t("communityPrices.image.suggestedImage")}
        </span>
        <span className="text-[10px] italic text-muted-foreground">
          {t("communityPrices.image.illustrativeImage")}
        </span>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("communityPrices.image.removeImage")}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-border/60 px-2 text-[10px] font-medium text-muted-foreground transition hover:text-destructive"
      >
        <X className="h-3 w-3" aria-hidden="true" />
        {t("communityPrices.image.removeImage")}
      </button>
    </div>
  );
}
