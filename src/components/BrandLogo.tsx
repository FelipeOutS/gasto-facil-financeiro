import { useState } from "react";
import { Building2, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { getBankLogo, getMerchantLogo, type BrandResolved } from "@/lib/logos";

type Variant = "bank" | "merchant";

type Props = {
  name: string | undefined | null;
  variant: Variant;
  /** Tailwind size class for the wrapper (h-* w-*). Default: h-9 w-9 */
  className?: string;
  /**
   * When true, render the logo directly over a dark surface (e.g. card
   * background). The local SVGs are designed in white, so we skip the
   * white circle wrapper and let the SVG breathe over the card color.
   */
  onDark?: boolean;
  /** Custom inner padding for the logo image */
  imgClassName?: string;
};

/**
 * Renders a brand logo with elegant fallback (colored circle + initial).
 * Never shows a broken image: if the local file 404s we swap to fallback.
 */
export function BrandLogo({ name, variant, className, onDark, imgClassName }: Props) {
  const resolved: BrandResolved =
    variant === "bank" ? getBankLogo(name) : getMerchantLogo(name);
  const [errored, setErrored] = useState(false);

  const showLogo = !!resolved.logoUrl && !errored;

  // Fallback background — brand color when known, otherwise neutral.
  const bg = resolved.brandColor || (variant === "bank" ? "#3b82f6" : "#64748b");
  const FallbackIcon = variant === "bank" ? Building2 : Store;

  // ---- Bank on dark surface: render SVG directly, no white pill ----
  // Standardized container: fixed visual height, contained width, left-aligned.
  // Every bank logo (square or wide) renders at the same visual height so
  // cards stay consistent and never overlap card content.
  if (variant === "bank" && onDark && showLogo) {
    return (
      <span
        className={cn(
          "bank-logo-container relative inline-flex items-center justify-start overflow-hidden",
          className,
        )}
        aria-hidden
      >
        <img
          src={resolved.logoUrl!}
          alt=""
          className={cn(
            "block h-auto w-auto max-h-full max-w-full object-contain object-left",
            imgClassName,
          )}
          onError={() => setErrored(true)}
          loading="lazy"
          decoding="async"
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "relative grid place-items-center overflow-hidden rounded-full shadow-sm ring-1",
        onDark
          ? "bg-white ring-white/40"
          : "bg-white ring-border",
        "h-9 w-9",
        className,
      )}
      aria-hidden
      style={
        // Use brand color as background ONLY for fallback (when no image)
        showLogo
          ? undefined
          : { background: bg, color: "#fff" }
      }
    >
      {showLogo ? (
        <img
          src={resolved.logoUrl!}
          alt=""
          className={cn("h-full w-full object-contain p-1.5", imgClassName)}
          onError={() => setErrored(true)}
          loading="lazy"
          decoding="async"
        />
      ) : resolved.initial && resolved.initial !== "?" ? (
        <span className="text-xs font-bold leading-none text-white">
          {resolved.initial}
        </span>
      ) : (
        <FallbackIcon className="h-4 w-4 text-white" />
      )}
    </span>
  );
}
