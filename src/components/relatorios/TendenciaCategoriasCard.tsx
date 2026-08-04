import { TrendingUp, TrendingDown, Minus, Sparkles } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, Tooltip as RTooltip } from "recharts";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TendenciaEstado = "subindo" | "caindo" | "estavel" | "nova";

export type TendenciaCategoria = {
  catId: string;
  nome: string;
  serie: Array<{ label: string; valor: number }>;
  mediaRecente: number;
  mediaAnterior: number;
  diferenca: number;
  variacaoPct: number | null; // null quando mediaAnterior === 0
  estado: TendenciaEstado;
};

export type TendenciaCategoriasLabels = {
  title: string;
  description: string;
  rising: string;
  falling: string;
  stable: string;
  newTrend: string;
  recentAverage: string;
  change: string;
  empty: string;
};

type Props = {
  categorias: TendenciaCategoria[];
  labels: TendenciaCategoriasLabels;
};

function badgeFor(estado: TendenciaEstado, labels: TendenciaCategoriasLabels) {
  switch (estado) {
    case "subindo":
      return {
        text: labels.rising,
        icon: <TrendingUp className="h-3 w-3" />,
        cls: "bg-warning/15 text-warning ring-1 ring-warning/30",
        stroke: "var(--warning)",
      };
    case "caindo":
      return {
        text: labels.falling,
        icon: <TrendingDown className="h-3 w-3" />,
        cls: "bg-success/15 text-success ring-1 ring-success/30",
        stroke: "var(--success)",
      };
    case "nova":
      return {
        text: labels.newTrend,
        icon: <Sparkles className="h-3 w-3" />,
        cls: "bg-brand-soft text-brand ring-1 ring-brand/30",
        stroke: "var(--brand, var(--primary))",
      };
    default:
      return {
        text: labels.stable,
        icon: <Minus className="h-3 w-3" />,
        cls: "bg-muted text-muted-foreground ring-1 ring-border",
        stroke: "var(--muted-foreground)",
      };
  }
}

export function TendenciaCategoriasCard({ categorias, labels }: Props) {
  if (categorias.length === 0) return null;

  return (
    <section className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-card sm:p-5 animate-rise">
      <header className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
          <TrendingUp className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{labels.title}</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{labels.description}</p>
        </div>
      </header>

      <ul className="mt-3 space-y-2">
        {categorias.map((c) => {
          const b = badgeFor(c.estado, labels);
          const sinal = c.diferenca > 0 ? "+" : c.diferenca < 0 ? "−" : "";
          const pctTxt =
            c.variacaoPct == null
              ? ""
              : `${c.variacaoPct > 0 ? "+" : ""}${Math.round(c.variacaoPct)}%`;
          return (
            <li key={c.catId} className="rounded-xl bg-card-elevated p-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.nome}</p>
                  <p className="num text-[11px] text-muted-foreground">
                    {labels.recentAverage}: {formatBRL(c.mediaRecente)}
                  </p>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    b.cls,
                  )}
                >
                  {b.icon}
                  {b.text}
                </span>
              </div>

              <div className="mt-2 flex items-end gap-3">
                <div className="h-10 flex-1 min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={c.serie}>
                      <RTooltip
                        cursor={false}
                        contentStyle={{
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          fontSize: 11,
                          padding: "4px 8px",
                        }}
                        formatter={(v: number) => formatBRL(v)}
                        labelFormatter={(l: string) => l}
                      />
                      <Line
                        type="monotone"
                        dataKey="valor"
                        stroke={b.stroke}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {c.estado !== "estavel" && c.estado !== "nova" && (
                  <div className="text-right">
                    <p
                      className={cn(
                        "num text-[11px] font-semibold",
                        c.diferenca > 0 ? "text-warning" : "text-success",
                      )}
                    >
                      {sinal}
                      {formatBRL(Math.abs(c.diferenca))}
                    </p>
                    {pctTxt && <p className="text-[10px] text-muted-foreground">{pctTxt}</p>}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
