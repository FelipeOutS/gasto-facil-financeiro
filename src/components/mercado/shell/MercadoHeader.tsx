import { type ReactNode } from "react";
import { Search, Store, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export interface MercadoHeaderProps {
  /** Nome do usuário (saudação opcional). */
  userName?: string | null;
  /** Mercado atualmente selecionado (texto curto). */
  selectedMarket?: string | null;
  /** Callback quando o usuário toca no seletor de mercado. */
  onSelectMarket?: () => void;
  /** Valor controlado do campo de busca. */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  /** Submit (Enter) — opcional. */
  onSearchSubmit?: (value: string) => void;
  /** Slot direito (ex.: botão extra). */
  rightSlot?: ReactNode;
  className?: string;
}

/**
 * Header visual do módulo Mercado Inteligente.
 * Puramente apresentacional — não persiste nada, não chama API.
 */
export function MercadoHeader({
  userName,
  selectedMarket,
  onSelectMarket,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  rightSlot,
  className,
}: MercadoHeaderProps) {
  const { t } = useTranslation("mercado");

  return (
    <header className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {userName ? (
            <p className="text-xs text-muted-foreground md:text-sm">
              {t("shell.greeting")}, <span className="font-medium text-foreground">{userName}</span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground md:text-sm">
              {t("shell.greetingShort")}
            </p>
          )}
          <button
            type="button"
            onClick={onSelectMarket}
            className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-left text-sm font-medium text-foreground transition active:scale-[0.98] hover:bg-card-elevated"
            aria-label={t("shell.marketLabel")}
          >
            <Store className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
            <span className="truncate">
              {selectedMarket ?? t("shell.marketNone")}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </div>
        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </div>

      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          onSearchSubmit?.(searchValue ?? "");
        }}
        className="relative"
      >
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          value={searchValue ?? ""}
          onChange={(e) => onSearchChange?.(e.target.value)}
          placeholder={t("shell.searchPlaceholder")}
          aria-label={t("shell.searchAria")}
          className="h-12 w-full rounded-2xl border border-border/60 bg-card pl-10 pr-4 text-sm text-foreground shadow-card outline-none transition placeholder:text-muted-foreground focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30 md:text-[15px]"
        />
      </form>
    </header>
  );
}
