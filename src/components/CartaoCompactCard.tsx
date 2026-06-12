import { memo, useMemo } from "react";
import { MoreHorizontal, Pencil, FileUp, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BrandLogo } from "@/components/BrandLogo";
import { getCardTheme } from "@/lib/card-theme";
import { resumoFaturaCartao } from "@/lib/store";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Cartao } from "@/lib/types";
import { usePlan } from "@/lib/use-plan";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Cartão compacto — visual horizontal estilo "wallet card" para uso
 * principalmente no carrossel mobile. Mostra apenas o essencial:
 * logo do banco, nome, limite/usado, barra de progresso e disponível.
 * Sem dados sensíveis (número, validade, CVV).
 */

function formatPctLimite(usado: number, limite: number): string {
  if (!limite || limite <= 0) return "—";
  if (usado <= 0) return "0%";
  const pct = (usado / limite) * 100;
  if (pct >= 100) return "100%";
  if (pct >= 1) return `${Math.round(pct)}%`;
  return "<1%";
}

export const CartaoCompactCard = memo(function CartaoCompactCard({
  cartao,
  resumo,
  onOpen,
  onEdit,
  onImport,
  onDelete,
}: {
  cartao: Cartao;
  resumo?: { usadoMes: number; limite: number; disponivel: number; pct: number };
  onOpen: () => void;
  onEdit: () => void;
  onImport: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("cartoes");
  const { can } = usePlan();
  const canImportFatura = can("importar_fatura");
  const r = resumo ?? resumoFaturaCartao(cartao.id);
  const cor = cartao.cor || "#8b5cf6";
  const theme = useMemo(() => getCardTheme(cor, cartao.banco), [cor, cartao.banco]);
  

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={cartao.nome}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="hover-lift card-press group relative flex cursor-pointer flex-col overflow-hidden rounded-[26px] p-4 text-white shadow-elevated transition-all duration-200 active:scale-[0.99]"
      style={{ background: theme.background, minHeight: 196, maxHeight: 220 }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-white/10 blur-2xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent"
      />

      {/* Top — logo + menu */}
      <div className="relative flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center">
          <BrandLogo name={cartao.banco || cartao.nome} variant="bank" onDark />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={t("card.moreActions")}
              onClick={(e) => e.stopPropagation()}
              className="grid h-8 w-8 place-items-center rounded-full bg-white/15 backdrop-blur transition-colors hover:bg-white/25"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-[160px]"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              {t("card.edit")}
            </DropdownMenuItem>
            {canImportFatura && (
              <DropdownMenuItem onClick={onImport}>
                <FileUp className="mr-2 h-4 w-4" />
                {t("card.import")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t("card.remove")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Bottom — usado em destaque + limite discreto + barra + disponível */}
      <div className="relative mt-auto">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-white/60">
              USADO
            </p>
            <p className="num mt-1 truncate text-2xl font-bold leading-none">
              {formatBRL(r.usadoMes)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-white/60">
              LIMITE
            </p>
            <p className="num mt-1 text-xs font-semibold leading-none text-white/85">
              {formatBRL(r.limite)}
            </p>
          </div>
        </div>

        <div className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full origin-left rounded-full bg-white/95 animate-fill"
            style={{ width: `${Math.max(r.pct, r.usadoMes > 0 ? 1 : 0)}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-white/70">
          <span className="num font-medium tracking-wide">
            {formatPctLimite(r.usadoMes, r.limite)}
          </span>
          <span className="num">
            <span className="text-white/55">DISPONÍVEL </span>
            <span className="font-semibold text-white/90">{formatBRL(r.disponivel)}</span>
          </span>
        </div>
      </div>
    </article>
  );
});


/** Tile "Adicionar cartão" — mesmo formato, fundo neutro, ícone +. */
export function CartaoAddTile({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation("cartoes");
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "card-press group relative flex w-full flex-col items-center justify-center overflow-hidden rounded-[26px]",
        "border-2 border-dashed border-border bg-card text-foreground",
        "transition-all duration-200 hover:bg-card-elevated active:scale-[0.99]",
      )}
      style={{ aspectRatio: "1.72 / 1" }}
    >
      <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand-on-soft">
        <span className="text-2xl font-light leading-none">+</span>
      </span>
      <span className="mt-2 text-sm font-semibold">{t("list.newCard")}</span>
    </button>
  );
}
