import { useEffect, useMemo, useRef, useState, memo } from "react";
import { Building2, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { getBankLogo, getMerchantLogo, type BrandResolved } from "@/lib/logos";
import { getLogoCandidates } from "@/lib/brand/resolver";

type Variant = "bank" | "merchant";

type Props = {
  name: string | undefined | null;
  variant: Variant;
  className?: string;
  onDark?: boolean;
  imgClassName?: string;
};

/**
 * Renders a brand logo.
 *
 * Cascade:
 *  1. Static SVG bundled locally (BANK_URL / MERCHANT_URL).
 *  2. Dynamic candidates from the global resolver (Logo.dev → favicon.im →
 *     Google s2 → DuckDuckGo). This lets any bank/merchant the user types
 *     show a real logo even when we don't ship a local SVG for it.
 *  3. Elegant colored initial fallback.
 */
function BrandLogoBase({ name, variant, className, onDark, imgClassName }: Props) {
  const resolved: BrandResolved =
    variant === "bank" ? getBankLogo(name) : getMerchantLogo(name);

  // Static logo display: keep the previously displayed url visible while a
  // new one decodes — prevents flicker when switching cards.
  const [displayedUrl, setDisplayedUrl] = useState<string | null>(resolved.logoUrl);
  const [staticErrored, setStaticErrored] = useState(false);
  const lastLoadedRef = useRef<string | null>(null);

  useEffect(() => {
    const next = resolved.logoUrl;
    if (!next) {
      setDisplayedUrl(null);
      setStaticErrored(false);
      return;
    }
    if (next === lastLoadedRef.current) {
      setDisplayedUrl(next);
      setStaticErrored(false);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.src = next;
    const apply = () => {
      if (cancelled) return;
      lastLoadedRef.current = next;
      setDisplayedUrl(next);
      setStaticErrored(false);
    };
    if (img.complete && img.naturalWidth > 0) {
      apply();
    } else {
      img.onload = apply;
      img.onerror = () => {
        if (cancelled) return;
        setStaticErrored(true);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [resolved.logoUrl]);

  // Dynamic candidates (Logo.dev → favicon.im → Google s2 → DuckDuckGo).
  // Para bancos, sempre usamos os logos do Logo.dev (substituindo os SVGs
  // locais), com trustedOnly para evitar palpites por TLD e flicker.
  // Para merchants, mantemos o fallback dinâmico só quando não há SVG local.
  const dynamicCandidates = useMemo(() => {
    if (!name) return [];
    if (variant === "bank") return getLogoCandidates(null, name, { trustedOnly: true });
    if (resolved.logoUrl) return [];
    return getLogoCandidates(null, name);
  }, [resolved.logoUrl, name, variant]);
  const [dynIdx, setDynIdx] = useState(0);
  useEffect(() => {
    setDynIdx(0);
  }, [dynamicCandidates]);
  const dynamicUrl =
    dynamicCandidates.length && dynIdx < dynamicCandidates.length
      ? dynamicCandidates[dynIdx]
      : null;

  // Bancos: nunca renderiza o SVG estático — sempre cascata Logo.dev.
  const showStatic = variant !== "bank" && !!displayedUrl && !staticErrored;
  const bg = resolved.brandColor || (variant === "bank" ? "#3b82f6" : "#64748b");
  const FallbackIcon = variant === "bank" ? Building2 : Store;

  // ---------- variant: bank + onDark (credit card surfaces) ----------
  if (variant === "bank" && onDark) {
    if (showStatic) {
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
            onError={() => setStaticErrored(true)}
            decoding="async"
          />
        </span>
      );
    }
    // Dynamic fallback (Logo.dev) — render inside a soft white pill so the
    // colored bank wordmark stays legible on top of the dark card.
    if (dynamicUrl) {
      return (
        <span
          className={cn(
            "bank-logo-container relative inline-flex items-center justify-center overflow-hidden",
            className,
          )}
          aria-hidden
        >
          <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-lg bg-white/95 p-1 ring-1 ring-black/5">
            <img
              src={dynamicUrl}
              alt=""
              className="h-full w-full object-contain"
              onError={() => setDynIdx((i) => i + 1)}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth > 0 && img.naturalWidth < 32) {
                  setDynIdx((i) => i + 1);
                }
              }}
              decoding="async"
            />
          </span>
        </span>
      );
    }
    // Final fallback — colored initial pill.
    return (
      <span
        className={cn(
          "bank-logo-container relative inline-flex items-center justify-start overflow-hidden",
          className,
        )}
        aria-hidden
      >
        <span
          className="grid h-10 w-10 place-items-center rounded-lg text-sm font-bold text-white"
          style={{ background: bg }}
        >
          {resolved.initial && resolved.initial !== "?" ? (
            resolved.initial
          ) : (
            <FallbackIcon className="h-4 w-4 text-white" />
          )}
        </span>
      </span>
    );
  }

  // ---------- variant: merchant / non-onDark bank ----------
  if (showStatic) {
    return (
      <span
        className={cn(
          "transaction-avatar logo-mode relative grid place-items-center overflow-hidden",
          "h-9 w-9",
          className,
        )}
        aria-hidden
      >
        <img
          src={displayedUrl!}
          alt=""
          className={cn("h-full w-full object-contain", imgClassName)}
          onError={() => setStaticErrored(true)}
          decoding="async"
        />
      </span>
    );
  }

  if (dynamicUrl) {
    return (
      <span
        className={cn(
          "transaction-avatar logo-mode relative grid place-items-center overflow-hidden rounded-full bg-white/95 ring-1 ring-black/5",
          "h-9 w-9",
          className,
        )}
        aria-hidden
      >
        <img
          src={dynamicUrl}
          alt=""
          className={cn("h-full w-full object-contain p-1", imgClassName)}
          onError={() => setDynIdx((i) => i + 1)}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0 && img.naturalWidth < 32) {
              setDynIdx((i) => i + 1);
            }
          }}
          decoding="async"
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "transaction-avatar relative grid place-items-center overflow-hidden rounded-full",
        "h-9 w-9",
        className,
      )}
      aria-hidden
      style={{ background: bg, color: "#fff" }}
    >
      {resolved.initial && resolved.initial !== "?" ? (
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
