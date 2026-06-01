import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export interface MercadoShowcaseProps {
  children: ReactNode;
  className?: string;
  /** Tamanho mínimo de cada card (CSS, ex.: "160px"). */
  itemMinWidth?: string;
  emptyState?: ReactNode;
  isEmpty?: boolean;
}

/**
 * Vitrine horizontal com scroll-snap (mobile-first), bordas escondidas,
 * cards de largura fixa. Render puro — sem fetch.
 */
export function MercadoShowcase({
  children,
  className,
  itemMinWidth = "180px",
  emptyState,
  isEmpty = false,
}: MercadoShowcaseProps) {
  const { t } = useTranslation("mercado");

  if (isEmpty) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 bg-card-elevated/40 p-6 text-center text-sm text-muted-foreground">
        {emptyState ?? t("shell.showcase.empty")}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "no-scrollbar -mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-2 sm:-mx-0 sm:px-0",
        className,
      )}
      role="region"
      aria-label={t("shell.showcase.scrollAria")}
      style={{ scrollPaddingInline: "0.75rem" }}
    >
      {Array.isArray(children) ? (
        children.map((child, i) => (
          <div
            key={i}
            className="shrink-0 snap-start"
            style={{ width: itemMinWidth }}
          >
            {child}
          </div>
        ))
      ) : (
        <div className="shrink-0 snap-start" style={{ width: itemMinWidth }}>
          {children}
        </div>
      )}
    </div>
  );
}
