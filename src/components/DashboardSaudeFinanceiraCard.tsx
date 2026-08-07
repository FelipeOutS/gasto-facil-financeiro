// Card compacto de saúde financeira no Dashboard.
// Roda 100% client-side em cima do store. Não persiste, não notifica,
// não duplica alertas/dicas — apenas mostra um diagnóstico explicável.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { HeartPulse, CheckCircle2, AlertTriangle, Activity, type LucideIcon } from "lucide-react";
import {
  getCartoes,
  getCategorias,
  getContasAPagar,
  getGastos,
  getGuardado,
  getLimite,
  getMetas,
  getReceitas,
  mesEfetivoGasto,
  resumoFaturaCartao,
  useStore,
} from "@/lib/store";
import { useRecorrencias } from "@/lib/recorrencias";
import { useMesReferenciaRef } from "@/lib/use-mes-referencia";
import { buildLinhasOrcamento } from "@/lib/orcamento";
import {
  buildEconomicHealthNote,
  calculateFinancialHealthScore,
  type FinancialHealthLevel,
} from "@/lib/insights/financial-health-score";
import { loadBcbRadar, type BcbIndicator } from "@/lib/economy/bcb";
import { PremiumCard } from "@/components/ui/premium-card";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

function levelTone(level: FinancialHealthLevel): {
  badge: StatusTone;
  scoreText: string;
  ring: string;
  iconBg: string;
  iconFg: string;
} {
  switch (level) {
    case "critico":
      return {
        badge: "destructive",
        scoreText: "text-destructive",
        ring: "border-destructive/40",
        iconBg: "bg-destructive/15",
        iconFg: "text-destructive",
      };
    case "atencao":
      return {
        badge: "warning",
        scoreText: "text-warning",
        ring: "border-warning/40",
        iconBg: "bg-warning/15",
        iconFg: "text-warning",
      };
    case "bom":
      return {
        badge: "info",
        scoreText: "text-primary",
        ring: "border-primary/30",
        iconBg: "bg-primary/10",
        iconFg: "text-primary",
      };
    case "excelente":
      return {
        badge: "success",
        scoreText: "text-success",
        ring: "border-success/40",
        iconBg: "bg-success/15",
        iconFg: "text-success",
      };
  }
}

function BulletRow({
  icon: Icon,
  iconClass,
  text,
}: {
  icon: LucideIcon;
  iconClass: string;
  text: string;
}) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", iconClass)} />
      <span className="text-muted-foreground">{text}</span>
    </li>
  );
}

export function DashboardSaudeFinanceiraCard({
  className,
  embedded = false,
}: {
  className?: string;
  /** Renderiza sem a moldura de card, para compor dentro de outro card. */
  embedded?: boolean;
}) {
  const { t } = useTranslation("dashboard");
  const [ym] = useMesReferenciaRef() as unknown as [
    { mes: number; ano: number },
    (next: { mes: number; ano: number }) => void,
  ];

  const gastos = useStore(() => getGastos());
  const receitas = useStore(() => getReceitas());
  const categorias = useStore(() => getCategorias());
  const cartoes = useStore(() => getCartoes());
  const contasAPagar = useStore(() => getContasAPagar());
  const metas = useStore(() => getMetas());
  const guardado = useStore(() => getGuardado());
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

  const usoCartaoPct = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cartoes) {
      const resumo = resumoFaturaCartao(c.id);
      m.set(c.id, resumo.pct);
    }
    return m;
  }, [cartoes, gastos]);

  const health = useMemo(
    () =>
      calculateFinancialHealthScore({
        gastosDoMes,
        receitasDoMes,
        contasAPagar,
        cartoes,
        usoCartaoPct,
        recorrencias,
        linhasOrcamento,
        metas,
        guardado,
      }),
    [
      gastosDoMes,
      receitasDoMes,
      contasAPagar,
      cartoes,
      usoCartaoPct,
      recorrencias,
      linhasOrcamento,
      metas,
      guardado,
    ],
  );

  // Cenário econômico (BCB) — cache-first, falha em silêncio.
  // DEVE ficar antes de qualquer return condicional (regra dos Hooks).
  const [bcbIndicators, setBcbIndicators] = useState<BcbIndicator[] | null>(null);
  useEffect(() => {
    let alive = true;
    loadBcbRadar()
      .then((r) => {
        if (alive && r.indicators.length > 0) setBcbIndicators(r.indicators);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const economicNote = useMemo(() => {
    if (!bcbIndicators || !health) return null;
    const find = (k: "SELIC" | "CDI" | "IPCA") =>
      bcbIndicators.find((i) => i.key === k)?.value ?? null;
    return buildEconomicHealthNote({
      level: health.level,
      selic: find("SELIC"),
      cdi: find("CDI"),
      ipca: find("IPCA"),
    });
  }, [bcbIndicators, health]);

  // Estado de dados insuficientes — card compacto e educativo
  if (!health) {
    return (
      <PremiumCard
        variant="subtle"
        rounded="2xl"
        padding="default"
        className={cn("animate-rise", className)}
      >
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted/40 text-muted-foreground">
            <HeartPulse className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold leading-tight">{t("financialHealth.title")}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t("financialHealth.empty")}</p>
          </div>
        </div>
      </PremiumCard>
    );
  }

  const tone = levelTone(health.level);

  return (
    <PremiumCard
      variant="default"
      rounded="2xl"
      padding="default"
      className={cn("animate-rise border", tone.ring, className)}
    >
      <div className="flex items-start gap-3">
        <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tone.iconBg)}>
          <HeartPulse className={cn("h-5 w-5", tone.iconFg)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold leading-tight">{t("financialHealth.title")}</h3>
            <StatusBadge tone={tone.badge}>
              {t(`financialHealth.levels.${health.level}`)}
            </StatusBadge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{health.description}</p>
        </div>
      </div>

      <div className="mt-4 flex items-end gap-2">
        <span className={cn("text-4xl font-bold leading-none tabular-nums", tone.scoreText)}>
          {health.score}
        </span>
        <span className="pb-1 text-sm text-muted-foreground">{t("financialHealth.scoreMax")}</span>
      </div>
      <p className="mt-1 text-xs font-semibold">{health.title}</p>

      {(health.positives.length > 0 || health.warnings.length > 0) && (
        <ul className="mt-3 space-y-1.5">
          {health.warnings.slice(0, 2).map((w, i) => (
            <BulletRow key={`w-${i}`} icon={AlertTriangle} iconClass={tone.iconFg} text={w} />
          ))}
          {health.positives.slice(0, 2).map((p, i) => (
            <BulletRow key={`p-${i}`} icon={CheckCircle2} iconClass="text-success" text={p} />
          ))}
        </ul>
      )}

      {economicNote && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2">
          <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("financialHealth.scenarioLabel")}
            </span>
            <span className="text-[11px] leading-snug text-foreground">{economicNote}</span>
          </div>
        </div>
      )}
    </PremiumCard>
  );
}
