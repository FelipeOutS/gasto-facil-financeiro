import { Lightbulb } from "lucide-react";
import { Money } from "@/components/Money";

export type SugestaoLabels = {
  title: string;
  description: string;
  essentials: string;
  variables: string;
  reserve: string;
  cta: string;
  note: string;
};

type Props = {
  renda: number;
  labels: SugestaoLabels;
  onCta: () => void;
};

export function SugestaoDistribuicaoRenda({ renda, labels, onCta }: Props) {
  if (renda <= 0) return null;

  const essenciais = Math.round(renda * 0.5 * 100) / 100;
  const variaveis = Math.round(renda * 0.3 * 100) / 100;
  const reserva = Math.round(renda * 0.2 * 100) / 100;

  const items: Array<{ label: string; value: number; dot: string }> = [
    { label: labels.essentials, value: essenciais, dot: "bg-brand" },
    { label: labels.variables, value: variaveis, dot: "bg-warning" },
    { label: labels.reserve, value: reserva, dot: "bg-success" },
  ];

  return (
    <div className="mt-4 rounded-xl border border-dashed border-border bg-card-elevated p-3">
      <div className="flex items-start gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
          <Lightbulb className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">{labels.title}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{labels.description}</p>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5">
        {items.map((it) => (
          <li key={it.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="inline-flex min-w-0 items-center gap-2">
              <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${it.dot}`} />
              <span className="truncate">{it.label}</span>
            </span>
            <span className="num shrink-0 font-semibold">
              <Money value={it.value} />
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[11px] text-muted-foreground">{labels.note}</p>

      <button
        type="button"
        onClick={onCta}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-card-elevated"
      >
        {labels.cta}
      </button>
    </div>
  );
}
