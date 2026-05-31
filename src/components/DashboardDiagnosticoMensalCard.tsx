// Card compacto do Diagnóstico Mensal no Dashboard.
// Reusa dados que já estão no store. Não persiste, não notifica,
// não duplica alertas/dicas — apenas resume o mês e orienta o usuário.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import {
  ClipboardList,
  ChevronRight,
  Landmark,
} from "lucide-react";
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
  buildMacroContext,
  generateMonthlyDiagnosis,
  type MacroSnapshot,
  type MonthlyDiagnosisStatus,
} from "@/lib/insights/monthly-diagnosis";
import { loadBcbRadar } from "@/lib/economy/bcb";
import { PremiumCard } from "@/components/ui/premium-card";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function statusTone(status: MonthlyDiagnosisStatus): {
  badge: StatusTone;
  ring: string;
  iconBg: string;
  iconFg: string;
} {
  switch (status) {
    case "critico":
      return {
        badge: "destructive",
        ring: "border-destructive/40",
        iconBg: "bg-destructive/15",
        iconFg: "text-destructive",
      };
    case "atencao":
      return {
        badge: "warning",
        ring: "border-warning/40",
        iconBg: "bg-warning/15",
        iconFg: "text-warning",
      };
    case "bom":
      return {
        badge: "info",
        ring: "border-primary/30",
        iconBg: "bg-primary/10",
        iconFg: "text-primary",
      };
    case "excelente":
      return {
        badge: "success",
        ring: "border-success/40",
        iconBg: "bg-success/15",
        iconFg: "text-success",
      };
  }
}

export function DashboardDiagnosticoMensalCard({ className }: { className?: string }) {
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

  const diag = useMemo(
    () =>
      generateMonthlyDiagnosis({
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

  // Carrega indicadores do BCB respeitando o cache (TTL 6h/24h). Se o Radar
  // já tiver buscado, este load é apenas leitura do localStorage. Em caso de
  // erro, o bloco macro simplesmente não aparece — o Diagnóstico segue ok.
  const [macro, setMacro] = useState<MacroSnapshot | null>(null);
  useEffect(() => {
    let cancel = false;
    void loadBcbRadar()
      .then((r) => {
        if (cancel || r.failed) return;
        const find = (k: "SELIC" | "CDI" | "IPCA") =>
          r.indicators.find((i) => i.key === k)?.value;
        setMacro({ selic: find("SELIC"), cdi: find("CDI"), ipca: find("IPCA") });
      })
      .catch(() => {
        /* silencioso — bloco macro não aparece */
      });
    return () => {
      cancel = true;
    };
  }, []);

  const renda = useMemo(
    () => receitasDoMes.reduce((s, r) => s + (r.valor || 0), 0),
    [receitasDoMes],
  );
  const gastosTotal = useMemo(
    () => gastosDoMes.reduce((s, g) => s + (g.valor || 0), 0),
    [gastosDoMes],
  );
  const saldoMes = renda - gastosTotal;

  const macroContexto = useMemo(
    () =>
      macro
        ? buildMacroContext({
            macro,
            saldo: saldoMes,
            renda,
            gastos: gastosTotal,
          })
        : null,
    [macro, saldoMes, renda, gastosTotal],
  );

  if (!diag) {
    return (
      <PremiumCard
        variant="subtle"
        rounded="2xl"
        padding="default"
        className={cn("animate-rise", className)}
      >
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted/40 text-muted-foreground">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold leading-tight">
              {t("monthlyDiagnosis.title")}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("monthlyDiagnosis.empty")}
            </p>
          </div>
        </div>
      </PremiumCard>
    );
  }

  const tone = statusTone(diag.status);

  return (
    <PremiumCard
      variant="default"
      rounded="2xl"
      padding="default"
      className={cn("animate-rise border", tone.ring, className)}
    >
      <div className="flex items-start gap-3">
        <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tone.iconBg)}>
          <ClipboardList className={cn("h-5 w-5", tone.iconFg)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold leading-tight">
              Diagnóstico mensal
            </h3>
            <StatusBadge tone={tone.badge}>{tone.label}</StatusBadge>
          </div>
          <p className="mt-1 text-sm font-semibold leading-snug">
            {diag.title}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {diag.summary}
          </p>
        </div>
      </div>

      {/* Bullets de highlights/risks intencionalmente ocultos aqui para não
          duplicar o card de Saúde Financeira (que já lista esses bullets).
          O Diagnóstico fica com papel próprio: título orientativo + resumo
          em prosa + próximas ações. */}

      {macroContexto && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
          <Landmark className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
          <div className="min-w-0">
            <span className="mr-1 font-medium text-foreground">Cenário econômico:</span>
            <span>{macroContexto}</span>
          </div>
        </div>
      )}

      {diag.nextActions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {diag.nextActions.map((a) => (
            <Button
              key={a.href}
              asChild
              size="sm"
              variant="outline"
              className="h-9 px-3 text-xs"
            >
              <Link to={a.href}>
                {a.label}
                <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          ))}
        </div>
      )}
    </PremiumCard>
  );
}
