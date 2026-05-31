// Card compacto de "Dicas para economizar" no Dashboard.
// Usa o motor por regra em src/lib/insights/generator.ts. Não persiste nada,
// não toca em alertas, não dispara notificações.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import {
  Lightbulb,
  ChevronRight,
  ChevronDown,
  PiggyBank,
  Repeat,
  TrendingUp,
  PieChart as PieChartIcon,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import {
  getCategorias,
  getGastos,
  getGuardado,
  getLimite,
  getMetas,
  getReceitas,
  mesEfetivoGasto,
  useStore,
} from "@/lib/store";
import { useRecorrencias } from "@/lib/recorrencias";
import { useMesReferenciaRef } from "@/lib/use-mes-referencia";
import { buildLinhasOrcamento } from "@/lib/orcamento";
import {
  generateFinancialInsights,
  type FinancialInsight,
  type InsightPriority,
} from "@/lib/insights/generator";
import { PremiumCard } from "@/components/ui/premium-card";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function iconForInsight(type: string): LucideIcon {
  switch (type) {
    case "categoria_dominante":
      return PieChartIcon;
    case "recorrencias_acumuladas":
      return Repeat;
    case "gasto_crescente":
      return TrendingUp;
    case "orcamento_perto_limite":
      return PieChartIcon;
    case "saldo_positivo":
      return PiggyBank;
    default:
      return Lightbulb;
  }
}

function badgeToneForPriority(p: InsightPriority): StatusTone {
  if (p === "alta") return "warning";
  if (p === "media") return "info";
  return "muted";
}

export function DashboardDicasBloco({ className }: { className?: string }) {
  const { t } = useTranslation("dashboard");
  const [ym] = useMesReferenciaRef() as unknown as [
    { mes: number; ano: number },
    (next: { mes: number; ano: number }) => void,
  ];
  const [expanded, setExpanded] = useState(false);

  const gastos = useStore(() => getGastos());
  const receitas = useStore(() => getReceitas());
  const categorias = useStore(() => getCategorias());
  const guardado = useStore(() => getGuardado());
  const metas = useStore(() => getMetas());
  const recorrencias = useRecorrencias();

  const gastosDoMes = useMemo(
    () =>
      gastos.filter((g) => {
        if (g.confirmado === false) return false;
        const eff = mesEfetivoGasto(g);
        return eff.mes === ym.mes && eff.ano === ym.ano;
      }),
    [gastos, ym],
  );

  const gastosMesAnterior = useMemo(() => {
    const ref = new Date(ym.ano, ym.mes - 2, 1);
    const m = ref.getMonth() + 1;
    const a = ref.getFullYear();
    return gastos.filter((g) => {
      if (g.confirmado === false) return false;
      const eff = mesEfetivoGasto(g);
      return eff.mes === m && eff.ano === a;
    });
  }, [gastos, ym]);

  const receitasDoMes = useMemo(
    () => receitas.filter((r) => r.mes === ym.mes && r.ano === ym.ano),
    [receitas, ym],
  );

  const linhasOrcamento = useMemo(
    () =>
      buildLinhasOrcamento(
        categorias,
        gastos,
        ym.mes,
        ym.ano,
        (catId) => getLimite(catId, ym.mes, ym.ano),
        mesEfetivoGasto,
      ),
    [categorias, gastos, ym],
  );

  const insights = useMemo<FinancialInsight[]>(
    () =>
      generateFinancialInsights({
        gastosDoMes,
        gastosMesAnterior,
        receitasDoMes,
        recorrencias,
        linhasOrcamento,
        categorias,
        hasGuardado: guardado.length > 0,
        hasMetas: metas.length > 0,
      }),
    [
      gastosDoMes,
      gastosMesAnterior,
      receitasDoMes,
      recorrencias,
      linhasOrcamento,
      categorias,
      guardado.length,
      metas.length,
    ],
  );

  if (insights.length === 0) return null;

  const principal = insights[0];
  const restantes = insights.slice(1);
  const visiveis = expanded ? insights : [principal];

  return (
    <PremiumCard
      variant="default"
      rounded="2xl"
      padding="default"
      className={cn("animate-rise flex flex-col", className)}
    >

      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold leading-tight">
              Dicas para economizar
            </h3>
            <span className="text-[11px] text-muted-foreground">
              {insights.length} {insights.length === 1 ? "dica" : "dicas"}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Sugestões leves baseadas no seu mês.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3 flex-1">
        {visiveis.map((insight) => {
          const Icon = iconForInsight(insight.type);
          return (
            <div
              key={insight.id}
              className="rounded-xl border border-border/60 bg-card/60 p-3"
            >
              <div className="flex items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted/40 text-foreground">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-sm font-semibold leading-snug">
                      {insight.title}
                    </h4>
                    <StatusBadge tone={badgeToneForPriority(insight.priority)} className="shrink-0">
                      {priorityLabel(insight.priority)}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {insight.description}
                  </p>
                  {insight.actionHref && insight.actionLabel && (
                    <div className="mt-2">
                      <Button
                        asChild
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-xs text-primary hover:text-primary"
                      >
                        <Link to={insight.actionHref}>
                          {insight.actionLabel}
                          <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {restantes.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          {expanded
            ? "Mostrar menos"
            : `Ver mais ${restantes.length} ${restantes.length === 1 ? "dica" : "dicas"}`}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              expanded && "rotate-180",
            )}
          />
        </button>
      )}
    </PremiumCard>
  );
}
