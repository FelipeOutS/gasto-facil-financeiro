import { PieChart as PieChartIcon, Trophy, AlertTriangle } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { formatBRL, formatBRLCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

export type EvolucaoMes = {
  label: string;
  mes: number;
  ano: number;
  planejado: number;
  realizado: number;
};

export type EvolucaoOrcamentoLabels = {
  title: string;
  description: string;
  planned: string;
  realized: string;
  adherence: string;
  averageAdherence: string;
  bestMonth: string;
  biggestOverrun: string;
  empty: string;
  overBudget: string;
  underBudget: string;
};

type Props = {
  meses: EvolucaoMes[];
  labels: EvolucaoOrcamentoLabels;
};

export function EvolucaoOrcamentoCard({ meses, labels }: Props) {
  const comOrcamento = meses.filter((m) => m.planejado > 0);

  // Não renderiza se houver menos de 2 meses com algum orçamento
  if (comOrcamento.length < 2) return null;

  // Aderência média (média das aderências individuais, capada para evitar outliers exagerados)
  const aderenciaMedia =
    comOrcamento.reduce((acc, m) => acc + Math.min(300, (m.realizado / m.planejado) * 100), 0) /
    comOrcamento.length;

  // Melhor mês: aderência mais próxima de 100% sem estourar (realizado <= planejado)
  const dentros = comOrcamento.filter((m) => m.realizado <= m.planejado);
  const melhorMes = dentros.length
    ? dentros.reduce((best, m) => {
        const bestPct = best.realizado / best.planejado;
        const mPct = m.realizado / m.planejado;
        return mPct > bestPct ? m : best;
      })
    : null;

  // Maior estouro: maior diferença positiva realizado - planejado
  const estouros = comOrcamento
    .map((m) => ({ ...m, excesso: m.realizado - m.planejado }))
    .filter((m) => m.excesso > 0);
  const maiorEstouro = estouros.length
    ? estouros.reduce((w, m) => (m.excesso > w.excesso ? m : w))
    : null;

  const aderenciaTone =
    aderenciaMedia <= 100
      ? "text-success"
      : aderenciaMedia <= 110
        ? "text-warning"
        : "text-destructive";

  return (
    <section className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-card sm:p-5 animate-rise">
      <header className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
          <PieChartIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{labels.title}</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{labels.description}</p>
        </div>
      </header>

      <div className="mt-4 h-56 w-full sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={meses} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              tickFormatter={(v) => formatBRLCompact(v)}
            />
            <RTooltip
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 12,
              }}
              formatter={(v: number) => formatBRL(v)}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar
              dataKey="planejado"
              name={labels.planned}
              fill="var(--brand, var(--primary))"
              radius={[6, 6, 0, 0]}
            />
            <Bar
              dataKey="realizado"
              name={labels.realized}
              fill="var(--warning)"
              radius={[6, 6, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <div className="rounded-xl bg-card-elevated p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {labels.averageAdherence}
          </p>
          <p className={cn("num mt-0.5 text-lg font-bold", aderenciaTone)}>
            {Math.round(aderenciaMedia)}%
          </p>
          <p className="text-[11px] text-muted-foreground">
            {aderenciaMedia > 100 ? labels.overBudget : labels.underBudget}
          </p>
        </div>

        {melhorMes && (
          <div className="rounded-xl bg-card-elevated p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <Trophy className="mr-1 inline h-3 w-3 text-success" />
              {labels.bestMonth}
            </p>
            <p className="mt-0.5 text-sm font-bold capitalize">{melhorMes.label}</p>
            <p className="num text-[11px] text-muted-foreground">
              {formatBRL(melhorMes.realizado)} / {formatBRL(melhorMes.planejado)}
            </p>
          </div>
        )}

        {maiorEstouro && (
          <div className="rounded-xl bg-card-elevated p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <AlertTriangle className="mr-1 inline h-3 w-3 text-destructive" />
              {labels.biggestOverrun}
            </p>
            <p className="mt-0.5 text-sm font-bold capitalize">{maiorEstouro.label}</p>
            <p className="num text-[11px] text-destructive">+{formatBRL(maiorEstouro.excesso)}</p>
          </div>
        )}
      </div>
    </section>
  );
}
