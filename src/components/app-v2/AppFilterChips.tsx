import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { MODULE_TONE_VAR, type AppModuleTone } from "./tokens";

export interface AppFilterChip {
  id: string;
  label: string;
  /** Ícone opcional renderizado antes do label. */
  icon?: React.ReactNode;
  /** Contagem opcional exibida em badge. */
  count?: number;
}

export interface AppFilterChipsProps {
  items: AppFilterChip[];
  selected?: string | null;
  onSelect?: (id: string) => void;
  tone?: AppModuleTone;
  /** Rótulo para leitores de tela. */
  ariaLabel?: string;
  className?: string;
}

/**
 * Lista horizontal de chips de filtro com scroll-snap e foco visível.
 * Min-h 44px para toque mobile; usa cor do módulo no chip selecionado.
 */
export function AppFilterChips({
  items,
  selected,
  onSelect,
  tone = "neutral",
  ariaLabel,
  className,
}: AppFilterChipsProps) {
  const { t } = useTranslation("common");
  const color = MODULE_TONE_VAR[tone];

  return (
    <div
      className={cn(
        "no-scrollbar -mx-3 flex snap-x snap-mandatory gap-2 overflow-x-auto px-3 pb-1 sm:-mx-0 sm:px-0",
        className,
      )}
      role="listbox"
      aria-label={ariaLabel ?? t("appV2.filters.aria")}
    >
      {items.map((item) => {
        const isSelected = selected === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelect?.(item.id)}
            className={cn(
              "flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              isSelected
                ? "border-transparent text-primary-foreground shadow-elevated"
                : "border-border/60 bg-card text-foreground hover:bg-card-elevated",
            )}
            style={
              isSelected ? { backgroundColor: color, color: "oklch(0.18 0.005 260)" } : undefined
            }
          >
            {item.icon && (
              <span className="shrink-0" aria-hidden="true">
                {item.icon}
              </span>
            )}
            <span className="whitespace-nowrap">{item.label}</span>
            {typeof item.count === "number" && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                  isSelected
                    ? "bg-foreground/10 text-foreground"
                    : "bg-card-elevated text-muted-foreground",
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
