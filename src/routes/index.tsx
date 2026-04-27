import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  TrendingUp,
  AlertTriangle,
  Receipt as ReceiptIcon,
  Wallet,
  Target,
  ArrowDown,
  ArrowUp,
  Sparkles,
  Lock,
  PieChart as PieChartIcon,
  ListChecks,
  CalendarClock,
} from "lucide-react";
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
  getGuardado,
  getLimite,
  getMetas,
  getReceitas,
  statusMeta,
  useBootstrap,
  useStore,
} from "@/lib/store";
import { formatBRL, formatBRLCompact, formatMonthYear } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  const receitas = useStore(() => getReceitas());
  const guardado = useStore(() => getGuardado());
  const metas = useStore(() => getMetas());
  const limiteTotal = useStore(() => getLimite("total", ym.mes, ym.ano));

  const doMes = useMemo(
    () => gastos.filter((g) => g.mes === ym.mes && g.ano === ym.ano),
    [gastos, ym],
  );
  const receitasMes = useMemo(
    () => receitas.filter((r) => r.mes === ym.mes && r.ano === ym.ano),
    [receitas, ym],
  );

  const total = useMemo(() => doMes.reduce((s, g) => s + g.valor, 0), [doMes]);
  const totalEntradas = useMemo(
    () => receitasMes.reduce((s, r) => s + r.valor, 0),
    [receitasMes],
  );
  const saldo = totalEntradas - total;

  const totalGuardado = useMemo(
    () => guardado.reduce((s, g) => s + g.valor, 0),
    [guardado],
  );
  const gastosFixos = useMemo(
    () =>
      doMes
        .filter((g) => g.gastoFixo || g.tipoGasto === "recorrente")
        .reduce((s, g) => s + g.valor, 0),
    [doMes],
  );

  const ultimos = useMemo(
    () =>
      [...doMes]
        .sort(
          (a, b) =>
            (a.data < b.data ? 1 : -1) || (a.criadoEm < b.criadoEm ? 1 : -1),
        )
        .slice(0, 4),
    [doMes],
  );

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
  const usoLimite =
    limiteTotal && limiteTotal > 0 ? Math.min(150, (total / limiteTotal) * 100) : 0;
  const proximoLimite = limiteTotal && total >= limiteTotal * 0.8;
  const passouLimite = limiteTotal && total > limiteTotal;

  // Metas
  const metasAndamento = useMemo(
    () => metas.filter((m) => statusMeta(m) !== "concluida"),
    [metas],
  );
  const metaProxima = useMemo(() => {
    let alvo: (typeof metas)[number] | null = null;
    let melhorPct = -1;
    for (const m of metasAndamento) {
      const p = m.valorObjetivo > 0 ? m.valorAtual / m.valorObjetivo : 0;
      if (p > melhorPct) {
        melhorPct = p;
        alvo = m;
      }
    }
    return alvo;
  }, [metasAndamento]);

  function changeMonth(delta: number) {
    const d = new Date(ym.ano, ym.mes - 1 + delta, 1);
    setYm({ ano: d.getFullYear(), mes: d.getMonth() + 1 });
  }

  const isEmpty =
    gastos.length === 0 &&
    receitas.length === 0 &&
    guardado.length === 0 &&
    metas.length === 0;

  if (!ready) return <DashboardSkeleton />;

  if (isEmpty) {
    return (
      <MobileShell>
        <header className="pt-2">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Gasto Fácil
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Bem-vindo(a)!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Comece cadastrando sua renda, seus gastos ou seu dinheiro guardado.
          </p>
        </header>

        <section className="mt-6 grid grid-cols-2 gap-3">
          <WelcomeCard
            to="/renda"
            search={{ ano: ym.ano, mes: ym.mes }}
            icon={<ArrowUp className="h-5 w-5" />}
            title="Cadastrar salário"
            tint="success"
          />
          <WelcomeCard
            to="/adicionar"
            icon={<Plus className="h-5 w-5" />}
            title="Adicionar gasto"
            tint="primary"
          />
          <WelcomeCard
            to="/guardado"
            icon={<Wallet className="h-5 w-5" />}
            title="Dinheiro guardado"
            tint="muted"
          />
          <WelcomeCard
            to="/metas"
            icon={<Target className="h-5 w-5" />}
            title="Criar meta"
            tint="muted"
          />
        </section>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Seus dados ficam vinculados à sua conta.
        </p>
      </MobileShell>
    );
  }

  return (
    <MobileShell>
      {/* Header / month switcher */}
      <header className="flex items-center justify-between pt-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Resumo
          </p>
          <h1 className="mt-0.5 text-[26px] font-bold capitalize leading-tight tracking-tight">
            {formatMonthYear(ym.ano, ym.mes)}
          </h1>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
          <button
            onClick={() => changeMonth(-1)}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Mês anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => changeMonth(1)}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Próximo mês"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ===== 1. RESUMO PRINCIPAL ===== */}
      <SectionLabel>Resumo do mês</SectionLabel>

      <section className="rounded-3xl border border-border bg-card p-5 shadow-elevated">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Saldo do mês
        </p>
        <p
          className={cn(
            "num mt-1 text-[34px] font-extrabold leading-none tracking-tight",
            saldo < 0 && "text-destructive",
          )}
        >
          {formatBRL(saldo)}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <MiniStat
            label="Entradas"
            value={formatBRL(totalEntradas)}
            icon={<ArrowUp className="h-3 w-3" />}
            tone="success"
          />
          <MiniStat
            label="Gastos"
            value={formatBRL(total)}
            icon={<ArrowDown className="h-3 w-3" />}
            tone="destructive"
          />
        </div>

        {saldo < 0 && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            Você gastou {formatBRL(-saldo)} a mais do que recebeu.
          </p>
        )}
      </section>

      {/* CTA principal */}
      <Link to="/adicionar" className="mt-3 block">
        <Button
          size="lg"
          className="h-14 w-full rounded-2xl text-base font-semibold shadow-elevated"
        >
          <Plus className="mr-1 h-5 w-5" />
          Adicionar gasto
        </Button>
      </Link>

      {/* ===== 2. CONTROLE FINANCEIRO ===== */}
      <SectionLabel>Controle financeiro</SectionLabel>

      <section className="grid grid-cols-2 gap-2.5">
        <Link
          to="/guardado"
          className="rounded-2xl border border-border bg-card p-3.5 transition-colors hover:bg-card-elevated"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Total guardado
            </p>
            <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <p className="num mt-1.5 text-lg font-bold">{formatBRL(totalGuardado)}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {guardado.length} {guardado.length === 1 ? "reserva" : "reservas"}
          </p>
        </Link>
        <div className="rounded-2xl border border-border bg-card p-3.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Gastos fixos
            </p>
            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <p className="num mt-1.5 text-lg font-bold">{formatBRL(gastosFixos)}</p>
          {totalEntradas > 0 ? (
            <p className="num mt-0.5 text-[10px] text-muted-foreground">
              {Math.round((gastosFixos / totalEntradas) * 100)}% da renda
            </p>
          ) : (
            <p className="mt-0.5 text-[10px] text-muted-foreground">—</p>
          )}
        </div>
      </section>

      {/* Limite mensal */}
      {limiteTotal ? (
        <section className="mt-2.5 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Limite mensal
            </p>
            <span className="num text-xs text-foreground">
              {formatBRL(total)} / {formatBRL(limiteTotal)}
            </span>
          </div>
          <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-card-elevated">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                passouLimite
                  ? "bg-destructive"
                  : proximoLimite
                    ? "bg-warning"
                    : "bg-success",
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
          ) : (
            <p className="num mt-2 text-[11px] text-muted-foreground">
              {Math.round((total / limiteTotal) * 100)}% usado
            </p>
          )}
        </section>
      ) : null}

      {/* Atalhos: Renda */}
      <Link
        to="/renda"
        search={{ ano: ym.ano, mes: ym.mes }}
        className="mt-2.5 flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 transition-colors hover:bg-card-elevated"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-success/15 text-success">
          <ArrowUp className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">Minha renda</p>
          <p className="num truncate text-[11px] text-muted-foreground">
            {formatBRL(totalEntradas)} este mês
          </p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>

      {/* ===== 3. CATEGORIAS ===== */}
      {porCategoria.length > 0 && (
        <>
          <SectionLabel>Categorias</SectionLabel>
          <section className="rounded-3xl border border-border bg-card p-4 shadow-card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PieChartIcon className="h-3.5 w-3.5 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Por categoria</h2>
              </div>
              <Link
                to="/resumo"
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Ver tudo →
              </Link>
            </div>
            <div className="mt-4 grid grid-cols-[140px_1fr] items-center gap-3">
              <div className="relative h-[140px] w-[140px]">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={porCategoria}
                      dataKey="valor"
                      nameKey="nome"
                      innerRadius={44}
                      outerRadius={66}
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
                    <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
                      Total
                    </p>
                    <p className="num text-sm font-semibold">
                      {formatBRLCompact(total)}
                    </p>
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
                    <span className="flex-1 truncate text-[13px]">{c.nome}</span>
                    <span className="num text-[11px] text-muted-foreground">
                      {c.pct.toFixed(0)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </>
      )}

      {/* ===== 4. METAS ===== */}
      {(metaProxima || metasAndamento.length > 0) && (
        <>
          <SectionLabel>Metas</SectionLabel>
          {metaProxima ? (
            <section className="rounded-3xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles
                    className="h-3.5 w-3.5"
                    style={{ color: metaProxima.colorHex }}
                  />
                  <h2 className="text-sm font-semibold">Mais próxima de concluir</h2>
                </div>
                <Link
                  to="/metas"
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  Ver todas →
                </Link>
              </div>
              <div className="mt-3 flex items-baseline justify-between gap-3">
                <p className="truncate text-base font-semibold">{metaProxima.nome}</p>
                <p className="num shrink-0 text-xs text-muted-foreground">
                  {formatBRL(metaProxima.valorAtual)} /{" "}
                  {formatBRL(metaProxima.valorObjetivo)}
                </p>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-card-elevated">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (metaProxima.valorAtual / metaProxima.valorObjetivo) * 100)}%`,
                    background: metaProxima.colorHex,
                  }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span
                  className="num font-semibold"
                  style={{ color: metaProxima.colorHex }}
                >
                  {Math.min(
                    100,
                    Math.round(
                      (metaProxima.valorAtual / metaProxima.valorObjetivo) * 100,
                    ),
                  )}
                  %
                </span>
                <span className="text-muted-foreground">
                  {metasAndamento.length}{" "}
                  {metasAndamento.length === 1 ? "meta ativa" : "metas ativas"}
                </span>
              </div>
            </section>
          ) : (
            <Link
              to="/metas"
              className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 transition-colors hover:bg-card-elevated"
            >
              <span className="grid h-9 w-9 place-items-center rounded-full bg-card-elevated">
                <Target className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">Metas</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {metasAndamento.length} em andamento
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          )}
        </>
      )}

      {/* ===== 5. ÚLTIMOS LANÇAMENTOS ===== */}
      <SectionLabel>Últimos lançamentos</SectionLabel>
      <section>
        {ultimos.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card/50 p-8 text-center">
            <ReceiptIcon className="h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              Nenhum gasto este mês ainda.
            </p>
            <Link to="/adicionar" className="mt-3 text-sm font-medium underline">
              Cadastrar o primeiro
            </Link>
          </div>
        ) : (
          <>
            <ul className="space-y-2">
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
                        {cat?.nome ?? "Outros"} ·{" "}
                        {new Date(g.data + "T00:00:00").toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                    <p className="num shrink-0 text-sm font-semibold">
                      {formatBRL(g.valor)}
                    </p>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 flex justify-end">
              <Link
                to="/gastos"
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Ver todos →
              </Link>
            </div>
          </>
        )}
      </section>

      {/* ===== 6. INSIGHTS ===== */}
      {(maior || gastosFixos > 0 || totalGuardado > 0) && (
        <>
          <SectionLabel>Insights</SectionLabel>
          <section className="rounded-3xl border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-card-elevated">
                <TrendingUp className="h-4 w-4" />
              </span>
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Análise do mês
                </p>
                {maior && (
                  <p className="text-sm leading-relaxed">
                    Sua maior categoria é{" "}
                    <span className="font-semibold" style={{ color: maior.color }}>
                      {maior.nome}
                    </span>{" "}
                    — {formatBRL(maior.valor)} ({maior.pct.toFixed(0)}% do total).
                  </p>
                )}
                {totalEntradas > 0 && gastosFixos > 0 && (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Seus gastos fixos representam{" "}
                    {Math.round((gastosFixos / totalEntradas) * 100)}% da sua renda.
                  </p>
                )}
                {totalGuardado > 0 && (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Você tem {formatBRL(totalGuardado)} guardados no total.
                  </p>
                )}
                {metaProxima && (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Sua meta “{metaProxima.nome}” está{" "}
                    {Math.round(
                      (metaProxima.valorAtual / metaProxima.valorObjetivo) * 100,
                    )}
                    % concluída.
                  </p>
                )}
              </div>
            </div>
          </section>
        </>
      )}

      {/* Resumo financeiro compacto (rodapé) */}
      <SectionLabel>Resumo financeiro</SectionLabel>
      <section className="rounded-3xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <ListChecks className="h-3.5 w-3.5 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Visão geral</h2>
        </div>
        <ul className="mt-3 space-y-2 text-sm">
          <ResumoLinha label="Entradas" valor={formatBRL(totalEntradas)} positive />
          <ResumoLinha label="Gastos" valor={formatBRL(total)} />
          <ResumoLinha
            label="Saldo restante"
            valor={formatBRL(saldo)}
            negative={saldo < 0}
            strong
          />
          <ResumoLinha label="Total guardado" valor={formatBRL(totalGuardado)} />
          <ResumoLinha label="Gastos fixos" valor={formatBRL(gastosFixos)} />
          <ResumoLinha label="Maior categoria" valor={maior?.nome ?? "—"} mute />
        </ul>
      </section>
    </MobileShell>
  );
}

/* ====================== Helpers de UI ====================== */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 mt-6 px-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </h2>
  );
}

function MiniStat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: "success" | "destructive";
}) {
  return (
    <div className="rounded-2xl bg-card-elevated p-3">
      <p
        className={cn(
          "flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
        )}
      >
        <span
          className={cn(
            tone === "success" && "text-success",
            tone === "destructive" && "text-destructive",
          )}
        >
          {icon}
        </span>
        {label}
      </p>
      <p
        className={cn(
          "num mt-1 text-base font-semibold",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ResumoLinha({
  label,
  valor,
  positive,
  negative,
  strong,
  mute,
}: {
  label: string;
  valor: string;
  positive?: boolean;
  negative?: boolean;
  strong?: boolean;
  mute?: boolean;
}) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "num",
          strong && "font-semibold",
          positive && "text-success",
          negative && "text-destructive",
          mute && "text-muted-foreground",
        )}
      >
        {valor}
      </span>
    </li>
  );
}

function WelcomeCard({
  to,
  icon,
  title,
  tint,
  search,
}: {
  to: "/renda" | "/adicionar" | "/guardado" | "/metas";
  icon: React.ReactNode;
  title: string;
  tint: "primary" | "success" | "muted";
  search?: Record<string, unknown>;
}) {
  return (
    <Link
      to={to}
      search={search as never}
      className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-4 transition-colors hover:bg-card-elevated"
    >
      <span
        className={cn(
          "grid h-10 w-10 place-items-center rounded-2xl",
          tint === "primary" && "bg-primary/15 text-primary",
          tint === "success" && "bg-success/15 text-success",
          tint === "muted" && "bg-card-elevated text-foreground",
        )}
      >
        {icon}
      </span>
      <p className="text-sm font-semibold leading-tight">{title}</p>
    </Link>
  );
}

function DashboardSkeleton() {
  return (
    <MobileShell>
      <div className="flex items-center justify-between pt-2">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-7 w-40" />
        </div>
        <Skeleton className="h-10 w-20 rounded-full" />
      </div>

      <Skeleton className="mt-6 h-3 w-28" />
      <Skeleton className="mt-2 h-44 w-full rounded-3xl" />

      <Skeleton className="mt-3 h-14 w-full rounded-2xl" />

      <Skeleton className="mt-6 h-3 w-32" />
      <div className="mt-2 grid grid-cols-2 gap-2.5">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-20 rounded-2xl" />
      </div>
      <Skeleton className="mt-2.5 h-20 w-full rounded-2xl" />

      <Skeleton className="mt-6 h-3 w-24" />
      <Skeleton className="mt-2 h-48 w-full rounded-3xl" />

      <Skeleton className="mt-6 h-3 w-20" />
      <div className="mt-2 space-y-2">
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-16 w-full rounded-2xl" />
      </div>
    </MobileShell>
  );
}
