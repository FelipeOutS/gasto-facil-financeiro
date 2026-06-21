import { cn } from "@/lib/utils";

/**
 * Official Gasto Inteligente brand mark.
 *
 * Centralized component — every screen must render the logo through this
 * component so light/dark variants stay consistent.
 *
 * Variants:
 * - `full`    → big surfaces (landing, public pages, footer, splashes).
 * - `login`   → auth screens (login, cadastro, recuperar-senha, confirmar).
 * - `sidebar` → app sidebar (open) and side menus.
 * - `symbol`  → icon-only (collapsed sidebar, compact headers, loaders,
 *               mobile top bar when space is tight).
 *
 * The component always renders both the light-bg and dark-bg SVG and lets
 * Tailwind's `dark:` variant swap them — no CSS filters / recoloring.
 */

type Variant = "full" | "login" | "sidebar" | "symbol";

const SOURCES: Record<Variant, { light: string; dark: string }> = {
  full: {
    light: "/logos/brand/logo-gasto-inteligente-completo-light.svg",
    dark: "/logos/brand/logo-gasto-inteligente-completo-dark.svg",
  },
  login: {
    light: "/logos/brand/logo-gasto-inteligente-login-light.svg",
    dark: "/logos/brand/logo-gasto-inteligente-login-dark.svg",
  },
  sidebar: {
    light: "/logos/brand/logo-gasto-inteligente-sidebar-light.svg",
    dark: "/logos/brand/logo-gasto-inteligente-sidebar-dark.svg",
  },
  symbol: {
    light: "/logos/brand/icone-gasto-inteligente-light.svg",
    dark: "/logos/brand/icone-gasto-inteligente-dark.svg",
  },
};

export interface BrandMarkProps {
  className?: string;
  variant?: Variant;
  /** @deprecated use `variant="symbol"` */
  symbolOnly?: boolean;
  alt?: string;
  /** Mark as decorative — sets aria-hidden and empty alt. */
  decorative?: boolean;
}

export function BrandMark({
  className,
  variant,
  symbolOnly,
  alt = "Gasto Inteligente",
  decorative = false,
}: BrandMarkProps) {
  const resolved: Variant = variant ?? (symbolOnly ? "symbol" : "full");
  const { light, dark } = SOURCES[resolved];
  const imgAlt = decorative ? "" : alt;
  const ariaHidden = decorative ? true : undefined;

  return (
    <>
      <img
        src={dark}
        alt={imgAlt}
        aria-hidden={ariaHidden}
        className={cn(
          "hidden dark:block w-auto max-w-full object-contain select-none",
          className,
        )}
        draggable={false}
      />
      <img
        src={light}
        alt={imgAlt}
        aria-hidden={ariaHidden}
        className={cn(
          "block dark:hidden w-auto max-w-full object-contain select-none",
          className,
        )}
        draggable={false}
      />
    </>
  );
}
