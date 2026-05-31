import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { useMesReferenciaRef } from "@/lib/use-mes-referencia";
import {
  ChevronLeft,
  ChevronRight,
  PieChart as PieChartIcon,
  TrendingUp,
  TrendingDown,
  Sparkles,
  Wallet,
  ArrowUp,
  ArrowDown,
  CreditCard,
  CalendarClock,
  Trophy,
  AlertTriangle,
  Target,
  RefreshCw,
  Download,
  Printer,
  CalendarRange,
  Pencil,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { ptBR, enUS } from "date-fns/locale";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  LineChart,
  Line,
} from "recharts";
import { MobileShell } from "@/components/MobileShell";
import { EvolucaoOrcamentoCard, type EvolucaoMes } from "@/components/relatorios/EvolucaoOrcamentoCard";
import {
  TendenciaCategoriasCard,
  type TendenciaCategoria,
  type TendenciaEstado,
} from "@/components/relatorios/TendenciaCategoriasCard";
import { useAuth } from "@/lib/auth-context";
import { tipoEfetivo, type TipoCadastro } from "@/lib/profile-utils";
import { CategoryIcon, categoryColor } from "@/components/CategoryIcon";
import {
  getCategorias,
  getCategoriaById,
  getContasAPagar,
  getGastos,
  getGuardado,
  getLimite,
  getLimites,
  getMovimentacoesMeta,
  getReceitas,
  mesEfetivoGasto,
  useBootstrap,
  useStore,
} from "@/lib/store";
import {
  buildResumoMensal,
  buildComparativo,
  classificarMes,
  gerarInsights,
  gerarResumoTexto,
  mesAnterior,
  fraseDoEstado,
  emojiDoEstado,
  tituloDoEstado,
  corDoEstado,
  type EstadoMes,
} from "@/lib/relatorios";
import {
  buildLinhasOrcamento,
  resumirOrcamento,
} from "@/lib/orcamento";
import { formatBRL, formatBRLCompact, formatMonthYear, parseDateLocal } from "@/lib/format";
import { Money } from "@/components/Money";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios — Gasto Inteligente" },
      {
        name: "description",
        content: "Entenda para onde seu dinheiro foi e como melhorar no próximo mês.",
      },
    ],
  }),
  component: RelatoriosPage,
});

type Periodo = "mes" | "anterior" | "3m" | "6m" | "trimestre" | "semestre" | "ano" | "custom";

function RelatoriosPage() {
  const { t } = useTranslation("relatorios");
  const ready = useBootstrap();
  const { profile } = useAuth();
  const tipo = tipoEfetivo(profile?.tipo_cadastro as TipoCadastro);
  const today = new Date();
  const [ym, setYm] = useMesReferenciaRef() as unknown as [
    { mes: number; ano: number },
    (next: { mes: number; ano: number }) => void,
  ];
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [customRange, setCustomRange] = useState<{ from?: Date; to?: Date }>({});
  const [showResumo, setShowResumo] = useState(false);
  const [resumoSeed, setResumoSeed] = useState(0);

  const gastos = useStore(() => getGastos());
  const receitas = useStore(() => getReceitas());
  const contas = useStore(() => getContasAPagar());
  const movMetas = useStore(() => getMovimentacoesMeta());
  const categorias = useStore(() => getCategorias());
  const guardado = useStore(() => getGuardado());
  // Chave reativa: muda quando qualquer limite é criado, removido OU tem seu valor editado.
  const limitesKey = useStore(() =>
    getLimites()
      .map((l) => `${l.tipo}:${l.mes}:${l.ano}:${l.valor}`)
      .join("|"),
  );

  // Aplicar período → ajusta ym efetivo (mes/anterior afetam o ym)
  useEffect(() => {
    if (periodo === "mes") {
      setYm({ ano: today.getFullYear(), mes: today.getMonth() + 1 });
    } else if (periodo === "anterior") {
      const prev = mesAnterior(today.getMonth() + 1, today.getFullYear());
      setYm({ ano: prev.ano, mes: prev.mes });
    }
    // 3m/6m/ano usam ym só como "mês de referência" para os cards principais
    // mas adicionam um histórico nos gráficos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo]);

  const resumo = useMemo(
    () => buildResumoMensal({ mes: ym.mes, ano: ym.ano, gastos, receitas, contas, movMetas, categorias, guardado }),
    [ym, gastos, receitas, contas, movMetas, categorias, guardado],
  );
  const prev = mesAnterior(ym.mes, ym.ano);
  const resumoAnterior = useMemo(
    () => buildResumoMensal({ mes: prev.mes, ano: prev.ano, gastos, receitas, contas, movMetas, categorias, guardado }),
    [prev, gastos, receitas, contas, movMetas, categorias, guardado],
  );
  const comparativo = useMemo(() => buildComparativo(resumo, resumoAnterior), [resumo, resumoAnterior]);

  // Orçamento do mês
  const linhasOrc = useMemo(
    () =>
      buildLinhasOrcamento(categorias, gastos.filter((g) => g.confirmado !== false), ym.mes, ym.ano, (catId) =>
        getLimite(catId, ym.mes, ym.ano),
        mesEfetivoGasto,
      ),
    [categorias, gastos, ym, limitesKey],
  );
  const resOrc = useMemo(() => resumirOrcamento(linhasOrc), [linhasOrc]);

  const classificacao = useMemo(
    () => classificarMes({ resumo, comparativo, qtdEstouroOrcamento: resOrc.qtdEstouro }),
    [resumo, comparativo, resOrc.qtdEstouro],
  );

  const estouroNomes = resOrc.linhas.filter((l) => l.status === "estouro").map((l) => l.cat.nome);
  const insights = useMemo(
    () =>
      gerarInsights({
        resumo,
        comparativo,
        qtdEstouroOrcamento: resOrc.qtdEstouro,
        qtdDentroOrcamento: resOrc.qtdOk,
        estouroNomes,
      }),
    [resumo, comparativo, resOrc, estouroNomes],
  );

  // Histórico de N meses (para gráfico linha do saldo)
  const historicoMeses = useMemo(() => {
    const stack: Array<{ mes: number; ano: number }> = [];
    if (periodo === "custom" && customRange.from && customRange.to) {
      const from = customRange.from;
      const to = customRange.to;
      let cm = from.getMonth() + 1;
      let ca = from.getFullYear();
      const endKey = to.getFullYear() * 12 + to.getMonth();
      while (ca * 12 + cm - 1 <= endKey) {
        stack.push({ mes: cm, ano: ca });
        cm++;
        if (cm > 12) { cm = 1; ca++; }
        if (stack.length > 36) break;
      }
    } else {
      const n =
        periodo === "6m" || periodo === "semestre" ? 6 :
        periodo === "3m" || periodo === "trimestre" ? 3 :
        periodo === "ano" ? 12 : 6;
      let m = ym.mes, a = ym.ano;
      for (let i = 0; i < n; i++) {
        stack.unshift({ mes: m, ano: a });
        const p = mesAnterior(m, a);
        m = p.mes;
        a = p.ano;
      }
    }
    return stack.map((s) => {
      const r = buildResumoMensal({ mes: s.mes, ano: s.ano, gastos, receitas, contas, movMetas, categorias, guardado });
      return {
        label: new Date(s.ano, s.mes - 1, 1).toLocaleDateString(i18n.language === "en" ? "en-US" : "pt-BR", { month: "short" }).replace(".", "") + (stack.length > 12 ? `/${String(s.ano).slice(-2)}` : ""),
        mes: s.mes,
        ano: s.ano,
        receitas: r.totalReceitas,
        despesas: r.totalDespesas,
        saldo: r.saldo,
      };
    });
  }, [ym, periodo, customRange, gastos, receitas, contas, movMetas, categorias, guardado]);

  // Evolução do orçamento — últimos 6 meses (planejado x realizado)
  const evolucaoOrcamento = useMemo<EvolucaoMes[]>(() => {
    const stack: Array<{ mes: number; ano: number }> = [];
    let m = ym.mes, a = ym.ano;
    for (let i = 0; i < 6; i++) {
      stack.unshift({ mes: m, ano: a });
      const p = mesAnterior(m, a);
      m = p.mes;
      a = p.ano;
    }
    return stack.map((s) => {
      const linhasMes = buildLinhasOrcamento(
        categorias,
        gastos.filter((g) => g.confirmado !== false),
        s.mes,
        s.ano,
        (catId) => getLimite(catId, s.mes, s.ano),
        mesEfetivoGasto,
      );
      const res = resumirOrcamento(linhasMes);
      const label =
        new Date(s.ano, s.mes - 1, 1)
          .toLocaleDateString(i18n.language === "en" ? "en-US" : "pt-BR", { month: "short" })
          .replace(".", "");
      return {
        label,
        mes: s.mes,
        ano: s.ano,
        planejado: res.totalPlanejado,
        realizado: res.totalRealizado,
      };
    });
  }, [ym, categorias, gastos, limitesKey]);

  // Tendência por categoria — Top 5 acumulado nos últimos 6 meses
  const tendenciaCategorias = useMemo<TendenciaCategoria[]>(() => {
    const stack: Array<{ mes: number; ano: number; label: string }> = [];
    let m = ym.mes, a = ym.ano;
    for (let i = 0; i < 6; i++) {
      const label = new Date(a, m - 1, 1)
        .toLocaleDateString(i18n.language === "en" ? "en-US" : "pt-BR", { month: "short" })
        .replace(".", "");
      stack.unshift({ mes: m, ano: a, label });
      const p = mesAnterior(m, a);
      m = p.mes;
      a = p.ano;
    }

    // soma por categoria por mês (apenas gastos confirmados)
    const confirmados = gastos.filter((g) => g.confirmado !== false);
    const porCat = new Map<string, number[]>();
    stack.forEach((_, idx) => {
      confirmados
        .filter((g) => g.mes === stack[idx].mes && g.ano === stack[idx].ano)
        .forEach((g) => {
          const arr = porCat.get(g.categoriaId) ?? new Array(6).fill(0);
          arr[idx] += Number(g.valor) || 0;
          porCat.set(g.categoriaId, arr);
        });
    });

    // Não renderizar se < 2 meses tiveram qualquer gasto
    const mesesComGasto = stack.filter((_, idx) =>
      Array.from(porCat.values()).some((arr) => arr[idx] > 0),
    ).length;
    if (mesesComGasto < 2) return [];

    // Top 5 por total acumulado
    const ranked = Array.from(porCat.entries())
      .map(([catId, serie]) => ({
        catId,
        serie,
        total: serie.reduce((s, v) => s + v, 0),
      }))
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    return ranked.map(({ catId, serie }) => {
      const recentes = serie.slice(3); // últimos 3
      const anteriores = serie.slice(0, 3); // 3 anteriores
      const mediaRecente = recentes.reduce((s, v) => s + v, 0) / 3;
      const mediaAnterior = anteriores.reduce((s, v) => s + v, 0) / 3;
      const diferenca = mediaRecente - mediaAnterior;
      const variacaoPct =
        mediaAnterior > 0 ? (diferenca / mediaAnterior) * 100 : null;

      let estado: TendenciaEstado = "estavel";
      if (mediaAnterior === 0 && mediaRecente > 0) {
        estado = "nova";
      } else if (variacaoPct != null && variacaoPct >= 15 && diferenca >= 30) {
        estado = "subindo";
      } else if (variacaoPct != null && variacaoPct <= -15 && diferenca <= -30) {
        estado = "caindo";
      }

      const cat = getCategoriaById(catId);
      return {
        catId,
        nome: cat?.nome ?? catId,
        serie: serie.map((valor, idx) => ({ label: stack[idx].label, valor })),
        mediaRecente,
        mediaAnterior,
        diferenca,
        variacaoPct,
        estado,
      };
    });
  }, [ym, gastos, categorias, i18n.language]);



  // Totais agregados do período (multi-mês)
  const isMultiPeriod = periodo !== "mes" && periodo !== "anterior";
  const totaisPeriodo = useMemo(() => {
    return historicoMeses.reduce(
      (acc, m) => ({
        receitas: acc.receitas + m.receitas,
        despesas: acc.despesas + m.despesas,
        saldo: acc.saldo + m.saldo,
      }),
      { receitas: 0, despesas: 0, saldo: 0 },
    );
  }, [historicoMeses]);

  const periodoLabel = useMemo(() => {
    if (periodo === "custom" && customRange.from && customRange.to) {
      return `${format(customRange.from, "dd/MM/yyyy")} – ${format(customRange.to, "dd/MM/yyyy")}`;
    }
    if (periodo === "trimestre" || periodo === "3m") return t("period.label3m");
    if (periodo === "semestre" || periodo === "6m") return t("period.label6m");
    if (periodo === "ano") return t("period.label12m");
    return formatMonthYear(ym.ano, ym.mes);
  }, [periodo, customRange, ym, t]);

  function exportCSV() {
    const rows: string[] = [];
    rows.push(t("export.period") + ";" + periodoLabel);
    rows.push("");
    rows.push(`${t("export.month")};${t("export.receitas")};${t("export.despesas")};${t("export.saldo")}`);
    for (const m of historicoMeses) {
      rows.push(`${m.label};${m.receitas.toFixed(2)};${m.despesas.toFixed(2)};${m.saldo.toFixed(2)}`);
    }
    rows.push("");
    rows.push(`${t("export.totals")};${totaisPeriodo.receitas.toFixed(2)};${totaisPeriodo.despesas.toFixed(2)};${totaisPeriodo.saldo.toFixed(2)}`);
    rows.push("");
    rows.push(t("export.gastosCategoria"));
    rows.push(`${t("export.categoria")};${t("export.valor")};${t("export.pct")}`);
    for (const c of resumo.porCategoria) {
      rows.push(`${c.nome};${c.valor.toFixed(2)};${c.pct.toFixed(1)}`);
    }
    const csv = "\uFEFF" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-${periodoLabel.replace(/[^\w-]+/g, "_")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function changeMonth(delta: number) {
    const d = new Date(ym.ano, ym.mes - 1 + delta, 1);
    setYm({ ano: d.getFullYear(), mes: d.getMonth() + 1 });
    setPeriodo("mes"); // navegação manual desativa preset relativo
  }

  if (!ready) {
    return (
      <MobileShell wide>
        <Skeleton className="h-8 w-48" />
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="mt-6 h-72 rounded-2xl" />
      </MobileShell>
    );
  }

  const cores = corDoEstado(classificacao.estado);

  return (
    <MobileShell wide>
      <header className="flex items-start justify-between gap-3 pt-2 animate-rise">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            {t(`title.${tipo}`)}
          </p>
          <h1 className="mt-0.5 text-[26px] font-bold capitalize leading-tight tracking-tight">
            {formatMonthYear(ym.ano, ym.mes)}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(`subtitle.${tipo}`)}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0 rounded-full border border-border bg-card p-1">
          <button
            onClick={() => changeMonth(-1)}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={t("aria.previousMonth")}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => changeMonth(1)}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={t("aria.nextMonth")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Filtros de período + Ações */}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center print:hidden">
        <div className="-mx-1 flex w-full flex-1 min-w-0 gap-2 overflow-x-auto px-1 scrollbar-none">
          {(
            [
              { id: "mes", label: t("period.mes") },
              { id: "anterior", label: t("period.anterior") },
              { id: "trimestre", label: t("period.trimestre") },
              { id: "semestre", label: t("period.semestre") },
              { id: "ano", label: t("period.ano") },
            ] as Array<{ id: Periodo; label: string }>
          ).map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriodo(p.id)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                periodo === p.id
                  ? "border-brand bg-brand-soft text-brand-on-soft"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  "shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                  periodo === "custom"
                    ? "border-brand bg-brand-soft text-brand-on-soft"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                <CalendarRange className="h-3.5 w-3.5" />
                {periodo === "custom" && customRange.from && customRange.to
                  ? `${format(customRange.from, "dd/MM")} – ${format(customRange.to, "dd/MM")}`
                  : t("period.custom")}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                locale={i18n.language === "en" ? enUS : ptBR}
                selected={customRange as any}
                onSelect={(r: any) => {
                  setCustomRange(r ?? {});
                  if (r?.from && r?.to) setPeriodo("custom");
                }}
                numberOfMonths={2}
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> {t("actions.csv")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5">
            <Printer className="h-3.5 w-3.5" /> {t("actions.print")}
          </Button>
        </div>
      </div>

      {/* Totais do período (multi-mês) */}
      {(isMultiPeriod) && historicoMeses.length > 1 && (
        <section className="mt-4 rounded-2xl border border-brand/20 bg-brand-soft/30 p-4 animate-rise">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{t("totals.title")}</p>
              <p className="text-sm font-medium">{t("totals.monthsCount", { period: periodoLabel, count: historicoMeses.length })}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div className="rounded-xl bg-card/60 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("totals.receitas")}</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-success">{formatBRL(totaisPeriodo.receitas)}</p>
            </div>
            <div className="rounded-xl bg-card/60 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("totals.despesas")}</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-destructive">{formatBRL(totaisPeriodo.despesas)}</p>
            </div>
            <div className="rounded-xl bg-card/60 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("totals.saldo")}</p>
              <p className={cn("mt-0.5 text-lg font-bold tabular-nums", totaisPeriodo.saldo < 0 ? "text-destructive" : "text-brand")}>
                {formatBRL(totaisPeriodo.saldo)}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ===== Onboarding / Empty State (somente quando não há nenhum lançamento) ===== */}
      {gastos.length === 0 && receitas.length === 0 && (
        <section className="mt-4 rounded-2xl border border-border/60 bg-card-elevated/60 p-4 animate-rise print:hidden">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("onboarding.title")}
          </p>
          <h2 className="mt-1 text-base font-semibold leading-snug">
            {t("empty.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("onboarding.description")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm" className="min-h-11">
              <Link to="/adicionar">{t("onboarding.cta")}</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="min-h-11">
              <Link to="/">{t("onboarding.secondaryCta")}</Link>
            </Button>
          </div>
          <p className="mt-3 text-[12px] text-muted-foreground">
            {t("onboarding.helper")}
          </p>
        </section>
      )}

      {/* ===== KPIs principais ===== */}
      <SectionLabel>{t("sections.resumo")}</SectionLabel>
      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">

        <Kpi label={t("kpi.receitas")} valor={resumo.totalReceitas} icon={<ArrowUp className="h-4 w-4" />} tone="success" />
        <Kpi label={t("kpi.despesas")} valor={resumo.totalDespesas} icon={<ArrowDown className="h-4 w-4" />} tone="destructive" />
        <Kpi
          label={t("kpi.saldo")}
          valor={resumo.saldo}
          icon={<Wallet className="h-4 w-4" />}
          tone={resumo.saldo < 0 ? "destructive" : "brand"}
        />
        <Kpi label={t("kpi.cartao")} valor={resumo.totalCartao} icon={<CreditCard className="h-4 w-4" />} tone="warning" />
        <Kpi label={t("kpi.contas")} valor={resumo.totalPagoContas} icon={<CalendarClock className="h-4 w-4" />} tone="muted" />
        <Kpi label={t("kpi.guardado")} valor={resumo.totalGuardado} icon={<Target className="h-4 w-4" />} tone="success" />
        <Kpi
          label={t("kpi.maiorGasto")}
          valor={resumo.maiorGasto?.valor ?? 0}
          icon={<Trophy className="h-4 w-4" />}
          tone="muted"
          hint={resumo.maiorGasto?.descricao}
        />
        <Kpi
          label={t("kpi.estouros")}
          valor={resOrc.qtdEstouro}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={resOrc.qtdEstouro > 0 ? "destructive" : "muted"}
          isCount
        />
      </section>

      {/* ===== Comparativo ===== */}
      <SectionLabel>{t("sections.comparativo")}</SectionLabel>
      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <ComparativoCard
          label={t("kpi.receitas")}
          atual={comparativo.receitas.atual}
          anterior={comparativo.receitas.anterior}
          delta={comparativo.receitas.delta}
          inverter={false}
        />
        <ComparativoCard
          label={t("kpi.despesas")}
          atual={comparativo.despesas.atual}
          anterior={comparativo.despesas.anterior}
          delta={comparativo.despesas.delta}
          inverter={true}
        />
        <ComparativoCard
          label={t("kpi.saldo")}
          atual={comparativo.saldo.atual}
          anterior={comparativo.saldo.anterior}
          delta={comparativo.saldo.delta}
          inverter={false}
        />
      </section>

      {(comparativo.maiorAlta || comparativo.maiorReducao) && (
        <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2 animate-fade-in">
          {comparativo.maiorAlta && comparativo.maiorAlta.delta > 0 && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
              <span className="font-medium">{t("comparativo.maiorAlta")}:</span>{" "}
              <span className="text-foreground/90">
                {comparativo.maiorAlta.nome} (+{formatBRL(comparativo.maiorAlta.delta)})
              </span>
            </div>
          )}
          {comparativo.maiorReducao && comparativo.maiorReducao.delta < 0 && (
            <div className="rounded-xl border border-success/30 bg-success/10 p-3 text-sm">
              <span className="font-medium">{t("comparativo.maiorReducao")}:</span>{" "}
              <span className="text-foreground/90">
                {comparativo.maiorReducao.nome} ({formatBRL(comparativo.maiorReducao.delta)})
              </span>
            </div>
          )}
        </div>
      )}

      {/* ===== Gráficos ===== */}
      <SectionLabel>{t("sections.graficos")}</SectionLabel>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ChartCard title={t("chart.gastosCategoria")} icon={<PieChartIcon className="h-4 w-4" />}>
          {resumo.porCategoria.length === 0 ? (
            <EmptyChart label={t("chart.emptyGastos")} />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={resumo.porCategoria.slice(0, 8)}
                    dataKey="valor"
                    nameKey="nome"
                    innerRadius={50}
                    outerRadius={85}
                    paddingAngle={2}
                  >
                    {resumo.porCategoria.slice(0, 8).map((c) => (
                      <Cell key={c.catId} fill={categoryColor(getCategoriaById(c.catId))} />
                    ))}
                  </Pie>
                  <RTooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                    }}
                    formatter={(v: number) => formatBRL(v)}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <ChartCard title={t("chart.receitasDespesas")} icon={<TrendingUp className="h-4 w-4" />}>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={historicoMeses} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
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
                <Bar dataKey="receitas" name={t("kpi.receitas")} fill="var(--success)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="despesas" name={t("kpi.despesas")} fill="var(--destructive)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title={t("chart.evolucaoSaldo")} icon={<Sparkles className="h-4 w-4" />}>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historicoMeses} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
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
                <Line
                  type="monotone"
                  dataKey="saldo"
                  stroke="var(--brand, var(--primary))"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title={t("chart.topCategorias")} icon={<Trophy className="h-4 w-4" />}>
          {resumo.porCategoria.length === 0 ? (
            <EmptyChart label={t("chart.emptyCategorias")} />
          ) : (
            <ul className="space-y-2.5">
              {resumo.porCategoria.slice(0, 5).map((c) => {
                const cat = getCategoriaById(c.catId);
                return (
                  <li key={c.catId} className="animate-fade-in">
                    <div className="flex items-center gap-2 text-sm">
                      <CategoryIcon categoria={cat} size="sm" />
                      <span className="flex-1 truncate font-medium">{c.nome}</span>
                      <span className="tabular-nums">{formatBRL(c.valor)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${Math.min(100, c.pct)}%`, background: categoryColor(cat) }}
                      />
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{t("chart.pctDoMes", { pct: c.pct.toFixed(0) })}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </ChartCard>
      </div>

      {/* ===== Evolução do orçamento (planejado x realizado, 6m) ===== */}
      <EvolucaoOrcamentoCard
        meses={evolucaoOrcamento}
        labels={{
          title: t("budgetEvolution.title"),
          description: t("budgetEvolution.description"),
          planned: t("budgetEvolution.planned"),
          realized: t("budgetEvolution.realized"),
          adherence: t("budgetEvolution.adherence"),
          averageAdherence: t("budgetEvolution.averageAdherence"),
          bestMonth: t("budgetEvolution.bestMonth"),
          biggestOverrun: t("budgetEvolution.biggestOverrun"),
          empty: t("budgetEvolution.empty"),
          overBudget: t("budgetEvolution.overBudget"),
          underBudget: t("budgetEvolution.underBudget"),
        }}
      />

      {/* Link contextual para ajustar limites */}
      <div className="mt-2 flex justify-end">
        <Link
          to="/orcamento"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-brand/40 min-h-11 sm:min-h-1"
        >
          <Pencil className="h-3.5 w-3.5" />
          {t("budgetEvolution.adjustLimits")}
        </Link>
      </div>

      {/* ===== Tendência por categoria (Top 5, 6m) ===== */}
      <TendenciaCategoriasCard
        categorias={tendenciaCategorias}
        labels={{
          title: t("categoryTrends.title"),
          description: t("categoryTrends.description"),
          rising: t("categoryTrends.rising"),
          falling: t("categoryTrends.falling"),
          stable: t("categoryTrends.stable"),
          newTrend: t("categoryTrends.new"),
          recentAverage: t("categoryTrends.recentAverage"),
          change: t("categoryTrends.change"),
          empty: t("categoryTrends.empty"),
        }}
      />



      {/* ===== Top 5 maiores despesas ===== */}
      {resumo.topGastos.length > 0 && (
        <>
          <SectionLabel>{t("sections.topDespesas")}</SectionLabel>
          <ul className="space-y-2">
            {resumo.topGastos.map((g, i) => {
              const cat = getCategoriaById(g.categoriaId);
              return (
                <li
                  key={g.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 animate-fade-in"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className="grid h-8 w-8 place-items-center rounded-full bg-muted text-xs font-bold tabular-nums">
                    {i + 1}
                  </div>
                  <CategoryIcon categoria={cat} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{g.descricao}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {cat?.nome ?? "Outros"} · {parseDateLocal(g.data)?.toLocaleDateString(i18n.language === "en" ? "en-US" : "pt-BR")}
                    </p>
                  </div>
                  <span className="tabular-nums text-sm font-semibold">{formatBRL(g.valor)}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* ===== Insights ===== */}
      <SectionLabel>{t("sections.insights")}</SectionLabel>
      {insights.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
          {t("insights.empty")}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {insights.map((i, idx) => (
            <li
              key={i.id}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-3 text-sm animate-fade-in",
                i.tom === "positivo" && "border-success/30 bg-success/10",
                i.tom === "alerta" && "border-warning/30 bg-warning/10",
                i.tom === "negativo" && "border-destructive/30 bg-destructive/10",
                i.tom === "neutro" && "border-border bg-card",
              )}
              style={{ animationDelay: `${idx * 50}ms` }}
            >
              <span className="text-lg leading-none">{i.emoji}</span>
              <span className="text-foreground/90">{i.texto}</span>
            </li>
          ))}
        </ul>
      )}

      {/* ===== Fechamento do mês ===== */}
      <SectionLabel>{t("sections.fechamento")}</SectionLabel>
      <section
        className={cn(
          "rounded-2xl border bg-card p-5 ring-1 transition-shadow animate-rise",
          cores.ring,
          cores.glow,
        )}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "grid h-14 w-14 place-items-center rounded-2xl text-3xl",
              cores.bg,
              classificacao.estado === "excelente" && "animate-bounce",
              classificacao.estado === "critico" && "animate-pulse",
            )}
          >
            <span>{emojiDoEstado(classificacao.estado)}</span>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("fechamento.estadoMes")}
            </p>
            <h3 className={cn("text-2xl font-bold leading-tight", cores.text)}>
              {tituloDoEstado(classificacao.estado)}
            </h3>
            <p className="text-xs text-muted-foreground">{t("fechamento.pontuacao", { pontuacao: classificacao.pontuacao })}</p>
          </div>
        </div>

        <p className="mt-3 text-sm text-foreground/90">
          {fraseDoEstado(classificacao.estado, ym.mes + ym.ano + resumoSeed)}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <FechRow label={t("fechamento.entradas")} valor={resumo.totalReceitas} />
          <FechRow label={t("fechamento.saidas")} valor={resumo.totalDespesas} />
          <FechRow label={t("fechamento.saldoFinal")} valor={resumo.saldo} highlight />
          <FechRow label={t("fechamento.guardado")} valor={resumo.totalGuardado} />
          <FechRow label={t("fechamento.contasPagas")} valor={resumo.qtdContasPagas} isCount />
          <FechRow label={t("fechamento.contasPendentes")} valor={resumo.qtdContasPendentes + resumo.qtdContasAtrasadas} isCount />
          <FechRow label={t("fechamento.orcEstourados")} valor={resOrc.qtdEstouro} isCount />
          <FechRow
            label={t("fechamento.melhorCategoria")}
            text={resOrc.linhas.find((l) => l.status === "ok" && l.planejado > 0)?.cat.nome ?? t("fechamento.none")}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => {
              setShowResumo(true);
              setResumoSeed((s) => s + 1);
            }}
            className="gap-2"
          >
            <Sparkles className="h-4 w-4" />
            {t("actions.generateSummary")}
          </Button>
          {showResumo && (
            <Button variant="ghost" size="sm" onClick={() => setResumoSeed((s) => s + 1)} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> {t("actions.anotherVersion")}
            </Button>
          )}
        </div>

        {showResumo && (
          <div
            key={resumoSeed}
            className="mt-4 rounded-xl border border-border/60 bg-background/50 p-4 text-sm leading-relaxed text-foreground/90 animate-fade-in"
          >
            {gerarResumoTexto({ resumo, classificacao })}
          </div>
        )}
      </section>

      <div className="h-12" />
    </MobileShell>
  );
}

// ============================================================
// SUBCOMPONENTS
// ============================================================

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-6 mb-2.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </h2>
  );
}

function Kpi({
  label,
  valor,
  icon,
  tone,
  hint,
  isCount,
}: {
  label: string;
  valor: number;
  icon: React.ReactNode;
  tone: "success" | "destructive" | "brand" | "warning" | "muted";
  hint?: string;
  isCount?: boolean;
}) {
  const toneCls = {
    success: "text-success",
    destructive: "text-destructive",
    brand: "text-brand",
    warning: "text-warning",
    muted: "text-foreground",
  }[tone];
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5 transition-all hover-lift animate-rise">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <span className={toneCls}>{icon}</span>
        {label}
      </div>
      <div className={cn("mt-1.5 text-lg font-bold tabular-nums leading-tight", toneCls)}>
        {isCount ? <Money value={valor} duration={500} /> : <Money value={valor} />}
      </div>
      {hint && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ComparativoCard({
  label,
  atual,
  anterior,
  delta,
  inverter,
}: {
  label: string;
  atual: number;
  anterior: number;
  delta: number;
  inverter: boolean; // se true, alta = ruim (despesas)
}) {
  const { t } = useTranslation("relatorios");
  const subiu = delta > 0;
  // Para despesas: subiu = ruim. Para receitas/saldo: subiu = bom.
  const positivo = inverter ? !subiu : subiu;
  const Icon = subiu ? TrendingUp : TrendingDown;
  const tone = delta === 0 ? "muted" : positivo ? "success" : "destructive";
  const toneCls = {
    success: "text-success bg-success/10 border-success/30",
    destructive: "text-destructive bg-destructive/10 border-destructive/30",
    muted: "text-muted-foreground bg-muted border-border",
  }[tone];
  const pct =
    Math.abs(anterior) > 0.005
      ? (delta / Math.abs(anterior)) * 100
      : atual !== 0
        ? null
        : 0;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 animate-rise">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1 text-2xl font-bold tabular-nums">{formatBRL(atual)}</div>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("comparativo.anterior", { valor: formatBRL(anterior) })}</p>
      <div className={cn("mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", toneCls)}>
        <Icon className="h-3.5 w-3.5" />
        {delta === 0
          ? t("comparativo.noChange")
          : `${subiu ? "+" : ""}${formatBRL(delta)}${pct !== null ? ` · ${subiu ? "+" : ""}${pct.toFixed(1)}%` : ""}`}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-card p-4 animate-rise">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="text-brand">{icon}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="grid h-64 place-items-center text-sm text-muted-foreground">{label}</div>
  );
}

function FechRow({
  label,
  valor,
  text,
  isCount,
  highlight,
}: {
  label: string;
  valor?: number;
  text?: string;
  isCount?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-background/40 p-3",
        highlight && "border-brand/30 bg-brand-soft/40",
      )}
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-bold tabular-nums">
        {text !== undefined ? text : isCount ? Math.round(valor ?? 0) : formatBRL(valor ?? 0)}
      </p>
    </div>
  );
}
