import { useMercadosLocais } from "@/lib/mercado/mercados-store";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  emptyHint: string;
  selected?: string;
  onSelect: (nome: string) => void;
  className?: string;
};

export function SavedMarketsChips({ label, emptyHint, selected, onSelect, className }: Props) {
  const mercados = useMercadosLocais();

  if (mercados.length === 0) {
    return <p className={cn("mt-2 text-[11px] text-muted-foreground", className)}>{emptyHint}</p>;
  }

  const selectedNorm = (selected || "").trim().toLowerCase();

  return (
    <div className={cn("mt-2", className)}>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {mercados.map((m) => {
          const isActive = selectedNorm && selectedNorm === m.nome.trim().toLowerCase();
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelect(m.nome)}
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors active:scale-[0.98]",
                isActive
                  ? "border-brand/40 bg-brand-soft text-brand"
                  : "border-border/60 bg-card-elevated text-foreground hover:bg-card",
              )}
            >
              {m.favorito && <Star className="h-3 w-3 shrink-0 fill-current" />}
              <span className="truncate">{m.nome}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
