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
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { formatBRL, formatBRLCompact, parseDateLocal } from "@/lib/format";
import type { Gasto, Receita } from "@/lib/types";

type ChartKind = "area" | "line" | "bar" | "donut";

function monthLabel(ano: number, mes: number, locale: string) {
  const d = new Date(ano, mes - 1, 1);
  const loc = locale.startsWith("en") ? "en-US" : "pt-BR";
  return d.toLocaleString(loc, { month: "short" }).replace(".", "");
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
  const { t, i18n } = useTranslation("dashboard");
  const [tipo, setTipo] = useState<ChartKind>("area");
  const locale = i18n.resolvedLanguage || i18n.language || "pt";

  const labelEntradas = t("fluxo.entradas");
  const labelGastos = t("fluxo.gastos");
  const labelSaldo = t("fluxo.saldo");

  const TYPES: { id: ChartKind; label: string; Icon: typeof TrendingUp }[] = [
    { id: "area", label: t("fluxo.types.area"), Icon: TrendingUp },
    { id: "line", label: t("fluxo.types.line"), Icon: Activity },
    { id: "bar", label: t("fluxo.types.bar"), Icon: BarChart3 },
    { id: "donut", label: t("fluxo.types.donut"), Icon: PieIcon },
  ];

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
      out.push({ mes: monthLabel(y, m, locale), entradas: e, gastos: g, saldo: e - g });
    }
    return out;
  }, [ano, mes, gastos, receitas, locale]);

  const totalEntradas = data.reduce((s, d) => s + d.entradas, 0);
  const totalGastos = data.reduce((s, d) => s + d.gastos, 0);
  // Mostra o gráfico se houver qualquer movimentação em qualquer mês dos últimos 6.
  const semHistoricoSuficiente = totalEntradas === 0 && totalGastos === 0;

  // Donut data
  const donutData = [
    { name: t("fluxo.entradas"), value: totalEntradas },
    { name: t("fluxo.gastos"), value: totalGastos },
  ];

  const tooltipStyle = {
    background: "var(--card-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    color: "var(--foreground)",
    fontSize: 12,
  };

  return (
    <section className="flex h-full w-full flex-col rounded-3xl border border-border bg-card p-4 shadow-card sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("fluxo.eyebrow")}
          </p>
          <h2 className="mt-0.5 text-base font-semibold sm:text-lg">{t("fluxo.title")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("fluxo.subtitle")}
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

      <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
        <div className="min-w-0 rounded-xl bg-card-elevated px-2.5 py-2 sm:px-3">
          <p className="text-muted-foreground">{t("fluxo.entradas")}</p>
          <p className="num mt-0.5 truncate font-semibold text-success">
            {formatBRLCompact(totalEntradas)}
          </p>
        </div>
        <div className="min-w-0 rounded-xl bg-card-elevated px-2.5 py-2 sm:px-3">
          <p className="text-muted-foreground">{t("fluxo.gastos")}</p>
          <p className="num mt-0.5 truncate font-semibold text-destructive">
            {formatBRLCompact(totalGastos)}
          </p>
        </div>
        <div className="min-w-0 rounded-xl bg-card-elevated px-2.5 py-2 sm:px-3">
          <p className="text-muted-foreground">{t("fluxo.saldo")}</p>
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
          <p className="mt-2 text-sm font-medium">{t("fluxo.emptyTitle")}</p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            {t("fluxo.emptyDesc")}
          </p>
        </div>
      ) : (
        <div className="mt-4 h-[220px] w-full sm:h-[260px] lg:h-[300px] xl:h-[340px]">
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
              <YAxis stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => formatBRLCompact(Number(v))} width={64} />
              <RTooltip contentStyle={tooltipStyle} formatter={(v: number) => formatBRL(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="entradas" name="Entradas" stroke="var(--success)" strokeWidth={2} fill="url(#gIn)" />
              <Area type="monotone" dataKey="gastos" name="Gastos" stroke="var(--destructive)" strokeWidth={2} fill="url(#gOut)" />
            </AreaChart>
          ) : tipo === "line" ? (
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="mes" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => formatBRLCompact(Number(v))} width={64} />
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
              <YAxis stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => formatBRLCompact(Number(v))} width={64} />
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
