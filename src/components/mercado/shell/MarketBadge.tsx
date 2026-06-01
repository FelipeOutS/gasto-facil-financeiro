import { Store } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export interface MarketBadgeProps {
  name: string;
  logoUrl?: string | null;
  /** Tamanho do badge. */
  size?: "sm" | "md";
  className?: string;
}

/**
 * Pílula compacta com logo (quando houver) + nome do mercado.
 * Puramente apresentacional.
 */
export function MarketBadge({ name, logoUrl, size = "sm", className }: MarketBadgeProps) {
  const { t } = useTranslation("mercado");
  const isMd = size === "md";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card-elevated text-foreground",
        isMd ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-[11px]",
        className,
      )}
      aria-label={t("shell.market.badgeAria", { name })}
    >
      <span
        className={cn(
          "grid shrink-0 place-items-center overflow-hidden rounded-full bg-muted",
          isMd ? "h-5 w-5" : "h-4 w-4",
        )}
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={t("shell.market.logoAlt", { name })}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <Store className={cn("text-muted-foreground", isMd ? "h-3 w-3" : "h-2.5 w-2.5")} aria-hidden="true" />
        )}
      </span>
      <span className="max-w-[140px] truncate font-medium">{name}</span>
    </span>
  );
}
