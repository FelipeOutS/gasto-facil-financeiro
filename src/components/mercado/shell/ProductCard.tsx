import { type ReactNode, useState } from "react";
import { Plus, ShoppingBasket } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { MarketBadge } from "./MarketBadge";
import { useProductImage } from "@/lib/mercado/use-product-image";
import type { MercadoCategoryKey } from "./MercadoCategoryChips";

export type ProductSource =
  | "online"
  | "flyer"
  | "manual"
  | "store"
  | "receipt"
  | "community";

export interface ProductCardProps {
  name: string;
  /** Valor já formatado (ex.: "R$ 9,90") para evitar acoplar i18n de moeda aqui. */
  priceLabel: string;
  /** Texto curto da unidade (ex.: "kg", "L", "un"). */
  unitLabel?: string;
  /** Imagem explícita (vinda do banco/usuário). Tem prioridade absoluta. */
  imageUrl?: string | null;
  marketName?: string | null;
  marketLogoUrl?: string | null;
  source?: ProductSource;
  /** Data já formatada para exibição (ex.: "01/06/2026"). */
  seenAtLabel?: string;
  /** Layout: 'compact' (vitrine horizontal) ou 'list' (linha). */
  layout?: "compact" | "list";
  onAdd?: () => void;
  /** Slot livre no canto inferior direito (ex.: badge custom). */
  extra?: ReactNode;
  className?: string;
  /** Dados opcionais usados para sugerir imagem automaticamente quando `imageUrl` não vier. */
  brand?: string | null;
  barcode?: string | null;
  category?: MercadoCategoryKey | null;
  /** Desliga o lookup automático de imagem (default: ligado). */
  disableImageLookup?: boolean;
}

export function ProductCard({
  name,
  priceLabel,
  unitLabel,
  imageUrl,
  marketName,
  marketLogoUrl,
  source,
  seenAtLabel,
  layout = "compact",
  onAdd,
  extra,
  className,
  brand,
  barcode,
  category,
  disableImageLookup = false,
}: ProductCardProps) {
  const { t } = useTranslation("mercado");
  const sourceLabel = source ? t(`shell.product.source.${source}`) : null;
  const [imgErrored, setImgErrored] = useState(false);
  const [suggestedErrored, setSuggestedErrored] = useState(false);

  // Imagem explícita tem prioridade — nunca sobrescrever escolha do usuário.
  const hasExplicit = !!imageUrl && !imgErrored;
  const lookupEnabled = !hasExplicit && !disableImageLookup;
  const suggestion = useProductImage(
    { productName: name, brand, barcode, category },
    { enabled: lookupEnabled },
  );

  const suggestedUrl =
    !hasExplicit && !suggestedErrored ? suggestion.data?.imageUrl ?? null : null;
  const finalImage = hasExplicit ? imageUrl! : suggestedUrl;
  const showImage = !!finalImage;
  const isSuggested = !hasExplicit && !!suggestedUrl;
  const isBrandLogo = isSuggested && suggestion.data?.source === "brand_logo";
  const suggestedBadgeLabel = isBrandLogo
    ? t("shell.product.brandLogoHint", { defaultValue: "logo da marca" })
    : t("shell.product.suggestedImage", { defaultValue: "imagem sugerida" });

  const initial = (name || "").trim().charAt(0).toUpperCase() || "•";

  const Fallback = ({ size }: { size: "sm" | "lg" }) => (
    <div
      className="grid h-full w-full place-items-center bg-brand-soft text-brand"
      aria-hidden="true"
    >
      <div className="flex flex-col items-center gap-1">
        <ShoppingBasket className={size === "lg" ? "h-7 w-7" : "h-5 w-5"} />
        <span
          className={cn(
            "font-bold leading-none opacity-70",
            size === "lg" ? "text-sm" : "text-[10px]",
          )}
        >
          {initial}
        </span>
      </div>
    </div>
  );

  const onImgError = () => {
    if (hasExplicit) setImgErrored(true);
    else setSuggestedErrored(true);
  };

  if (layout === "list") {
    return (
      <article
        className={cn(
          "flex w-full gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-card",
          className,
        )}
      >
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-muted/60 to-muted">
          {showImage ? (
            <>
              <img
                src={finalImage!}
                alt={t("shell.product.imageAlt", { name })}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="h-full w-full object-contain p-1.5"
                onError={onImgError}
              />
              {isSuggested && (
                <span
                  className="absolute inset-x-0 bottom-0 bg-background/85 px-1 py-0.5 text-center text-[8px] font-medium uppercase tracking-wider text-muted-foreground backdrop-blur"
                  title={suggestedBadgeLabel}
                >
                  {isBrandLogo ? "logo" : "auto"}
                </span>
              )}
            </>
          ) : (
            <Fallback size="sm" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="line-clamp-2 text-sm font-semibold text-foreground">{name}</h3>
          <div className="mt-1 flex items-center gap-2">
            <span className="num text-base font-bold text-foreground">{priceLabel}</span>
            {unitLabel && (
              <span className="text-[11px] text-muted-foreground">
                / {unitLabel}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {marketName && <MarketBadge name={marketName} logoUrl={marketLogoUrl} />}
            {sourceLabel && (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {sourceLabel}
              </span>
            )}
            {seenAtLabel && (
              <span className="text-[10px] text-muted-foreground">
                {t("shell.product.seenOn", { date: seenAtLabel })}
              </span>
            )}
          </div>
        </div>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            aria-label={t("shell.product.addToList")}
            className="grid h-11 w-11 shrink-0 self-center place-items-center rounded-full bg-brand-grad text-primary-foreground shadow-elevated transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        {extra}
      </article>
    );
  }

  // compact
  return (
    <article
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card",
        className,
      )}
    >
      <div className="relative aspect-square w-full bg-gradient-to-br from-muted/60 to-muted">
        {showImage ? (
          <img
            src={finalImage!}
            alt={t("shell.product.imageAlt", { name })}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-contain p-2.5"
            onError={onImgError}
          />
        ) : (
          <Fallback size="lg" />
        )}
        {sourceLabel && (
          <span className="absolute left-1.5 top-1.5 inline-flex items-center rounded-full bg-background/85 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-foreground backdrop-blur">
            {sourceLabel}
          </span>
        )}
        {isSuggested && (
          <span
            className="absolute bottom-1.5 right-1.5 inline-flex items-center rounded-full bg-background/85 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wider text-muted-foreground backdrop-blur"
            title={suggestedBadgeLabel}
          >
            {isBrandLogo ? "logo" : "auto"}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <h3 className="line-clamp-2 min-h-[2.1rem] text-[12px] font-semibold leading-tight text-foreground">
          {name}
        </h3>
        <div className="flex items-baseline gap-1">
          <span className="num text-sm font-bold text-foreground">{priceLabel}</span>
          {unitLabel && (
            <span className="text-[10px] text-muted-foreground">/ {unitLabel}</span>
          )}
        </div>
        {marketName && <MarketBadge name={marketName} logoUrl={marketLogoUrl} />}
        {seenAtLabel && (
          <span className="text-[10px] text-muted-foreground">
            {t("shell.product.seenOn", { date: seenAtLabel })}
          </span>
        )}
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="mt-1 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-brand-grad text-xs font-semibold text-primary-foreground shadow-elevated transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("shell.product.addToList")}
          </button>
        )}
        {extra}
      </div>
    </article>
  );
}
