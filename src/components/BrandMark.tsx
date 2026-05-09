import { cn } from "@/lib/utils";

/**
 * Official Gasto Inteligente logo (full lockup: símbolo + "Gasto Inteligente").
 *
 * Served from /public/logos/brand/ via absolute URLs so the asset resolves
 * identically in the Lovable preview, in published deployments and in any
 * embedded/external context — no bundler hashing surprises.
 *
 * - `variant="auto"` (default): switches between dark-bg and light-bg lockups
 *   based on the active theme.
 * - `symbolOnly`: only the icon (no wordmark) for very compact spots.
 */
const LOGO_LIGHT = "/logos/brand/gasto-inteligente-light.png";
const LOGO_DARK = "/logos/brand/gasto-inteligente-dark.png";
const LOGO_SYMBOL = "/logos/brand/gasto-inteligente-symbol.png";

export function BrandMark({
  className,
  symbolOnly = false,
  alt = "Gasto Inteligente",
}: {
  className?: string;
  symbolOnly?: boolean;
  alt?: string;
}) {
  if (symbolOnly) {
    return (
      <img
        src={LOGO_SYMBOL}
        alt={alt}
        className={cn("object-contain", className)}
        draggable={false}
      />
    );
  }
  return (
    <>
      <img
        src={LOGO_DARK}
        alt={alt}
        width={1920}
        height={619}
        className={cn(
          "hidden dark:block w-auto max-w-full object-contain",
          className,
        )}
        draggable={false}
      />
      <img
        src={LOGO_LIGHT}
        alt={alt}
        width={1920}
        height={619}
        className={cn(
          "block dark:hidden w-auto max-w-full object-contain",
          className,
        )}
        draggable={false}
      />
    </>
  );
}
