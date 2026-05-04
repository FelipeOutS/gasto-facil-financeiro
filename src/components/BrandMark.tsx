import logoDark from "@/assets/logo-dark.png";
import logoLight from "@/assets/logo-light.png";
import { cn } from "@/lib/utils";

/**
 * Official Gasto Inteligente logo.
 * - `variant="auto"` (default) shows the dark-bg logo on dark theme
 *   and the light-bg logo on light theme via Tailwind dark: utilities.
 * - `symbolOnly` always uses the symbol (dark version, no wordmark).
 */
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
        src={logoDark}
        alt={alt}
        className={cn("object-contain", className)}
        draggable={false}
      />
    );
  }
  return (
    <>
      <img
        src={logoDark}
        alt={alt}
        className={cn("hidden dark:block object-contain", className)}
        draggable={false}
      />
      <img
        src={logoLight}
        alt={alt}
        className={cn("block dark:hidden object-contain", className)}
        draggable={false}
      />
    </>
  );
}
