import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  PieChart as PieChartIcon,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Pencil,
  Plus,
  Copy,
  Trash2,
  Sparkles,
  BarChart3,
} from "lucide-react";
import { OrcamentoCategoriaCard } from "@/components/orcamento/OrcamentoCategoriaCard";
import { OrcamentoLimiteDiarioCard } from "@/components/orcamento/OrcamentoLimiteDiarioCard";
import { OrcamentoPrevisaoCard } from "@/components/orcamento/OrcamentoPrevisaoCard";
import type { PrevisaoTipo } from "@/components/orcamento/OrcamentoPrevisaoCard";
import { PlanejamentoMensalCard, type PlanejamentoEstado } from "@/components/orcamento/PlanejamentoMensalCard";
import { SugestaoDistribuicaoRenda } from "@/components/orcamento/SugestaoDistribuicaoRenda";
import { MobileShell } from "@/components/MobileShell";
import { useAuth } from "@/lib/auth-context";
import { getVocab, type TipoCadastro } from "@/lib/profile-utils";
import { PageSkeleton } from "@/components/PageSkeleton";
import { CategoryIcon, categoryColor } from "@/components/CategoryIcon";
import {
  getCategorias,
  getContasAPagar,
  getGastos,
  getGuardado,
  getLimite,
  getLimites,
  getReceitas,
  mesEfetivoGasto,
  setLimite,
  useBootstrap,
  useStore,
} from "@/lib/store";
import {
  buildLinhasOrcamento,
  resumirOrcamento,
} from "@/lib/orcamento";
import { formatBRL, formatMonthYear, parseBRLInput } from "@/lib/format";
import { Money } from "@/components/Money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MetricCard } from "@/components/ui/metric-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/orcamento")({
  head: () => ({
    meta: [
      { title: "Orçamento — Gasto Inteligente" },
      {
        name: "description",
        content: "Acompanhe seu orçamento mensal por categoria.",
      },
    ],
  }),
  component: OrcamentoPage,
});

function OrcamentoPage() {
  const { t } = useTranslation("orcamento");
  const ready = useBootstrap();
  const { profile } = useAuth();
  const vocab = getVocab(profile?.tipo_cadastro as TipoCadastro);
  const today = new Date();
  const [ym, setYm] = useState({ ano: today.getFullYear(), mes: today.getMonth() + 1 });

  const categorias = useStore(() => getCategorias());
  const gastos = useStore(() => getGastos());
  const receitas = useStore(() => getReceitas());
  const guardado = useStore(() => getGuardado());
  const contasAPagar = useStore(() => getContasAPagar());
  const limiteTotal = useStore(() => getLimite("total", ym.mes, ym.ano));
  // Re-render quando limites mudam (qualquer setLimite)
  useStore(() => getLimites().length);

  const linhas = useMemo(
    () =>
      buildLinhasOrcamento(categorias, gastos, ym.mes, ym.ano, (catId) =>
        getLimite(catId, ym.mes, ym.ano),
        mesEfetivoGasto,
      ),
    [categorias, gastos, ym],
  );

  const resumo = useMemo(() => resumirOrcamento(linhas), [linhas]);
  const {
    comLimite,
    semLimiteComGasto,
    totalPlanejado,
    totalRealizado,
    diff,
    pctGeral,
    qtdAtencao,
    qtdEstouro,
    qtdOk,
    temOrcamento,
  } = resumo;

  // Limite diário inteligente
  const limiteDiarioInfo = useMemo(() => {
    const mesAtual = today.getMonth() + 1;
    const anoAtual = today.getFullYear();

    // Sem orçamento configurado
    if (!temOrcamento && (limiteTotal ?? 0) <= 1) {
      return { tipo: "semOrcamento" as const, status: "muted" as const };
    }

    // Mês passado
    if (ym.ano < anoAtual || (ym.ano === anoAtual && ym.mes < mesAtual)) {
      return { tipo: "passado" as const, status: "muted" as const };
    }

    // Mês futuro
    if (ym.ano > anoAtual || (ym.ano === anoAtual && ym.mes > mesAtual)) {
      return { tipo: "futuro" as const, status: "muted" as const };
    }

    // Mês atual
    if (diff <= 1) {
      return { tipo: "estourado" as const, status: "destructive" as const };
    }

    const diasNoMes = new Date(ym.ano, ym.mes, 0).getDate();
    const diasRestantes = Math.max(1, diasNoMes - today.getDate() + 1);
    const limiteDiario = diff / diasRestantes;
    const limiteDiarioOriginal = totalPlanejado > 0 ? totalPlanejado / diasNoMes : 0;
    const isLow = limiteDiarioOriginal > 0 && limiteDiario < limiteDiarioOriginal * 0.2;

    return {
      tipo: "atual" as const,
      valor: limiteDiario,
      diasRestantes,
      status: isLow ? ("warning" as const) : ("success" as const),
    };
  }, [ym, today, temOrcamento, limiteTotal, totalPlanejado, totalRealizado, diff]);

  // Previsão de estouro do orçamento
  const previsaoInfo = useMemo(() => {
    const mesAtual = today.getMonth() + 1;
    const anoAtual = today.getFullYear();
    const diasNoMes = new Date(ym.ano, ym.mes, 0).getDate();

    // Sem orçamento configurado
    if (!temOrcamento && (limiteTotal ?? 0) <= 1) {
      return { tipo: "sem_dados" as PrevisaoTipo };
    }

    // Mês passado
    if (ym.ano < anoAtual || (ym.ano === anoAtual && ym.mes < mesAtual)) {
      return {
        tipo: (diff >= 0 ? "passado_dentro" : "passado_fora") as PrevisaoTipo,
        planejado: totalPlanejado,
        diferenca: diff,
      };
    }

    // Mês futuro
    if (ym.ano > anoAtual || (ym.ano === anoAtual && ym.mes > mesAtual)) {
      return { tipo: "futuro" as PrevisaoTipo };
    }

    // Mês atual
    const diaAtual = today.getDate();

    // Poucos dados (primeiros 2 dias do mês)
    if (diaAtual <= 2) {
      return { tipo: "sem_dados" as PrevisaoTipo };
    }

    // Já estourado
    if (diff < 1) {
      return {
        tipo: "ja_estourado" as PrevisaoTipo,
        planejado: totalPlanejado,
        diferenca: diff,
      };
    }

    const mediaDiaria = totalRealizado / diaAtual;
    const gastoProjetado = mediaDiaria * diasNoMes;
    const diferencaProj = totalPlanejado - gastoProjetado;

    if (gastoProjetado <= totalPlanejado) {
      return {
        tipo: "dentro_previsto" as PrevisaoTipo,
        gastoProjetado,
        planejado: totalPlanejado,
        diferenca: diferencaProj,
      };
    }

    return {
      tipo: "risco_estouro" as PrevisaoTipo,
      gastoProjetado,
      planejado: totalPlanejado,
      diferenca: diferencaProj,
    };
  }, [ym, today, temOrcamento, limiteTotal, totalPlanejado, totalRealizado, diff]);

  // Preferência local: incluir contas do mês no planejamento (por usuário/mês)
  const incluirContasKey = `gi:orcamento:incluir-contas:${profile?.id ?? "anon"}:${ym.ano}-${String(ym.mes).padStart(2, "0")}`;
  const [incluirContas, setIncluirContasState] = useState<boolean>(true);
  useEffect(() => {
    try {
      const v = localStorage.getItem(incluirContasKey);
      setIncluirContasState(v === null ? true : v === "1");
    } catch {
      setIncluirContasState(true);
    }
  }, [incluirContasKey]);
  const setIncluirContas = (v: boolean) => {
    setIncluirContasState(v);
    try {
      localStorage.setItem(incluirContasKey, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  // Planejamento mensal (Orçamento Zero — MVP visual, sem banco)
  const planejamentoInfo = useMemo(() => {
    const renda = receitas
      .filter((r) => r.mes === ym.mes && r.ano === ym.ano)
      .reduce((acc, r) => acc + (r.valor || 0), 0);

    const distribuidoCategorias = comLimite.reduce(
      (acc, l) => acc + (l.planejado || 0),
      0,
    );

    const distribuidoContasReal = contasAPagar
      .filter((c) => {
        const parts = c.dataVencimento.split("-");
        const ano = Number(parts[0]);
        const mes = Number(parts[1]);
        return mes === ym.mes && ano === ym.ano;
      })
      .reduce((acc, c) => acc + (c.valor || 0), 0);

    const distribuidoContas = incluirContas ? distribuidoContasReal : 0;

    const ymPrefix = `${ym.ano}-${String(ym.mes).padStart(2, "0")}`;
    const distribuidoReserva = guardado
      .filter((g) => (g.dataAtualizacao || "").startsWith(ymPrefix))
      .reduce((acc, g) => acc + (g.valor || 0), 0);

    const distribuido = distribuidoCategorias + distribuidoContas + distribuidoReserva;

    let estado: PlanejamentoEstado;
    if (renda <= 0) {
      estado = "sem_renda";
    } else if (distribuidoCategorias <= 1 && distribuidoContas <= 0 && distribuidoReserva <= 0) {
      estado = "sem_limites";
    } else if (distribuido > renda + 0.5) {
      estado = "excesso";
    } else if (renda - distribuido <= Math.max(1, renda * 0.01)) {
      estado = "tudo_distribuido";
    } else {
      estado = "com_sobra";
    }

    return {
      renda,
      distribuidoCategorias,
      distribuidoContas,
      distribuidoContasReal,
      distribuidoReserva,
      estado,
    };
  }, [receitas, contasAPagar, guardado, comLimite, ym, incluirContas]);



  // Edit limit dialog
  const [editing, setEditing] = useState<{ id: string; nome: string; valor: string } | null>(
    null,
  );

  function changeMonth(delta: number) {
    const d = new Date(ym.ano, ym.mes - 1 + delta, 1);
    setYm({ ano: d.getFullYear(), mes: d.getMonth() + 1 });
  }

  function openEdit(catId: string, nome: string) {
    const atual = getLimite(catId, ym.mes, ym.ano) ?? 0;
    setEditing({
      id: catId,
      nome,
      valor: atual > 0 ? String(atual).replace(".", ",") : "",
    });
  }

  function saveEdit() {
    if (!editing) return;
    const v = parseBRLInput(editing.valor);
    setLimite(editing.id, v, ym.mes, ym.ano);
    toast.success(v > 0 ? t("toasts.saved", { value: formatBRL(v) }) : t("toasts.removed"));
    setEditing(null);
  }

  function removerLimite(catId: string, nome: string) {
    setLimite(catId, 0, ym.mes, ym.ano);
    toast.success(t("toasts.categoryRemoved", { name: nome }));
  }

  function copiarMesAnterior() {
    const anterior = new Date(ym.ano, ym.mes - 2, 1);
    const ma = anterior.getMonth() + 1;
    const aa = anterior.getFullYear();
    const limitesAnteriores = getLimites().filter((l) => l.mes === ma && l.ano === aa);
    if (limitesAnteriores.length === 0) {
      toast.error(t("toasts.noPrev"));
      return;
    }
    let copiados = 0;
    for (const l of limitesAnteriores) {
      const atual = getLimite(l.tipo, ym.mes, ym.ano);
      if (!atual || atual <= 0) {
        setLimite(l.tipo, l.valor, ym.mes, ym.ano);
        copiados += 1;
      }
    }
    toast.success(
      copiados > 0
        ? t("toasts.copied", { count: copiados })
        : t("toasts.alreadyApplied"),
    );
  }

  if (!ready) return <PageSkeleton wide />;

  return (
    <MobileShell wide>
      <header className="pt-2">
        <div className="flex items-start gap-3">
          <Link
            to="/"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground lg:hidden"
            aria-label={t("back")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              {vocab.orcamentoTitle}
            </p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight lg:text-[26px]">
              {t("pageTitle")}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
              {t("pageSubtitle")}
            </p>
          </div>
          {/* Seletor de mês — desktop: ao lado do título */}
          <div className="hidden shrink-0 items-center gap-1 rounded-full border border-border bg-card p-1 sm:flex">
            <button
              onClick={() => changeMonth(-1)}
              className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={t("prevMonth")}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[7rem] px-2 text-center text-xs font-semibold capitalize sm:text-sm">
              {formatMonthYear(ym.ano, ym.mes)}
            </span>
            <button
              onClick={() => changeMonth(1)}
              className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={t("nextMonth")}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
        {/* Seletor de mês — mobile: linha própria, largura total */}
        <div className="mt-3 flex items-center justify-between rounded-full border border-border bg-card p-1 sm:hidden">
          <button
            onClick={() => changeMonth(-1)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("prevMonth")}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="flex-1 truncate px-2 text-center text-sm font-semibold capitalize">
            {formatMonthYear(ym.ano, ym.mes)}
          </span>
          <button
            onClick={() => changeMonth(1)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("nextMonth")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Estado vazio: nenhum limite configurado neste mês */}
      {!temOrcamento && (limiteTotal ?? 0) <= 0 && (
        <div className="mt-6 space-y-4">
          <EmptyState
            icon={<PieChartIcon className="h-6 w-6" />}
            title={t("empty.title")}
            description={t("empty.subtitle")}
            cta={
              <Button
                onClick={() => openEdit("total", t("totalLimitName"))}
                className="min-h-11 rounded-full px-5"
              >
                <Plus className="mr-1 h-4 w-4" />
                {t("empty.create")}
              </Button>
            }
            secondaryAction={
              <Button
                variant="outline"
                onClick={copiarMesAnterior}
                className="min-h-11 rounded-full px-5"
              >
                <Copy className="mr-1 h-4 w-4" />
                {t("empty.copyPrev")}
              </Button>
            }
          />
          <ol className="mx-auto grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-3">
            {(["category", "limit", "track"] as const).map((key, idx) => (
              <li
                key={key}
                className="flex items-start gap-2 rounded-2xl border border-border/60 bg-card/50 p-3 text-xs"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                  {idx + 1}
                </span>
                <span className="leading-tight">{t(`empty.steps.${key}`)}</span>
              </li>
            ))}
          </ol>
          <p className="mx-auto max-w-md text-center text-[11px] text-muted-foreground">
            {t("empty.helper")}
          </p>
        </div>
      )}


      {/* Resumo superior — só quando já existe algum orçamento ou limite total */}
      {(temOrcamento || (limiteTotal ?? 0) > 0) && (
        <section className="mt-5 grid grid-cols-2 gap-2.5 stagger lg:grid-cols-4">
          <MetricCard
            label={t("summary.planned")}
            value={<Money value={totalPlanejado} className="num" />}
            hint={t("summary.categoriesCount", { count: comLimite.length })}
          />
          <MetricCard
            label={t("summary.spent")}
            value={<Money value={totalRealizado} className="num" />}
            hint={
              totalPlanejado > 0
                ? t("summary.pctOfPlan", { value: Math.round(pctGeral) })
                : undefined
            }
            tone={
              qtdEstouro > 0
                ? "negative"
                : qtdAtencao > 0
                  ? "warning"
                  : "default"
            }
          />
          <MetricCard
            label={diff >= 0 ? t("summary.remaining") : t("summary.excess")}
            value={
              <Money
                value={Math.abs(diff)}
                className={cn("num", diff < 0 && "text-destructive")}
              />
            }
            hint={diff >= 0 ? t("summary.belowPlan") : t("summary.abovePlan")}
            tone={diff < 0 ? "negative" : "positive"}
          />
          <div
            className={cn(
              "flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-card",
              qtdEstouro > 0
                ? "ring-1 ring-destructive/30"
                : qtdAtencao > 0
                  ? "ring-1 ring-warning/30"
                  : "ring-1 ring-success/30",
            )}
          >
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("summary.status")}
            </span>
            <StatusBadge
              tone={
                qtdEstouro > 0
                  ? "destructive"
                  : qtdAtencao > 0
                    ? "warning"
                    : "success"
              }
              dot
              size="md"
              className="self-start"
            >
              {qtdEstouro > 0 ? (
                <AlertTriangle className="h-3.5 w-3.5" />
              ) : qtdAtencao > 0 ? (
                <AlertTriangle className="h-3.5 w-3.5" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {qtdEstouro > 0
                ? t("summary.outOfPlan")
                : qtdAtencao > 0
                  ? t("summary.attention")
                  : t("summary.allGood")}
            </StatusBadge>
            <p className="text-[11px] text-muted-foreground">
              {t("summary.statusBreakdown", {
                ok: qtdOk,
                attention: qtdAtencao,
                exceeded: qtdEstouro,
              })}
            </p>
          </div>
        </section>
      )}

      {/* Limite diário + Previsão lado a lado em desktop */}
      {(temOrcamento || (limiteTotal ?? 0) > 0) && (
        <section className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <OrcamentoLimiteDiarioCard
            tipo={limiteDiarioInfo.tipo}
            valor={limiteDiarioInfo.valor}
            status={limiteDiarioInfo.status}
            diasRestantes={limiteDiarioInfo.diasRestantes}
            labels={{
              title: t("dailyLimit.title"),
              description: t("dailyLimit.description"),
              perDay: t("dailyLimit.perDay"),
              pastMonth: t("dailyLimit.pastMonth"),
              futureMonth: t("dailyLimit.futureMonth"),
              exceeded: t("dailyLimit.exceeded"),
              noBudget: t("dailyLimit.noBudget"),
              remainingDays: t("dailyLimit.remainingDays"),
            }}
          />
          <OrcamentoPrevisaoCard
            tipo={previsaoInfo.tipo}
            gastoProjetado={previsaoInfo.gastoProjetado}
            planejado={previsaoInfo.planejado}
            diferenca={previsaoInfo.diferenca}
            labels={{
              title: t("forecast.title"),
              pastWithin: t("forecast.pastWithin"),
              pastOver: t("forecast.pastOver"),
              future: t("forecast.future"),
              noData: t("forecast.noData"),
              onTrack: t("forecast.onTrack"),
              overRisk: t("forecast.overRisk"),
              overValue: t("forecast.overValue"),
              alreadyOver: t("forecast.alreadyOver"),
              projected: t("forecast.projected"),
              planned: t("forecast.planned"),
              gapPositive: t("forecast.gapPositive"),
              gapNegative: t("forecast.gapNegative"),
            }}
          />
        </section>
      )}

      {/* Planejamento mensal — Orçamento Zero (MVP visual, sem persistência) */}
      <section className="mt-4">
        <PlanejamentoMensalCard
          renda={planejamentoInfo.renda}
          distribuidoCategorias={planejamentoInfo.distribuidoCategorias}
          distribuidoContas={planejamentoInfo.distribuidoContas}
          distribuidoContasReal={planejamentoInfo.distribuidoContasReal}
          distribuidoReserva={planejamentoInfo.distribuidoReserva}
          estado={planejamentoInfo.estado}
          incluirContas={incluirContas}
          onIncluirContasChange={setIncluirContas}
          labels={{
            title: t("planning.title"),
            description: t("planning.description"),
            income: t("planning.income"),
            distributed: t("planning.distributed"),
            unassigned: t("planning.unassigned"),
            excess: t("planning.excess"),
            categories: t("planning.categories"),
            bills: t("planning.bills"),
            reserveGoals: t("planning.reserveGoals"),
            free: t("planning.free"),
            noIncome: t("planning.noIncome"),
            noLimits: t("planning.noLimits"),
            hasBillsNoLimits: t("planning.hasBillsNoLimits"),
            allAssigned: t("planning.allAssigned"),
            withFree: t("planning.withFree"),
            withExcess: t("planning.withExcess"),
            ofIncome: t("planning.ofIncome"),
            includeBills: t("planning.includeBills"),
            includeBillsDescription: t("planning.includeBillsDescription"),
            billsExcludedNote: t("planning.billsExcludedNote"),
            billsDuplicateHint: t("planning.billsDuplicateHint"),
          }}
          suggestionSlot={(() => {
            const { renda, estado, distribuidoCategorias, distribuidoContas, distribuidoReserva } =
              planejamentoInfo;
            const distribuido = distribuidoCategorias + distribuidoContas + distribuidoReserva;
            const livre = renda - distribuido;
            const sobraRelevante = renda > 0 && livre >= renda * 0.2;
            const mostrar =
              renda > 0 &&
              (estado === "sem_limites" || (estado === "com_sobra" && sobraRelevante));
            if (!mostrar) return null;
            return (
              <SugestaoDistribuicaoRenda
                renda={renda}
                labels={{
                  title: t("planning.suggestion.title"),
                  description: t("planning.suggestion.description"),
                  essentials: t("planning.suggestion.essentials"),
                  variables: t("planning.suggestion.variables"),
                  reserve: t("planning.suggestion.reserve"),
                  cta: t("planning.suggestion.cta"),
                  note: t("planning.suggestion.note"),
                }}
                onCta={() => toast(t("planning.suggestion.ctaToast"))}
              />
            );
          })()}
        />

        {/* Link contextual para Relatórios */}
        <div className="mt-2 flex justify-end">
          <Link
            to="/relatorios"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-brand/40 min-h-11 sm:min-h-1"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            {t("planning.viewReports")}
          </Link>
        </div>
      </section>

      {/* Limite total + ações rápidas (só se já há algo configurado) */}
      {(temOrcamento || (limiteTotal ?? 0) > 0) && (
        <section className="mt-4 rounded-3xl border border-border bg-card p-4 shadow-card sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <PieChartIcon className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">{t("totalLimit.title")}</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copiarMesAnterior}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-card-elevated px-3 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                <Copy className="h-3 w-3" />
                {t("totalLimit.copyPrev")}
              </button>
              <button
                type="button"
                onClick={() => openEdit("total", t("totalLimitName"))}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-card-elevated px-3 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                <Pencil className="h-3 w-3" />
                {t("totalLimit.edit")}
              </button>
            </div>
          </div>
          {limiteTotal && limiteTotal > 0 ? (
            <>
              <div className="mt-3 flex items-baseline justify-between">
                <p className="num text-xl font-bold">{formatBRL(totalRealizado)}</p>
                <p className="num text-xs text-muted-foreground">
                  {t("totalLimit.of", { value: formatBRL(limiteTotal) })}
                </p>
              </div>
              <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-card-elevated">
                <div
                  className={cn(
                    "h-full rounded-full transition-all animate-fill",
                    totalRealizado >= limiteTotal
                      ? "bg-destructive"
                      : totalRealizado >= limiteTotal * 0.7
                        ? "bg-warning"
                        : "bg-brand",
                  )}
                  style={{
                    width: `${Math.min(100, (totalRealizado / limiteTotal) * 100)}%`,
                  }}
                />
              </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              {t("totalLimit.none")}
            </p>
          )}
        </section>
      )}

      {/* Lista por categoria com limite */}
      {comLimite.length > 0 && (
        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("list.title")}
            </h2>
            <span className="text-[11px] text-muted-foreground">
              {comLimite.length === 1
                ? t("list.categoryOne", { count: comLimite.length })
                : t("list.categoryOther", { count: comLimite.length })}
            </span>
          </div>

          <ul className="space-y-3 stagger">
            {comLimite.map((l) => (
              <OrcamentoCategoriaCard
                key={l.cat.id}
                linha={l}
                labels={{
                  planned: t("list.plannedMini"),
                  spent: t("list.spentMini"),
                  remaining: t("list.remainingMini"),
                  excess: t("list.excessMini"),
                  used: t("list.used"),
                  ok: t("list.ok"),
                  attention: t("list.attention"),
                  outOfPlan: t("list.outOfPlan"),
                  edit: t("list.edit"),
                  remove: t("list.remove"),
                  removeAria: t("list.removeAria", { name: l.cat.nome }),
                }}
                onEdit={openEdit}
                onRemove={removerLimite}
              />
            ))}
          </ul>
        </section>
      )}

      {/* Categorias sem limite definido (mas com gasto no mês) */}
      {semLimiteComGasto.length > 0 && (
        <section className="mt-5">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("noLimit.title")}
            </h2>
            <span className="text-[11px] text-muted-foreground">
              {semLimiteComGasto.length}
            </span>
          </div>
          <ul className="space-y-2 stagger">
            {semLimiteComGasto.map((l) => (
              <li
                key={l.cat.id}
                className="flex items-center gap-3 rounded-2xl border border-dashed border-border bg-card p-3 transition-colors hover:bg-card-elevated"
              >
                <CategoryIcon categoria={l.cat} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{l.cat.nome}</p>
                  <p className="num text-[11px] text-muted-foreground">
                    {t("noLimit.info", { value: formatBRL(l.realizado) })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0 rounded-full text-xs"
                  onClick={() => openEdit(l.cat.id, l.cat.nome)}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  {t("noLimit.setLimit")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Adicionar categoria ao orçamento — sempre visível quando há orçamento */}
      {temOrcamento && (
        <section className="mt-5 rounded-2xl border border-dashed border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t("addMore.title")}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t("addMore.subtitle")}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {linhas
                  .filter((l) => l.planejado === 0 && l.realizado === 0)
                  .slice(0, 6)
                  .map((l) => (
                    <button
                      key={l.cat.id}
                      type="button"
                      onClick={() => openEdit(l.cat.id, l.cat.nome)}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-card-elevated px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-brand/40"
                    >
                      <Plus className="h-3 w-3" />
                      {l.cat.nome}
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </section>
      )}

      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
        <TrendingUp className="h-3 w-3" />
        {t("footer")}
      </p>

      {/* Dialog editar limite */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.id === "total"
                ? t("dialog.totalTitle")
                : t("dialog.categoryTitle", { name: editing?.nome ?? "" })}
            </DialogTitle>
            <DialogDescription>
              {editing?.id === "total"
                ? t("dialog.descTotal", { period: formatMonthYear(ym.ano, ym.mes) })
                : t("dialog.descCategory", { period: formatMonthYear(ym.ano, ym.mes) })}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="text-xs text-muted-foreground">{t("dialog.value")}</Label>
            <div className="mt-1 flex items-baseline gap-2 rounded-xl bg-card-elevated px-3">
              <span className="text-sm font-semibold text-muted-foreground">R$</span>
              <Input
                inputMode="decimal"
                value={editing?.valor ?? ""}
                onChange={(e) =>
                  setEditing((cur) => (cur ? { ...cur, valor: e.target.value } : cur))
                }
                placeholder="0,00"
                className="num h-11 border-0 bg-transparent p-0 text-lg font-semibold !ring-0 focus-visible:!ring-0"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t("dialog.cancel")}
            </Button>
            <Button onClick={saveEdit}>{t("dialog.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* hint visual reuso categoryColor para evitar warning */}
      <span className="hidden">{categoryColor(undefined)}</span>
    </MobileShell>
  );
}
