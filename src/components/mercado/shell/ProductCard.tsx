import { type ReactNode, useState } from "react";
import { Plus, ShoppingBasket } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { MarketBadge } from "./MarketBadge";

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
}: ProductCardProps) {
  const { t } = useTranslation("mercado");
  const sourceLabel = source ? t(`shell.product.source.${source}`) : null;

  if (layout === "list") {
    return (
      <article
        className={cn(
          "flex w-full gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-card",
          className,
        )}
      >
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-muted">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={t("shell.product.imageAlt", { name })}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-muted-foreground">
              <ImageOff className="h-5 w-5" aria-hidden="true" />
            </div>
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
      <div className="relative aspect-square w-full bg-muted">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={t("shell.product.imageAlt", { name })}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-muted-foreground">
            <ImageOff className="h-6 w-6" aria-hidden="true" />
          </div>
        )}
        {sourceLabel && (
          <span className="absolute left-2 top-2 inline-flex items-center rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground backdrop-blur">
            {sourceLabel}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="line-clamp-2 min-h-[2.5rem] text-[13px] font-semibold leading-tight text-foreground">
          {name}
        </h3>
        <div className="flex items-baseline gap-1">
          <span className="num text-base font-bold text-foreground">{priceLabel}</span>
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
