import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, TrendingUp, AlertTriangle, Receipt as ReceiptIcon } from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
} from "recharts";
import { MobileShell } from "@/components/MobileShell";
import { CategoryIcon, categoryColor } from "@/components/CategoryIcon";
import {
  getCategoriaById,
  getGastos,
  getLimite,
  useBootstrap,
  useStore,
} from "@/lib/store";
import { formatBRL, formatBRLCompact, formatMonthYear } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "Gasto Fácil — Resumo do mês" }],
  }),
  component: Index,
});

function Index() {
  const ready = useBootstrap();
  const today = new Date();
  const [ym, setYm] = useState({ ano: today.getFullYear(), mes: today.getMonth() + 1 });

  const gastos = useStore(() => getGastos());
  const limiteTotal = useStore(() => getLimite("total", ym.mes, ym.ano));

  const doMes = useMemo(
    () => gastos.filter((g) => g.mes === ym.mes && g.ano === ym.ano),
    [gastos, ym],
  );

  const total = doMes.reduce((s, g) => s + g.valor, 0);
  const ultimos = [...doMes]
    .sort((a, b) => (a.data < b.data ? 1 : -1) || (a.criadoEm < b.criadoEm ? 1 : -1))
    .slice(0, 4);

  const porCategoria = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of doMes) {
      map.set(g.categoriaId, (map.get(g.categoriaId) ?? 0) + g.valor);
    }
    return [...map.entries()]
      .map(([id, v]) => {
        const cat = getCategoriaById(id);
        return {
          id,
          nome: cat?.nome ?? "Outros",
          valor: v,
          color: categoryColor(cat),
          pct: total > 0 ? (v / total) * 100 : 0,
        };
      })
      .sort((a, b) => b.valor - a.valor);
  }, [doMes, total]);

  const maior = porCategoria[0];
  const usoLimite = limiteTotal && limiteTotal > 0 ? Math.min(150, (total / limiteTotal) * 100) : 0;
  const proximoLimite = limiteTotal && total >= limiteTotal * 0.8;
  const passouLimite = limiteTotal && total > limiteTotal;

  function changeMonth(delta: number) {
    const d = new Date(ym.ano, ym.mes - 1 + delta, 1);
    setYm({ ano: d.getFullYear(), mes: d.getMonth() + 1 });
  }

  if (!ready) return <MobileShell><div /></MobileShell>;

  return (
    <MobileShell>
      {/* Header / month switcher */}
      <header className="flex items-center justify-between pt-2">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Resumo</p>
          <h1 className="text-2xl font-bold capitalize tracking-tight">
            {formatMonthYear(ym.ano, ym.mes)}
          </h1>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
          <button
            onClick={() => changeMonth(-1)}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Mês anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => changeMonth(1)}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Próximo mês"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Hero total card */}
      <section className="mt-4 rounded-3xl border border-border bg-card p-5 shadow-elevated">
        <p className="text-xs font-medium text-muted-foreground">Total gasto no mês</p>
        <p className="num mt-1 text-4xl font-extrabold tracking-tight">{formatBRL(total)}</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-card-elevated p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Lançamentos</p>
            <p className="num mt-1 text-lg font-semibold">{doMes.length}</p>
          </div>
          <div className="rounded-2xl bg-card-elevated p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Maior categoria</p>
            <p className="mt-1 truncate text-lg font-semibold" style={{ color: maior?.color }}>
              {maior?.nome ?? "—"}
            </p>
          </div>
        </div>

        {limiteTotal ? (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Limite mensal</span>
              <span className="num text-foreground">
                {formatBRL(total)} / {formatBRL(limiteTotal)}
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-card-elevated">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  passouLimite ? "bg-destructive" : proximoLimite ? "bg-warning" : "bg-success",
                )}
                style={{ width: `${Math.min(100, usoLimite)}%` }}
              />
            </div>
            {passouLimite ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                Limite ultrapassado em {formatBRL(total - limiteTotal)}
              </p>
            ) : proximoLimite ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5" />
                Você já usou {Math.round((total / limiteTotal) * 100)}% do limite
              </p>
            ) : null}
          </div>
        ) : (
          <Link
            to="/categorias"
            className="mt-4 block text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Definir limite mensal
          </Link>
        )}
      </section>

      {/* Add expense button */}
      <Link to="/adicionar" className="mt-4 block">
        <Button size="lg" className="h-14 w-full rounded-2xl text-base font-semibold shadow-elevated">
          <Plus className="mr-1 h-5 w-5" />
          Adicionar gasto
        </Button>
      </Link>

      {/* Pie chart */}
      {porCategoria.length > 0 && (
        <section className="mt-5 rounded-3xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Resumo por categoria</h2>
            <Link to="/resumo" className="text-xs text-muted-foreground hover:text-foreground">
              Ver tudo
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-[160px_1fr] items-center gap-3">
            <div className="relative h-[160px] w-[160px]">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={porCategoria}
                    dataKey="valor"
                    nameKey="nome"
                    innerRadius={50}
                    outerRadius={75}
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
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</p>
                  <p className="num text-sm font-semibold">{formatBRLCompact(total)}</p>
                </div>
              </div>
            </div>
            <ul className="space-y-2">
              {porCategoria.slice(0, 5).map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: c.color }}
                  />
                  <span className="flex-1 truncate text-sm">{c.nome}</span>
                  <span className="num text-xs text-muted-foreground">
                    {c.pct.toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Last expenses */}
      <section className="mt-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Últimos lançamentos</h2>
          <Link to="/gastos" className="text-xs text-muted-foreground hover:text-foreground">
            Ver todos
          </Link>
        </div>
        {ultimos.length === 0 ? (
          <div className="mt-3 flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card/50 p-8 text-center">
            <ReceiptIcon className="h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">Nenhum gasto este mês ainda.</p>
            <Link to="/adicionar" className="mt-3 text-sm font-medium underline">
              Cadastrar o primeiro
            </Link>
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {ultimos.map((g) => {
              const cat = getCategoriaById(g.categoriaId);
              return (
                <li
                  key={g.id}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
                >
                  <CategoryIcon categoria={cat} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {g.estabelecimento || g.descricao}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {cat?.nome ?? "Outros"} · {new Date(g.data + "T00:00:00").toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <p className="num shrink-0 text-sm font-semibold">{formatBRL(g.valor)}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Insight */}
      {maior && (
        <section className="mt-5 rounded-3xl border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-9 w-9 place-items-center rounded-full bg-card-elevated">
              <TrendingUp className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Análise do mês
              </p>
              <p className="mt-1 text-sm">
                Sua maior categoria é{" "}
                <span className="font-semibold" style={{ color: maior.color }}>
                  {maior.nome}
                </span>{" "}
                — {formatBRL(maior.valor)} ({maior.pct.toFixed(0)}% do total).
              </p>
            </div>
          </div>
        </section>
      )}
    </MobileShell>
  );
}
