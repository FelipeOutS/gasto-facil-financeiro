import { memo, useMemo } from "react";
import { MoreHorizontal, Pencil, FileUp, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BrandLogo } from "@/components/BrandLogo";
import { getCardTheme } from "@/lib/card-theme";
import { resumoFaturaCartao } from "@/lib/store";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Cartao } from "@/lib/types";
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
function formatBanco(banco?: string): string {
  if (!banco) return "";
  const s = banco.trim();
  if (/mercado\s*pago|^mp$/i.test(s)) return "Mercado Pago";
  return s;
}

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
  const r = resumo ?? resumoFaturaCartao(cartao.id);
  const cor = cartao.cor || "#8b5cf6";
  const theme = useMemo(() => getCardTheme(cor, cartao.banco), [cor, cartao.banco]);
  const bancoLabel = formatBanco(cartao.banco);

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="hover-lift card-press group relative cursor-pointer overflow-hidden rounded-[26px] p-4 text-white shadow-elevated transition-all duration-200 active:scale-[0.99]"
      style={{ background: theme.background, aspectRatio: "1.72 / 1" }}
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
          <BrandLogo name={cartao.banco} variant="bank" onDark />
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
            <DropdownMenuItem onClick={onImport}>
              <FileUp className="mr-2 h-4 w-4" />
              {t("card.import")}
            </DropdownMenuItem>
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

      {/* Nome */}
      <div className="relative mt-2">
        <h3 className="truncate text-base font-bold leading-tight">
          {cartao.nome}
        </h3>
        {bancoLabel && (
          <p className="mt-0.5 truncate text-[10px] font-medium text-white/70">
            {bancoLabel}
          </p>
        )}
      </div>

      {/* Bottom — usado / limite + progress */}
      <div className="relative mt-auto pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-widest text-white/65">
              {t("card.usedMonth")}
            </p>
            <p className="num mt-0.5 truncate text-lg font-bold leading-none">
              {formatBRL(r.usadoMes)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] uppercase tracking-widest text-white/65">
              {t("card.limitTotal")}
            </p>
            <p className="num mt-0.5 text-xs font-semibold leading-none text-white/90">
              {formatBRL(r.limite)}
            </p>
          </div>
        </div>

        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full origin-left rounded-full bg-white/95 shadow-[0_0_8px_rgba(255,255,255,0.35)] animate-fill"
            style={{ width: `${Math.max(r.pct, r.usadoMes > 0 ? 1 : 0)}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] text-white/75">
          <span className="num">{formatPctLimite(r.usadoMes, r.limite)}</span>
          <span className="num">{t("card.availableValue", { value: formatBRL(r.disponivel) })}</span>
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
