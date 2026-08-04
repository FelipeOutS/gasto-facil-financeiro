import { Pencil, Trash2 } from "lucide-react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import type { LinhaOrcamento } from "@/lib/orcamento";

interface OrcamentoCategoriaCardProps {
  linha: LinhaOrcamento;
  labels: {
    planned: string;
    spent: string;
    remaining: string;
    excess: string;
    used: string;
    ok: string;
    attention: string;
    outOfPlan: string;
    edit: string;
    remove: string;
    removeAria: string;
  };
  onEdit: (catId: string, nome: string) => void;
  onRemove: (catId: string, nome: string) => void;
}

export function OrcamentoCategoriaCard({
  linha,
  labels,
  onEdit,
  onRemove,
}: OrcamentoCategoriaCardProps) {
  const { cat, planejado, realizado, restante, pct, status } = linha;
  const pctVis = Math.min(100, pct);
  const estourado = status === "estouro";
  const atencao = status === "atencao";

  const barraCor = estourado ? "bg-destructive" : atencao ? "bg-warning" : "bg-brand";

  const statusTone = estourado ? "destructive" : atencao ? "warning" : "success";

  const statusLabel = estourado ? labels.outOfPlan : atencao ? labels.attention : labels.ok;

  return (
    <li className="hover-lift rounded-2xl border border-border bg-card p-4 shadow-card transition-colors hover:border-brand/40 hover:bg-card-elevated">
      {/* Header: ícone + nome + status */}
      <div className="flex items-center gap-3">
        <CategoryIcon categoria={cat} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{cat.nome}</p>
        </div>
        <StatusBadge tone={statusTone} dot size="sm" className="shrink-0">
          {statusLabel}
        </StatusBadge>
      </div>

      {/* Mini métricas */}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-xl bg-card-elevated px-2 py-2 text-center">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {labels.planned}
          </p>
          <p className="num mt-0.5 text-sm font-semibold">{formatBRL(planejado)}</p>
        </div>
        <div className="rounded-xl bg-card-elevated px-2 py-2 text-center">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {labels.spent}
          </p>
          <p
            className={cn(
              "num mt-0.5 text-sm font-semibold",
              estourado && "text-destructive",
              atencao && "text-warning",
            )}
          >
            {formatBRL(realizado)}
          </p>
        </div>
        <div className="rounded-xl bg-card-elevated px-2 py-2 text-center">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {estourado ? labels.excess : labels.remaining}
          </p>
          <p
            className={cn(
              "num mt-0.5 text-sm font-semibold",
              estourado && "text-destructive",
              !estourado && atencao && "text-warning",
              !estourado && !atencao && "text-brand",
            )}
          >
            {formatBRL(Math.abs(restante))}
          </p>
        </div>
      </div>

      {/* Barra de progresso */}
      <div className="mt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-card-elevated">
            <div
              className={cn("h-full rounded-full transition-all animate-fill", barraCor)}
              style={{ width: `${pctVis}%` }}
            />
          </div>
          <span
            className={cn(
              "shrink-0 text-[11px] font-medium num",
              estourado && "text-destructive",
              atencao && "text-warning",
              !estourado && !atencao && "text-brand",
            )}
          >
            {Math.round(pct)}%
          </span>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {labels.used} ·{" "}
          {estourado
            ? `${labels.excess.toLowerCase()} ${formatBRL(Math.abs(restante))}`
            : `${labels.remaining.toLowerCase()} ${formatBRL(restante)}`}
        </p>
      </div>

      {/* Ações */}
      <div className="mt-3 flex items-center justify-end gap-3 border-t border-border pt-2.5">
        <button
          type="button"
          onClick={() => onEdit(cat.id, cat.nome)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-brand transition-colors"
        >
          <Pencil className="h-3 w-3" />
          {labels.edit}
        </button>
        <button
          type="button"
          onClick={() => onRemove(cat.id, cat.nome)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-destructive transition-colors"
          aria-label={labels.removeAria.replace("{{name}}", cat.nome)}
        >
          <Trash2 className="h-3 w-3" />
          {labels.remove}
        </button>
      </div>
    </li>
  );
}
