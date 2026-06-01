import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type MercadoCategoryKey =
  | "hortifruti"
  | "acougue"
  | "padaria"
  | "bebidas"
  | "laticinios"
  | "limpeza"
  | "mercearia"
  | "utilidades";

const CATEGORY_ORDER: MercadoCategoryKey[] = [
  "hortifruti",
  "acougue",
  "padaria",
  "bebidas",
  "laticinios",
  "limpeza",
  "mercearia",
  "utilidades",
];

/**
 * Mapeamento categoria → token visual (definido em src/styles.css).
 * Usar via inline style para evitar JIT miss em classes dinâmicas.
 */
const CATEGORY_TOKEN: Record<MercadoCategoryKey, string> = {
  hortifruti: "var(--color-mercado-fresh)",
  acougue: "var(--color-mercado-meat)",
  padaria: "var(--color-mercado-bakery)",
  bebidas: "var(--color-mercado-drinks)",
  laticinios: "var(--color-mercado-dairy)",
  limpeza: "var(--color-mercado-cleaning)",
  mercearia: "var(--color-mercado-pantry)",
  utilidades: "var(--color-mercado-household)",
};

export interface MercadoCategoryChipsProps {
  selected?: MercadoCategoryKey | null;
  onSelect?: (key: MercadoCategoryKey) => void;
  /** Renderizar uma imagem/ilustração opcional dentro do chip. */
  iconFor?: (key: MercadoCategoryKey) => string | undefined;
  className?: string;
}

export function MercadoCategoryChips({
  selected,
  onSelect,
  iconFor,
  className,
}: MercadoCategoryChipsProps) {
  const { t } = useTranslation("mercado");

  return (
    <div
      className={cn(
        "no-scrollbar -mx-3 flex snap-x snap-mandatory gap-2 overflow-x-auto px-3 pb-1 sm:-mx-0 sm:px-0",
        className,
      )}
      role="listbox"
      aria-label={t("shell.categories.title")}
    >
      {CATEGORY_ORDER.map((key) => {
        const isSelected = selected === key;
        const color = CATEGORY_TOKEN[key];
        const icon = iconFor?.(key);
        return (
          <button
            key={key}
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelect?.(key)}
            className={cn(
              "group flex shrink-0 snap-start items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition active:scale-[0.97]",
              isSelected
                ? "border-transparent text-primary-foreground shadow-elevated"
                : "border-border/60 bg-card text-foreground hover:bg-card-elevated",
            )}
            style={
              isSelected
                ? { backgroundColor: color, color: "oklch(0.18 0.005 260)" }
                : undefined
            }
          >
            <span
              className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full"
              style={{ backgroundColor: `color-mix(in oklab, ${color} 22%, transparent)` }}
              aria-hidden="true"
            >
              {icon ? (
                <img
                  src={icon}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span
                  className="block h-2 w-2 rounded-full"
                  style={{ backgroundColor: color }}
                />
              )}
            </span>
            <span className="whitespace-nowrap">{t(`shell.categories.${key}`)}</span>
          </button>
        );
      })}
    </div>
  );
}

export const MERCADO_CATEGORIES = CATEGORY_ORDER;
