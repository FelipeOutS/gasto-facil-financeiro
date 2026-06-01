import { type ReactNode } from "react";
import { Search, Store, ChevronDown, Check, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface MercadoHeaderMarketOption {
  id: string;
  name: string;
  favorito?: boolean;
}

export interface MercadoHeaderProps {
  /** Nome do usuário (saudação opcional). */
  userName?: string | null;
  /** Mercado atualmente selecionado (texto curto). */
  selectedMarket?: string | null;
  /**
   * Lista de mercados salvos. Quando informada (>= 1), o botão vira um
   * DropdownMenu para troca rápida de mercado ativo.
   */
  marketOptions?: MercadoHeaderMarketOption[];
  /** Disparado ao escolher um mercado da lista. */
  onSelectMarketId?: (id: string) => void;
  /**
   * Callback opcional para o botão quando NÃO há lista (rotas legadas).
   * Quando `marketOptions` é passado, este callback é ignorado.
   */
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
 * Quando `marketOptions` é informado, vira dropdown acessível com
 * trocar mercado + atalho para `/mercado/meus-mercados`.
 */
export function MercadoHeader({
  userName,
  selectedMarket,
  marketOptions,
  onSelectMarketId,
  onSelectMarket,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  rightSlot,
  className,
}: MercadoHeaderProps) {
  const { t } = useTranslation("mercado");
  const useMenu = Array.isArray(marketOptions);

  const triggerClass =
    "mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-left text-sm font-medium text-foreground transition active:scale-[0.98] hover:bg-card-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40";

  const buttonInner = (
    <>
      <Store className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
      <span className="truncate">
        {selectedMarket ?? t("shell.marketNone")}
      </span>
      <ChevronDown
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </>
  );

  return (
    <header className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {userName ? (
            <p className="text-xs text-muted-foreground md:text-sm">
              {t("shell.greeting")},{" "}
              <span className="font-medium text-foreground">{userName}</span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground md:text-sm">
              {t("shell.greetingShort")}
            </p>
          )}

          {useMenu ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={triggerClass}
                aria-label={t("shell.marketLabel")}
              >
                {buttonInner}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[240px]">
                {marketOptions!.length > 0 && (
                  <>
                    <DropdownMenuLabel>
                      {t("shell.marketLabel")}
                    </DropdownMenuLabel>
                    {marketOptions!.map((m) => {
                      const isActive =
                        (m.favorito && !marketOptions!.some((x) => x.favorito && x.id !== m.id)) ||
                        m.name === selectedMarket;
                      return (
                        <DropdownMenuItem
                          key={m.id}
                          onSelect={() => onSelectMarketId?.(m.id)}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Store className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span className="truncate">{m.name}</span>
                          </span>
                          {isActive && (
                            <Check className="h-4 w-4 text-brand" aria-hidden="true" />
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem asChild>
                  <Link
                    to="/mercado/meus-mercados"
                    preload="intent"
                    className="flex items-center gap-2"
                  >
                    <Settings2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <span>
                      {marketOptions!.length > 0
                        ? t("shell.marketManage", { defaultValue: "Gerenciar mercados" })
                        : t("shell.marketAdd", { defaultValue: "Adicionar mercado" })}
                    </span>
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <button
              type="button"
              onClick={onSelectMarket}
              className={triggerClass}
              aria-label={t("shell.marketLabel")}
            >
              {buttonInner}
            </button>
          )}
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
