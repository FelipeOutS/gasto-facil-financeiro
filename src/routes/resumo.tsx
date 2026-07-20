import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronLeft, ChevronRight, Trophy, TrendingDown, TrendingUp } from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
} from "recharts";
import { MobileShell } from "@/components/MobileShell";
import { PageSkeleton } from "@/components/PageSkeleton";
import { CategoryIcon, categoryColor } from "@/components/CategoryIcon";
import { getCategoriaById, getGastos, useBootstrap, useStore } from "@/lib/store";
import { formatBRL, formatBRLCompact, formatMonthYear } from "@/lib/format";
import i18n from "@/i18n";

export const Route = createFileRoute("/resumo")({
  head: () => ({ meta: [{ title: i18n.getFixedT(i18n.language, "misc")("resumo.metaTitle") }] }),
  component: ResumoPage,
});

function ResumoPage() {
  const { t } = useTranslation("misc");
  const ready = useBootstrap();
  const today = new Date();
  const [ym, setYm] = useState({ ano: today.getFullYear(), mes: today.getMonth() + 1 });
  const gastos = useStore(() => getGastos());

  const doMes = useMemo(
    () => gastos.filter((g) => g.mes === ym.mes && g.ano === ym.ano),
    [gastos, ym],
  );
  const prevYm = useMemo(() => {
    const d = new Date(ym.ano, ym.mes - 2, 1);
    return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
  }, [ym]);
  const doMesAnterior = useMemo(
    () => gastos.filter((g) => g.mes === prevYm.mes && g.ano === prevYm.ano),
    [gastos, prevYm],
  );

  const total = doMes.reduce((s, g) => s + g.valor, 0);
  const totalAnt = doMesAnterior.reduce((s, g) => s + g.valor, 0);
  const diff = total - totalAnt;
  const diffPct = totalAnt > 0 ? (diff / totalAnt) * 100 : 0;

  const porCategoria = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of doMes) map.set(g.categoriaId, (map.get(g.categoriaId) ?? 0) + g.valor);
    return [...map.entries()]
      .map(([id, v]) => {
        const cat = getCategoriaById(id);
        return {
          id,
          nome: cat?.nome ?? "Outros",
          valor: v,
          color: categoryColor(cat),
          pct: total > 0 ? (v / total) * 100 : 0,
          cat,
        };
      })
      .sort((a, b) => b.valor - a.valor);
  }, [doMes, total]);

  const maioresGastos = useMemo(
    () => [...doMes].sort((a, b) => b.valor - a.valor).slice(0, 5),
    [doMes],
  );

  function changeMonth(delta: number) {
    const d = new Date(ym.ano, ym.mes - 1 + delta, 1);
    setYm({ ano: d.getFullYear(), mes: d.getMonth() + 1 });
  }

  if (!ready) return <PageSkeleton />;

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/app"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          aria-label={t("resumo.back")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">{t("resumo.kicker")}</p>
          <h1 className="text-2xl font-bold tracking-tight capitalize">
            {formatMonthYear(ym.ano, ym.mes)}
          </h1>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
          <button onClick={() => changeMonth(-1)} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={t("resumo.prevMonth")}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={() => changeMonth(1)} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={t("resumo.nextMonth")}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Pie chart */}
      <section className="mt-4 rounded-3xl border border-border bg-card p-5 shadow-elevated">
        {porCategoria.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground animate-fade-in">
            {t("resumo.empty")}
          </p>
        ) : (
          <>
            <div className="relative mx-auto h-[220px] w-[220px]">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={porCategoria}
                    dataKey="valor"
                    nameKey="nome"
                    innerRadius={65}
                    outerRadius={105}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {porCategoria.map((d) => (
                      <Cell key={d.id} fill={d.color} />
                    ))}
                  </Pie>
                  <RTooltip
                    contentStyle={{
                      background: "var(--card-elevated)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      color: "var(--foreground)",
                      fontSize: 12,
                    }}
                    formatter={(v: number, n) => [formatBRL(v), n]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("resumo.total")}</p>
                  <p className="num text-xl font-bold">{formatBRLCompact(total)}</p>
                </div>
              </div>
            </div>

            <ul className="mt-4 space-y-2">
              {porCategoria.map((c, i) => (
                <li key={c.id} className="flex items-center gap-3 rounded-xl bg-card-elevated p-2.5">
                  <span className="num w-5 text-center text-xs font-semibold text-muted-foreground">
                    {i + 1}
                  </span>
                  <CategoryIcon categoria={c.cat} size="sm" />
                  <span className="flex-1 truncate text-sm font-medium">{c.nome}</span>
                  <span className="num text-sm font-semibold">{formatBRL(c.valor)}</span>
                  <span className="num w-10 text-right text-xs text-muted-foreground">
                    {c.pct.toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* Maiores gastos individuais */}
      {maioresGastos.length > 0 && (
        <section className="mt-5 rounded-3xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-warning" />
            <h2 className="text-sm font-semibold">{t("resumo.topTitle")}</h2>
          </div>
          <ul className="mt-3 space-y-2">
            {maioresGastos.map((g, i) => {
              const cat = getCategoriaById(g.categoriaId);
              return (
                <li key={g.id} className="flex items-center gap-3">
                  <span className="num w-5 text-center text-xs font-semibold text-muted-foreground">
                    {i + 1}
                  </span>
                  <CategoryIcon categoria={cat} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {g.estabelecimento || g.descricao}
                    </p>
                    <p className="text-xs text-muted-foreground">{cat?.nome ?? t("resumo.outros")}</p>
                  </div>
                  <p className="num text-sm font-semibold">{formatBRL(g.valor)}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Comparison */}
      <section className="mt-5 rounded-3xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">{t("resumo.compare.title")}</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-card-elevated p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("resumo.compare.current")}</p>
            <p className="num mt-1 text-lg font-semibold">{formatBRL(total)}</p>
          </div>
          <div className="rounded-2xl bg-card-elevated p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("resumo.compare.previous")}</p>
            <p className="num mt-1 text-lg font-semibold">{formatBRL(totalAnt)}</p>
          </div>
        </div>
        {totalAnt > 0 && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-sm">
            {diff > 0 ? (
              <>
                <TrendingUp className="h-4 w-4 text-destructive" />
                <span className="text-destructive">+{formatBRL(diff)}</span>
                <span className="num text-muted-foreground">({diffPct.toFixed(0)}%)</span>
              </>
            ) : diff < 0 ? (
              <>
                <TrendingDown className="h-4 w-4 text-success" />
                <span className="text-success">{formatBRL(diff)}</span>
                <span className="num text-muted-foreground">({diffPct.toFixed(0)}%)</span>
              </>
            ) : (
              <span className="text-muted-foreground">{t("resumo.compare.same")}</span>
            )}
          </p>
        )}
      </section>
    </MobileShell>
  );
}
