import { useEffect, useRef, useState, memo } from "react";
import { Building2, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { getBankLogo, getMerchantLogo, type BrandResolved } from "@/lib/logos";

type Variant = "bank" | "merchant";

type Props = {
  name: string | undefined | null;
  variant: Variant;
  className?: string;
  onDark?: boolean;
  imgClassName?: string;
};

/**
 * Renders a brand logo with elegant fallback (colored circle + initial).
 * Keeps the previously displayed logo visible until the next one is decoded
 * to prevent flashes / empty space when switching between cards.
 */
function BrandLogoBase({ name, variant, className, onDark, imgClassName }: Props) {
  const resolved: BrandResolved =
    variant === "bank" ? getBankLogo(name) : getMerchantLogo(name);

  // The URL we are currently *displaying*. Starts as the resolved URL so the
  // very first paint shows the correct logo (no fallback flicker).
  const [displayedUrl, setDisplayedUrl] = useState<string | null>(resolved.logoUrl);
  const [errored, setErrored] = useState(false);
  const lastLoadedRef = useRef<string | null>(null);

  // When the resolved URL changes, decode the new image off-screen first; only
  // swap the visible <img> src once it's ready. Static Vite imports mean the
  // file is already in the bundle/HTTP cache, so this resolves immediately.
  useEffect(() => {
    const next = resolved.logoUrl;
    if (!next) {
      setDisplayedUrl(null);
      setErrored(false);
      return;
    }
    if (next === lastLoadedRef.current) {
      setDisplayedUrl(next);
      setErrored(false);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.src = next;
    const apply = () => {
      if (cancelled) return;
      lastLoadedRef.current = next;
      setDisplayedUrl(next);
      setErrored(false);
    };
    if (img.complete && img.naturalWidth > 0) {
      apply();
    } else {
      img.onload = apply;
      img.onerror = () => {
        if (cancelled) return;
        setErrored(true);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [resolved.logoUrl]);

  const showLogo = !!displayedUrl && !errored;
  const bg = resolved.brandColor || (variant === "bank" ? "#3b82f6" : "#64748b");
  const FallbackIcon = variant === "bank" ? Building2 : Store;

  if (variant === "bank" && onDark && showLogo) {
    const WIDE_BANK_SLUGS = new Set([
      "mercadopago-branco",
      "logo-santander",
      "Banco_Bradesco",
      "banco-do-brasil",
      "picpay",
      "will-bank",
      "banco-inter",
    ]);
    const isWide = !!resolved.slug && WIDE_BANK_SLUGS.has(resolved.slug);
    return (
      <span
        className={cn(
          "bank-logo-container relative inline-flex items-center justify-start overflow-hidden",
          isWide && "bank-logo-wide",
          className,
        )}
        aria-hidden
      >
        <img
          src={displayedUrl!}
          alt=""
          className={cn(
            "block h-auto w-auto max-h-full max-w-full object-contain object-left",
            imgClassName,
          )}
          onError={() => setErrored(true)}
          decoding="async"
          // No lazy loading — these must appear instantly when a card is selected.
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "relative grid place-items-center overflow-hidden rounded-full shadow-sm ring-1",
        onDark ? "bg-white ring-white/40" : "bg-white ring-border",
        "h-9 w-9",
        className,
      )}
      aria-hidden
      style={showLogo ? undefined : { background: bg, color: "#fff" }}
    >
      {showLogo ? (
        <img
          src={displayedUrl!}
          alt=""
          className={cn("h-full w-full object-contain p-1.5", imgClassName)}
          onError={() => setErrored(true)}
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

export const BrandLogo = memo(BrandLogoBase);
