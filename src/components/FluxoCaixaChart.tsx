import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { TrendingUp, Activity, BarChart3, PieChart as PieIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL, formatBRLCompact, parseDateLocal } from "@/lib/format";
import type { Gasto, Receita } from "@/lib/types";

type ChartKind = "area" | "line" | "bar" | "donut";

const TYPES: { id: ChartKind; label: string; Icon: typeof TrendingUp }[] = [
  { id: "area", label: "Área", Icon: TrendingUp },
  { id: "line", label: "Linha", Icon: Activity },
  { id: "bar", label: "Barra", Icon: BarChart3 },
  { id: "donut", label: "Pizza", Icon: PieIcon },
];

function monthLabel(ano: number, mes: number) {
  const d = new Date(ano, mes - 1, 1);
  return d.toLocaleString("pt-BR", { month: "short" }).replace(".", "");
}

export function FluxoCaixaChart({
  ano,
  mes,
  gastos,
  receitas,
}: {
  ano: number;
  mes: number;
  gastos: Gasto[];
  receitas: Receita[];
}) {
  const [tipo, setTipo] = useState<ChartKind>("area");

  // Last 6 months ending at (ano, mes)
  const data = useMemo(() => {
    const out: { mes: string; entradas: number; gastos: number; saldo: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(ano, mes - 1 - i, 1);
      const m = d.getMonth() + 1;
      const y = d.getFullYear();
      const e = receitas
        .filter((r) => r.mes === m && r.ano === y)
        .reduce((s, r) => s + r.valor, 0);
      const g = gastos
        .filter((g) => {
          const data = parseDateLocal(g.data);
          return !!data && data.getMonth() + 1 === m && data.getFullYear() === y;
        })
        .reduce((s, g) => s + g.valor, 0);
      out.push({ mes: monthLabel(y, m), entradas: e, gastos: g, saldo: e - g });
    }
    return out;
  }, [ano, mes, gastos, receitas]);

  const totalEntradas = data.reduce((s, d) => s + d.entradas, 0);
  const totalGastos = data.reduce((s, d) => s + d.gastos, 0);
  // Mostra o gráfico se houver qualquer movimentação em qualquer mês dos últimos 6.
  const semHistoricoSuficiente = totalEntradas === 0 && totalGastos === 0;

  // Donut data
  const donutData = [
    { name: "Entradas", value: totalEntradas },
    { name: "Gastos", value: totalGastos },
  ];

  const tooltipStyle = {
    background: "var(--card-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    color: "var(--foreground)",
    fontSize: 12,
  };

  return (
    <section className="rounded-3xl border border-border bg-card p-4 shadow-card sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Visão financeira
          </p>
          <h2 className="mt-0.5 text-base font-semibold sm:text-lg">Fluxo de caixa</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Últimos 6 meses · entradas vs. gastos
          </p>
        </div>
        {!semHistoricoSuficiente && (
          <div className="flex items-center gap-1 self-start rounded-full border border-border bg-card-elevated p-1">
            {TYPES.map(({ id, label, Icon }) => {
              const active = tipo === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTipo(id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all card-press",
                    active
                      ? "bg-brand-soft text-brand-on-soft shadow-card"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-pressed={active}
                  title={label}
                >
                  <Icon className="h-3 w-3" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-3 grid min-w-0 grid-cols-3 gap-2 text-[11px]">
        <div className="min-w-0 rounded-xl bg-card-elevated px-2.5 py-2 sm:px-3">
          <p className="text-muted-foreground">Entradas</p>
          <p className="num mt-0.5 truncate font-semibold text-success">
            {formatBRLCompact(totalEntradas)}
          </p>
        </div>
        <div className="min-w-0 rounded-xl bg-card-elevated px-2.5 py-2 sm:px-3">
          <p className="text-muted-foreground">Gastos</p>
          <p className="num mt-0.5 truncate font-semibold text-destructive">
            {formatBRLCompact(totalGastos)}
          </p>
        </div>
        <div className="min-w-0 rounded-xl bg-card-elevated px-2.5 py-2 sm:px-3">
          <p className="text-muted-foreground">Saldo</p>
          <p
            className={cn(
              "num mt-0.5 truncate font-semibold",
              totalEntradas - totalGastos < 0 && "text-destructive",
            )}
          >
            {formatBRLCompact(totalEntradas - totalGastos)}
          </p>
        </div>
      </div>

      {semHistoricoSuficiente ? (
        <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card-elevated/40 px-6 py-6 text-center">
          <TrendingUp className="h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">Ainda não há histórico suficiente</p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            Continue lançando seus gastos e receitas — o gráfico aparece quando você tiver pelo menos dois meses com dados.
          </p>
        </div>
      ) : (
        <div className="mt-4 h-[220px] w-full sm:h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          {tipo === "area" ? (
            <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--success)" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--destructive)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--destructive)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="mes" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => formatBRLCompact(Number(v))} width={48} />
              <RTooltip contentStyle={tooltipStyle} formatter={(v: number) => formatBRL(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="entradas" name="Entradas" stroke="var(--success)" strokeWidth={2} fill="url(#gIn)" />
              <Area type="monotone" dataKey="gastos" name="Gastos" stroke="var(--destructive)" strokeWidth={2} fill="url(#gOut)" />
            </AreaChart>
          ) : tipo === "line" ? (
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="mes" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => formatBRLCompact(Number(v))} width={48} />
              <RTooltip contentStyle={tooltipStyle} formatter={(v: number) => formatBRL(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="entradas" name="Entradas" stroke="var(--success)" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="gastos" name="Gastos" stroke="var(--destructive)" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="saldo" name="Saldo" stroke="var(--brand)" strokeWidth={2} strokeDasharray="4 4" dot={false} />
            </LineChart>
          ) : tipo === "bar" ? (
            <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="mes" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => formatBRLCompact(Number(v))} width={48} />
              <RTooltip contentStyle={tooltipStyle} formatter={(v: number) => formatBRL(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="entradas" name="Entradas" fill="var(--success)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="gastos" name="Gastos" fill="var(--destructive)" radius={[6, 6, 0, 0]} />
            </BarChart>
          ) : (
            <PieChart>
              <RTooltip contentStyle={tooltipStyle} formatter={(v: number, n) => [formatBRL(v), n]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={3} stroke="none">
                <Cell fill="var(--success)" />
                <Cell fill="var(--destructive)" />
              </Pie>
            </PieChart>
          )}
        </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
