import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useMesReferenciaRef } from "@/lib/use-mes-referencia";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  AlertTriangle,
  Receipt as ReceiptIcon,
  Wallet,
  Target,
  ArrowDown,
  ArrowUp,
  Sparkles,
  Lock,
  PieChart as PieChartIcon,
  CalendarClock,
  Clock,
  Bell,
  HandCoins,
  ShieldCheck,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { MobileMonthSummary } from "@/components/MobileMonthSummary";
import { CalendarioFinanceiro } from "@/components/CalendarioFinanceiro";
import { CategoryIcon, categoryColor } from "@/components/CategoryIcon";
import { TransactionAvatar } from "@/components/TransactionAvatar";
import { FluxoCaixaChart } from "@/components/FluxoCaixaChart";
import { DashboardCartoesInsights } from "@/components/DashboardCartoesInsights";
import { SmartLimiteCard } from "@/components/SmartLimiteCard";
import { SmartMonthSummaryCard } from "@/components/SmartMonthSummaryCard";
import { AvisoWhatsAppBanner } from "@/components/AvisoWhatsAppBanner";
import { AvisoTrialExpirandoBanner } from "@/components/AvisoTrialExpirandoBanner";
import { UpgradeCardsList } from "@/components/UpgradeCardsList";
import {
  contaPertenceAoMesRef,
  getCartoes,
  getCategoriaById,
  getCategorias,
  getContasAPagar,
  getGastos,
  getGuardado,
  getLimite,
  getLimites,
  getMetaProgressoBreakdown,
  getMetas,
  getReceitas,
  mesEfetivoGasto,
  statusContaEfetivo,
  statusMeta,
  useBootstrap,
  useStore,
} from "@/lib/store";
import { formatBRL, formatBRLCompact, formatMonthYear } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/Money";
import { NotificationBell } from "@/components/NotificationBell";
import { DashboardAlertasBloco } from "@/components/DashboardAlertasBloco";
import { DashboardDicasBloco } from "@/components/DashboardDicasBloco";
import { AdSlot } from "@/components/AdSlot";
import { DashboardSaudeFinanceiraCard } from "@/components/DashboardSaudeFinanceiraCard";
import { DashboardDiagnosticoMensalCard } from "@/components/DashboardDiagnosticoMensalCard";
import { RadarEconomicoCard } from "@/components/RadarEconomicoCard";
import { RadarEconomicoInteligenteCard } from "@/components/dashboard/RadarEconomicoInteligenteCard";
import { EconomicMonthImpactCard } from "@/components/dashboard/EconomicMonthImpactCard";
import { PrimeirosPassosCard } from "@/components/dashboard/PrimeirosPassosCard";
import { useRecorrencias } from "@/lib/recorrencias";
import { buildResumoAlertas } from "@/lib/alertas-contas";
import { buildLinhasOrcamento, resumirOrcamento } from "@/lib/orcamento";
import type { Categoria, ContaAPagar, Gasto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { getVocab, type TipoCadastro } from "@/lib/profile-utils";
import { makeRevenueT, revenueSuffix } from "@/lib/revenue-vocab";
import { AuthGate } from "@/components/AuthGate";
import { BrandLoader } from "@/components/BrandLoader";
import {
  isLoginBioBridgeAvailable,
  isLoginBioEnabled,
  isLoginBioInProgress,
  isLoginBioUnlockRequired,
} from "@/lib/biometric-login";
import { AdminMasterBadge } from "@/components/AdminMasterBadge";
import { AppModuleBanner, AppEmptyStateVisual, AppActionCard } from "@/components/app-v2";
import { Button } from "@/components/ui/button";



export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "Gasto Inteligente" },
      { name: "robots", content: "noindex,nofollow" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
    ],
  }),
  component: AppRoot,
});

function AppRoot() {
  const { t } = useTranslation("dashboard");
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const needsBiometricUnlock = !!session && isLoginBioUnlockRequired();
  const bioLoginInProgress = isLoginBioInProgress();
  const shouldShowBiometricLogin =
    !session && !bioLoginInProgress && isLoginBioBridgeAvailable() && isLoginBioEnabled();

  useEffect(() => {
    if (loading) return;
    if (needsBiometricUnlock) {
      void navigate({ to: "/login", replace: true });
      return;
    }
    if (shouldShowBiometricLogin) {
      void navigate({ to: "/login", replace: true });
      return;
    }
    if (!session) {
      // Sessão ausente numa rota privada → envia para /login (o AuthGate
      // interno também cobre, mas isso evita flash de conteúdo).
      void navigate({ to: "/login", replace: true });
    }
  }, [loading, session, needsBiometricUnlock, shouldShowBiometricLogin, navigate]);

  if (loading) return <BrandLoader message={null} />;
  if (!session && bioLoginInProgress)
    return <BrandLoader message={t("loader.biometricValidating")} />;
  if (needsBiometricUnlock) return <BrandLoader message={t("loader.biometricValidating")} />;
  if (shouldShowBiometricLogin) return <BrandLoader message={t("loader.biometricOpening")} />;
  if (!session) return <BrandLoader message={null} />;
  return (
    <AuthGate>
      <Index />
    </AuthGate>
  );
}

function Index() {
  const { t: tBase } = useTranslation("dashboard");
  const ready = useBootstrap();
  const { profile } = useAuth();
  // Vocabulário contextual: MEI/Empresa veem variantes "_mei"/"_empresa"
  // de chaves do dashboard quando definidas (ex.: minhaRenda.title).
  const t = useMemo(
    () => makeRevenueT(tBase, revenueSuffix(profile?.tipo_cadastro as TipoCadastro)),
    [tBase, profile?.tipo_cadastro],
  );
  const today = new Date();
  const [ym, setYm] = useMesReferenciaRef() as unknown as [
    { mes: number; ano: number },
    (next: { mes: number; ano: number }) => void,
  ];

  const gastos = useStore(() => getGastos());
  const receitas = useStore(() => getReceitas());
  const guardado = useStore(() => getGuardado());
  const metas = useStore(() => getMetas());
  const contas = useStore(() => getContasAPagar());
  const categorias = useStore(() => getCategorias());
  const cartoes = useStore(() => getCartoes());
  const limiteTotal = useStore(() => getLimite("total", ym.mes, ym.ano));
  // Re-render quando limites mudam
  useStore(() => getLimites().length);

  const gastosConfirmados = useMemo(() => gastos.filter((g) => g.confirmado !== false), [gastos]);
  const doMes = useMemo(
    () =>
      gastosConfirmados.filter((g) => {
        const eff = mesEfetivoGasto(g);
        return eff.mes === ym.mes && eff.ano === ym.ano;
      }),
    [gastosConfirmados, ym],
  );
  const receitasMes = useMemo(
    () => receitas.filter((r) => r.mes === ym.mes && r.ano === ym.ano),
    [receitas, ym],
  );

  const total = useMemo(() => doMes.reduce((s, g) => s + g.valor, 0), [doMes]);

  // Total de despesas do mês anterior (para comparação no insight).
  const totalMesAnterior = useMemo(() => {
    const ref = new Date(ym.ano, ym.mes - 2, 1);
    const m = ref.getMonth() + 1;
    const a = ref.getFullYear();
    return gastosConfirmados
      .filter((g) => {
        const eff = mesEfetivoGasto(g);
        return eff.mes === m && eff.ano === a;
      })
      .reduce((s, g) => s + g.valor, 0);
  }, [gastosConfirmados, ym]);

  const navigateRoot = useNavigate();
  const abrirFatura = (cartaoId: string) => {
    navigateRoot({ to: "/cartoes", search: { abrir: cartaoId } });
  };
  useEffect(() => {
    if (typeof window === "undefined" || window.localStorage.getItem("gf:debug-finance") !== "1")
      return;
    const importados = gastosConfirmados.filter((g) => String(g.origem ?? "").includes("fatura"));
    console.info("[financeiro:dashboard] resumo", {
      totalAnalisados: gastos.length,
      confirmados: gastosConfirmados.length,
      mes: ym.mes,
      ano: ym.ano,
      importadosEncontrados: importados,
      importadosConsiderados: doMes.filter((g) => String(g.origem ?? "").includes("fatura")),
      importadosIgnorados: importados
        .filter((g) => !doMes.some((m) => m.id === g.id))
        .map((g) => ({
          id: g.id,
          descricao: g.descricao,
          valor: g.valor,
          data: g.data,
          mes: g.mes,
          ano: g.ano,
        })),
    });
  }, [gastos, gastosConfirmados, doMes, ym]);
  const totalEntradas = useMemo(() => receitasMes.reduce((s, r) => s + r.valor, 0), [receitasMes]);
  const saldo = totalEntradas - total;

  const totalGuardado = useMemo(() => guardado.reduce((s, g) => s + g.valor, 0), [guardado]);
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
        .sort((a, b) => (a.data < b.data ? 1 : -1) || (a.criadoEm < b.criadoEm ? 1 : -1))
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
  const usoLimite = limiteTotal && limiteTotal > 0 ? Math.min(150, (total / limiteTotal) * 100) : 0;
  const proximoLimite = limiteTotal && total >= limiteTotal * 0.8;
  const passouLimite = limiteTotal && total > limiteTotal;
  const resumoAlertasDashboard = useMemo(() => buildResumoAlertas(contas), [contas]);
  const temAlertasDashboard = resumoAlertasDashboard.totalRelevantes > 0;
  const temOrcamentoMes = useMemo(() => {
    const linhas = buildLinhasOrcamento(
      categorias,
      gastosConfirmados,
      ym.mes,
      ym.ano,
      (catId) => getLimite(catId, ym.mes, ym.ano),
      mesEfetivoGasto,
    );
    return resumirOrcamento(linhas).temOrcamento;
  }, [categorias, gastosConfirmados, ym]);

  // Contas a pagar do mês
  const contasResumo = useMemo(() => {
    const hojeISO = new Date().toISOString().slice(0, 10);
    const doMes = contas.filter((c) => contaPertenceAoMesRef(c, ym.mes, ym.ano));
    let pendente = 0;
    let atrasadasCount = 0;
    let pendentesCount = 0;
    let proxima: (typeof doMes)[number] | null = null;
    for (const c of doMes) {
      const s = statusContaEfetivo(c, hojeISO);
      if (s === "pago") continue;
      pendente += c.valor;
      if (s === "atrasado") atrasadasCount++;
      else pendentesCount++;
      if (!proxima || c.dataVencimento < proxima.dataVencimento) proxima = c;
    }
    let diasParaProxima: number | null = null;
    if (proxima) {
      const v = new Date(proxima.dataVencimento + "T00:00:00").getTime();
      const h = new Date(hojeISO + "T00:00:00").getTime();
      diasParaProxima = Math.round((v - h) / (1000 * 60 * 60 * 24));
    }
    return {
      pendente,
      atrasadasCount,
      pendentesCount,
      total: doMes.length,
      proxima,
      diasParaProxima,
    };
  }, [contas, ym]);

  // Metas
  const metasAndamento = useMemo(() => metas.filter((m) => statusMeta(m) !== "concluida"), [metas]);
  const metaProxima = useMemo(() => {
    let alvo: (typeof metas)[number] | null = null;
    let alvoBreakdown: ReturnType<typeof getMetaProgressoBreakdown> | null = null;
    let melhorPct = -1;
    for (const m of metasAndamento) {
      const bd = getMetaProgressoBreakdown(m.id);
      const p = m.valorObjetivo > 0 ? bd.total / m.valorObjetivo : 0;
      if (p > melhorPct && p < 1) {
        melhorPct = p;
        alvo = m;
        alvoBreakdown = bd;
      }
    }
    // Se nenhuma incompleta, pega a de maior progresso geral
    if (!alvo) {
      for (const m of metasAndamento) {
        const bd = getMetaProgressoBreakdown(m.id);
        const p = m.valorObjetivo > 0 ? bd.total / m.valorObjetivo : 0;
        if (p > melhorPct) {
          melhorPct = p;
          alvo = m;
          alvoBreakdown = bd;
        }
      }
    }
    return alvo ? { meta: alvo, breakdown: alvoBreakdown! } : null;
    // guardado também influencia o cálculo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metasAndamento, guardado]);

  function changeMonth(delta: number) {
    const d = new Date(ym.ano, ym.mes - 1 + delta, 1);
    setYm({ ano: d.getFullYear(), mes: d.getMonth() + 1 });
  }

  const isEmpty =
    gastos.length === 0 && receitas.length === 0 && guardado.length === 0 && metas.length === 0;

  if (!ready) return <DashboardSkeleton />;

  if (isEmpty) {
    return (
      <MobileShell wide>
        <div className="pt-2 animate-rise">
          <AppModuleBanner
            tone="relatorios"
            priority
            title={t("empty.banner.title")}
            subtitle={t("empty.banner.subtitle")}
          />
        </div>

        <header className="mt-5">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {t("empty.eyebrow")}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{t("empty.title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("empty.subtitle")}</p>
        </header>

        <AppEmptyStateVisual
          className="mt-5"
          tone="relatorios"
          icon={<Sparkles className="h-5 w-5" />}
          title={t("empty.title")}
          description={t("empty.subtitle")}
        />

        <section
          className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2"
          aria-label={t("empty.eyebrow")}
        >
          <Link
            to="/adicionar"
            search={{ tipo: "receita" }}
            className="block focus-visible:outline-none"
          >
            <AppActionCard
              tone="receitas"
              icon={<ArrowUp className="h-5 w-5" />}
              title={t("empty.cards.salario")}
              description={t("empty.descriptions.salario")}
            />
          </Link>
          <Link
            to="/adicionar"
            search={{ tipo: "gasto" }}
            className="block focus-visible:outline-none"
          >
            <AppActionCard
              tone="gastos"
              icon={<Plus className="h-5 w-5" />}
              title={t("empty.cards.gasto")}
              description={t("empty.descriptions.gasto")}
            />
          </Link>
          <Link to="/guardado" className="block focus-visible:outline-none">
            <AppActionCard
              tone="cofre"
              icon={<Wallet className="h-5 w-5" />}
              title={t("empty.cards.guardado")}
              description={t("empty.descriptions.guardado")}
            />
          </Link>
          <Link to="/metas" className="block focus-visible:outline-none">
            <AppActionCard
              tone="metas"
              icon={<Target className="h-5 w-5" />}
              title={t("empty.cards.meta")}
              description={t("empty.descriptions.meta")}
            />
          </Link>
        </section>

        <AdSlot className="mt-5" slotId="dashboard-middle" />

        <p className="mt-8 text-center text-xs text-muted-foreground">{t("empty.footer")}</p>

      </MobileShell>
    );
  }

  const monthSwitcher = (
    <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
      <button
        onClick={() => changeMonth(-1)}
        className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={t("monthSwitcher.prev")}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        onClick={() => changeMonth(1)}
        className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={t("monthSwitcher.next")}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <MobileShell wide>
      <header className="flex items-center justify-between pt-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {getVocab(profile?.tipo_cadastro as TipoCadastro).dashboardEyebrow}
          </p>
          <h1 className="mt-0.5 flex items-center gap-2 text-[18px] font-bold leading-tight tracking-tight sm:text-xl lg:text-[22px]">
            {new Date().getHours() < 12
              ? t("hero.greetingMorning")
              : new Date().getHours() < 18
                ? t("hero.greetingAfternoon")
                : t("hero.greetingEvening")}
            {(profile?.nome ?? "").trim().split(/\s+/)[0] ? `, ${(profile?.nome ?? "").trim().split(/\s+/)[0]}` : ""}
            <AdminMasterBadge className="mt-0.5" />
          </h1>
          <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-card-elevated/70 px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
            <CalendarClock className="h-3 w-3" />
            {formatMonthYear(ym.ano, ym.mes)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="lg:hidden">{monthSwitcher}</div>
          <div className="hidden lg:block">
            <NotificationBell />
          </div>
        </div>
      </header>

      <div className="mt-5 lg:hidden">
        <MobileMonthSummary
          ano={ym.ano}
          mes={ym.mes}
          saldo={saldo}
          receitas={totalEntradas}
          despesas={total}
          guardado={totalGuardado}
          aPagar={contasResumo.pendente}
          atrasadasCount={contasResumo.atrasadasCount}
          pendentesCount={contasResumo.pendentesCount}
          onPrev={() => changeMonth(-1)}
          onNext={() => changeMonth(1)}
        />
      </div>

      <div className="mt-6 flex items-center justify-between gap-4">
        <SectionLabel>{t("kpi.saldo")}</SectionLabel>
        <div className="hidden lg:block">{monthSwitcher}</div>
      </div>

      {/* LINHA 2 — KPIs: Saldo maior + Receitas / Despesas / A pagar */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12 xl:gap-4">
        <div className="sm:col-span-2 xl:col-span-5">
          <SaldoHeroCard saldo={saldo} entradas={totalEntradas} despesas={total} />
        </div>
        <div className="xl:col-span-3 xl:col-start-6">
          <KpiCard
            label={t("kpi.receitas")}
            valueNum={totalEntradas}
            tone="success"
            icon={<ArrowUp className="h-4 w-4" />}
          />
        </div>
        <div className="xl:col-span-2">
          <KpiCard
            label={t("kpi.despesas")}
            valueNum={total}
            tone="destructive"
            icon={<ArrowDown className="h-4 w-4" />}
          />
        </div>
        <div className="xl:col-span-2">
          <KpiCard
            label={t("kpi.aPagar")}
            valueNum={contasResumo.pendente}
            tone="warning"
            icon={<Clock className="h-4 w-4" />}
            hint={
              contasResumo.atrasadasCount > 0
                ? `${contasResumo.atrasadasCount} ${t("kpi.atrasada")}`
                : contasResumo.pendentesCount > 0
                  ? `${contasResumo.pendentesCount} ${t("kpi.pendente")}`
                  : t("kpi.tudoEmDia")
            }
          />
        </div>
      </section>

      {/* LINHA 3 — Ações rápidas */}
      <QuickActionsBar />

      <SectionLabel>{t("sections.radar")}</SectionLabel>

      {/* LINHA 4 — Fluxo de caixa (8/12) + coluna empilhada Resumo + Alertas (4/12) */}
      <section className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-8">
          <FluxoCaixaChart
            ano={ym.ano}
            mes={ym.mes}
            gastos={gastosConfirmados}
            receitas={receitas}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
          <SmartMonthSummaryCard mes={ym.mes} ano={ym.ano} />
          <DashboardAlertasBloco />
        </div>
      </section>

      {/* LINHA 5 — Saúde financeira + Diagnóstico consolidados (7/12) + Dicas (5/12) */}
      <section className="mt-4 grid grid-cols-1 items-stretch gap-4 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-7">
          <section className="h-full rounded-2xl border border-border bg-card p-4 shadow-card motion-safe:animate-rise">
            <DashboardSaudeFinanceiraCard embedded />
            <div className="my-4 h-px w-full bg-border/70" />
            <DashboardDiagnosticoMensalCard embedded />
          </section>
        </div>
        <div className="min-w-0 xl:col-span-5">
          <DashboardDicasBloco className="h-full" />
        </div>
      </section>


      {/* LINHA 7 — Radar econômico + Indicadores do Banco Central */}
      <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-5">
          <RadarEconomicoCard />
        </div>
        <div className="min-w-0 xl:col-span-7">
          <RadarEconomicoInteligenteCard />
        </div>
      </section>

      {/* LINHA 8 — Maiores gastos + Categorias / Cartões */}
      <SectionLabel>{t("sections.categoriasCartoes")}</SectionLabel>
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-7">
          <DashboardCartoesInsights
            mes={ym.mes}
            ano={ym.ano}
            gastosMes={doMes}
            totalMes={total}
            totalMesAnterior={totalMesAnterior}
            maiorCategoria={maior ?? null}
            onAbrirFatura={abrirFatura}
            slot="lists"
          />
        </div>
        <div className="min-w-0 xl:col-span-5">
          <DashboardCartoesInsights
            mes={ym.mes}
            ano={ym.ano}
            gastosMes={doMes}
            totalMes={total}
            totalMesAnterior={totalMesAnterior}
            maiorCategoria={maior ?? null}
            onAbrirFatura={abrirFatura}
            slot="insights"
          />
        </div>
      </section>

      {/* LINHA 9 — Transações recentes + Calendário financeiro */}
      <SectionLabel>{t("sections.visao")}</SectionLabel>
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-7">
          <RecentTransactionsCard ultimos={ultimos} />
        </div>
        <div className="min-w-0 xl:col-span-5">
          <CalendarioFinanceiro ano={ym.ano} mes={ym.mes} onChangeMonth={changeMonth} />
        </div>
      </section>

      {/* LINHA 10 — Resumo do mês + Limite inteligente */}
      <SectionLabel>{t("sections.resumoOrcamento")}</SectionLabel>
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="min-w-0">
          <ResumoMesCard
            mes={ym.mes}
            ano={ym.ano}
            saldo={saldo}
            totalEntradas={totalEntradas}
            totalGastos={total}
            maiorCategoria={maior ?? null}
            categorias={categorias}
            gastosConfirmados={gastosConfirmados}
            contasAtrasadas={contasResumo.atrasadasCount}
            limiteTotal={limiteTotal}
          />
        </div>
        <div className="min-w-0">
          <SmartLimiteCard
            mes={ym.mes}
            ano={ym.ano}
            totalEntradas={totalEntradas}
            totalGastos={total}
          />
        </div>
      </section>

      {/* Orçamento, alertas de contas, limite mensal, renda e primeiros passos */}
      <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="min-w-0 space-y-4">
          {temOrcamentoMes && (
            <OrcamentoCard
              categorias={categorias}
              gastos={gastosConfirmados}
              mes={ym.mes}
              ano={ym.ano}
            />
          )}
          {temAlertasDashboard && <AlertasContasCard contas={contas} />}
        </div>
        <div className="min-w-0 space-y-4">
          {!!limiteTotal && (
            <LimiteMensalCard
              total={total}
              limiteTotal={limiteTotal}
              usoLimite={usoLimite}
              passouLimite={!!passouLimite}
              proximoLimite={!!proximoLimite}
            />
          )}
          <MinhaRendaCard totalEntradas={totalEntradas} ano={ym.ano} mes={ym.mes} />
          <PrimeirosPassosCard
            gastosCount={gastos.length}
            receitasCount={receitas.length}
            cartoesCount={cartoes.length}
            metasCount={metas.length}
          />
          <EconomicMonthImpactCard
            saldo={saldo}
            receitas={totalEntradas}
            despesas={total}
            contasVencidas={contasResumo.atrasadasCount}
          />
        </div>
      </section>

      {/* LINHA 11 — Controle financeiro */}
      <SectionLabel>{t("sections.controle")}</SectionLabel>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:gap-4">
        <Link
          to="/orcamento"
          className="flex flex-col gap-2 rounded-3xl border border-border bg-card p-4 transition-colors hover:bg-card-elevated"
        >
          <PieChartIcon className="h-5 w-5 text-brand" />
          <p className="text-sm font-semibold">{t("atalhos.orcamentoEyebrow")}</p>
        </Link>
        <Link
          to="/guardado"
          className="flex flex-col gap-2 rounded-3xl border border-border bg-card p-4 transition-colors hover:bg-card-elevated"
        >
          <Wallet className="h-5 w-5 text-brand" />
          <p className="text-sm font-semibold">{t("atalhos.guardadoEyebrow")}</p>
        </Link>
        <div className="flex flex-col gap-2 rounded-3xl border border-border bg-card p-4">
          <Lock className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm font-semibold">{t("atalhos.fixosEyebrow")}</p>
        </div>
        <Link
          to="/metas"
          className="flex flex-col gap-2 rounded-3xl border border-border bg-card p-4 transition-colors hover:bg-card-elevated"
        >
          <Target className="h-5 w-5 text-brand" />
          <p className="text-sm font-semibold">{t("atalhos.metasEyebrow")}</p>
        </Link>
      </section>

      <AvisoTrialExpirandoBanner />
      <UpgradeCardsList max={4} />
      <AvisoWhatsAppBanner />
    </MobileShell>


  );
}

/* ====================== Helpers de UI ====================== */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2.5 mt-5 flex items-center gap-2.5 px-1 sm:mt-5 lg:mb-3 lg:mt-6">
      <span aria-hidden className="h-3.5 w-1 rounded-full bg-brand" />
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {children}
      </h2>
    </div>
  );
}


function SaldoHeroCard({
  saldo,
  entradas,
  despesas,
}: {
  saldo: number;
  entradas: number;
  despesas: number;
}) {
  const { t } = useTranslation("dashboard");
  const negativo = saldo < 0;
  const pctReceita =
    entradas > 0 ? Math.min(100, Math.max(0, ((entradas - despesas) / entradas) * 100)) : 0;
  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-card p-3.5 shadow-elevated animate-rise sm:p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(110%_75%_at_0%_0%,var(--brand-soft),transparent_60%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-16 -right-10 h-40 w-40 rounded-full bg-brand/20 blur-3xl"
      />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t("kpi.saldo")}
          </p>
          <Money
            value={saldo}
            className={cn(
              "num mt-1.5 block text-[28px] font-bold leading-none tracking-tight sm:text-[32px]",
              negativo ? "text-destructive" : "text-foreground",
            )}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">{t("kpi.saldoNoMes")}</p>
        </div>
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand-on-soft">
          <Wallet className="h-5 w-5" />
        </span>
      </div>

      {/* Mini-barra entradas vs saídas */}
      <div className="relative mt-4">
        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-card-elevated">
          <div
            className="h-full bg-success transition-all"
            style={{
              width: `${entradas + despesas === 0 ? 0 : (entradas / (entradas + despesas)) * 100}%`,
            }}
          />
          <div
            className="h-full bg-destructive/80 transition-all"
            style={{
              width: `${entradas + despesas === 0 ? 0 : (despesas / (entradas + despesas)) * 100}%`,
            }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-success" />
            <span className="num font-semibold text-foreground">{formatBRLCompact(entradas)}</span>
          </span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span className="num font-semibold text-foreground">{formatBRLCompact(despesas)}</span>
            <span className="h-2 w-2 rounded-full bg-destructive/80" />
          </span>
        </div>
      </div>

      {entradas > 0 && !negativo && (
        <p className="num relative mt-3 text-[11px] text-muted-foreground">
          {t("kpi.receitaPreservada", { pct: Math.round(pctReceita) })}
        </p>
      )}
    </div>
  );
}

function QuickActionsBar() {
  const { t } = useTranslation("dashboard");
  const items: Array<{
    to: string;
    label: string;
    icon: React.ReactNode;
    tone: "primary" | "success" | "warning" | "brand";
  }> = [
    {
      to: "/adicionar",
      label: t("quickActions.novoGasto"),
      icon: <Plus className="h-4 w-4" />,
      tone: "primary",
    },
    {
      to: "/renda",
      label: t("quickActions.novaReceita"),
      icon: <ArrowUp className="h-4 w-4" />,
      tone: "success",
    },
    {
      to: "/cartoes",
      label: t("quickActions.importar"),
      icon: <ReceiptIcon className="h-4 w-4" />,
      tone: "warning",
    },
    {
      to: "/gasto-ai",
      label: t("quickActions.ia"),
      icon: <Sparkles className="h-4 w-4" />,
      tone: "brand",
    },
  ];
  const toneRing: Record<string, string> = {
    primary: "bg-primary/15 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    brand: "bg-brand-soft text-brand-on-soft",
  };
  return (
    <nav
      aria-label={t("quickActions.title")}
      className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5"
    >
      {items.map((it) => (
        <Link
          key={it.to}
          to={it.to}
          className="card-press hover-lift group flex min-h-[56px] items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2 shadow-card transition-colors hover:border-brand/50 hover:bg-card-elevated"
        >
          <span
            className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", toneRing[it.tone])}
          >
            {it.icon}
          </span>
          <span className="truncate text-[12px] font-semibold leading-tight text-foreground">
            {it.label}
          </span>
        </Link>
      ))}
    </nav>
  );
}

function KpiCard({
  label,
  valueNum,
  icon,
  tone = "brand",
  hint,
}: {
  label: string;
  valueNum: number;
  icon: React.ReactNode;
  tone?: "brand" | "success" | "destructive" | "warning";
  hint?: string;
}) {
  const toneRing = {
    brand: "bg-brand-soft text-brand-on-soft",
    success: "bg-success/15 text-success",
    destructive: "bg-destructive/15 text-destructive",
    warning: "bg-warning/15 text-warning",
  }[tone];
  const toneBar = {
    brand: "bg-brand",
    success: "bg-success",
    destructive: "bg-destructive",
    warning: "bg-warning",
  }[tone];
  return (
    <div className="group relative h-full overflow-hidden rounded-2xl border border-border bg-card p-3 shadow-card transition-all hover-lift hover:border-brand/40 animate-rise sm:p-3.5">
      <span aria-hidden className={cn("absolute left-0 top-0 h-full w-[3px]", toneBar)} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <span className={cn("grid h-7 w-7 place-items-center rounded-lg", toneRing)}>{icon}</span>
      </div>
      <Money
        value={valueNum}
        className="num mt-2 block text-[18px] font-bold leading-tight tracking-tight sm:text-[19px]"
      />
      {hint && <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function LimiteMensalCard({
  total,
  limiteTotal,
  usoLimite,
  passouLimite,
  proximoLimite,
  className,
}: {
  total: number;
  limiteTotal: number;
  usoLimite: number;
  passouLimite: boolean;
  proximoLimite: boolean;
  className?: string;
}) {
  const { t } = useTranslation("dashboard");
  return (
    <section className={cn("w-full rounded-2xl border border-border bg-card p-4 shadow-card", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("limiteMensal.eyebrow")}
          </p>
          <p className="num mt-1 text-sm font-semibold">
            {formatBRL(total)}{" "}
            <span className="font-normal text-muted-foreground">/ {formatBRL(limiteTotal)}</span>
          </p>
        </div>
        <PieChartIcon className="h-4 w-4 shrink-0 text-brand" />
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-card-elevated">
        <div
          className={cn(
            "h-full rounded-full transition-all animate-fill",
            passouLimite ? "bg-destructive" : proximoLimite ? "bg-warning" : "bg-brand",
          )}
          style={{ width: `${Math.min(100, usoLimite)}%` }}
        />
      </div>
      {passouLimite ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {t("limiteMensal.ultrapassado", { valor: formatBRL(total - limiteTotal) })}
        </p>
      ) : proximoLimite ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {t("limiteMensal.quase", { pct: Math.round((total / limiteTotal) * 100) })}
        </p>
      ) : (
        <p className="num mt-2 text-[11px] text-muted-foreground">
          {t("limiteMensal.usado", { pct: Math.round((total / limiteTotal) * 100) })}
        </p>
      )}
    </section>
  );
}

function MinhaRendaCard({
  totalEntradas,
  ano,
  mes,
}: {
  totalEntradas: number;
  ano: number;
  mes: number;
}) {
  const { t } = useTranslation("dashboard");
  return (
    <Link
      to="/renda"
      search={{ ano, mes }}
      className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-card transition-colors hover:bg-card-elevated"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-success/15 text-success">
        <ArrowUp className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{t("minhaRenda.title")}</p>
        <p className="num truncate text-[11px] text-muted-foreground">
          {t("minhaRenda.esteMes", { valor: formatBRL(totalEntradas) })}
        </p>
      </div>
      <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function RecentTransactionsCard({ ultimos }: { ultimos: import("@/lib/types").Gasto[] }) {
  const { t, i18n } = useTranslation("dashboard");
  const dateLocale = i18n.language === "en" ? "en-US" : "pt-BR";
  return (
    <section className="flex h-full w-full flex-col rounded-2xl border border-border bg-card p-3.5 shadow-card sm:p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("atividade.eyebrow")}
          </p>
          <h2 className="mt-0.5 text-base font-semibold sm:text-lg">{t("atividade.title")}</h2>
        </div>
        <Link
          to="/gastos"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("atividade.verTudo")}
        </Link>
      </div>
      <div className="mt-3">
        {ultimos.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-5 text-center animate-fade-in">
            <ReceiptIcon className="h-7 w-7 text-muted-foreground" />
            <p className="mt-2 text-xs text-muted-foreground">{t("atividade.vazio")}</p>
            <Link
              to="/adicionar"
              className="mt-2 text-xs font-medium underline hover:text-foreground transition-colors"
            >
              {t("atividade.primeiro")}
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {ultimos.slice(0, 5).map((g) => {
              const cat = getCategoriaById(g.categoriaId);
              return (
                <li
                  key={g.id}
                  className="flex items-center gap-3 rounded-2xl bg-card-elevated/60 p-2.5 hover-lift hover:bg-card-elevated"
                >
                  <TransactionAvatar estabelecimento={g.estabelecimento} categoria={cat} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {g.estabelecimento || g.descricao}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {cat?.nome ?? t("atividade.outros")} ·{" "}
                      {new Date(g.data + "T00:00:00").toLocaleDateString(dateLocale)}
                    </p>
                  </div>
                  <p className="num shrink-0 text-sm font-semibold text-destructive">
                    -{formatBRL(g.valor)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
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

type ContasResumo = {
  pendente: number;
  atrasadasCount: number;
  pendentesCount: number;
  total: number;
  proxima: { nome: string; valor: number; dataVencimento: string } | null;
  diasParaProxima: number | null;
};

function ContasCard({
  resumo,
  variant = "default",
  className,
}: {
  resumo: ContasResumo;
  variant?: "default" | "sideTop";
  className?: string;
}) {
  const { t } = useTranslation("dashboard");
  const hasAtrasada = resumo.atrasadasCount > 0;
  const hasPendentes = resumo.pendentesCount > 0 || hasAtrasada;
  const tudoPago = resumo.total > 0 && !hasPendentes;
  const semContas = resumo.total === 0;
  const isSide = variant === "sideTop";

  function vencimentoLabel(): string {
    const d = resumo.diasParaProxima;
    if (d === null) return "";
    if (d < 0) return t("contas.vencimento.atrasada", { dias: Math.abs(d) });
    if (d === 0) return t("contas.vencimento.hoje");
    if (d === 1) return t("contas.vencimento.amanha");
    return t("contas.vencimento.futuro", { dias: d });
  }

  return (
    <section
      className={cn(
        "w-full rounded-2xl border bg-card p-3.5 transition-colors",
        isSide ? "flex h-full flex-col shadow-elevated" : "mt-2.5",
        hasAtrasada ? "border-destructive/40" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-full",
              hasAtrasada
                ? "bg-destructive/15 text-destructive"
                : tudoPago
                  ? "bg-success/15 text-success"
                  : "bg-warning/15 text-warning",
            )}
          >
            <CalendarClock className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("contas.eyebrow")}
            </p>
            <h2 className="text-sm font-semibold">
              {semContas
                ? t("contas.semContas")
                : tudoPago
                  ? t("contas.tudoPago")
                  : t("contas.pendentes", { valor: formatBRL(resumo.pendente) })}
            </h2>
          </div>
        </div>
        <Link to="/contas-a-pagar" className="text-xs text-muted-foreground hover:text-foreground">
          {t("contas.ver")}
        </Link>
      </div>

      {!semContas && !tudoPago && resumo.proxima && (
        <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("contas.proximaVencer")}
          </p>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-semibold">{resumo.proxima.nome}</p>
            <p className="num shrink-0 text-sm font-semibold">{formatBRL(resumo.proxima.valor)}</p>
          </div>
          <p
            className={cn(
              "mt-0.5 text-[11px]",
              resumo.diasParaProxima !== null && resumo.diasParaProxima < 0
                ? "text-destructive"
                : resumo.diasParaProxima !== null && resumo.diasParaProxima <= 1
                  ? "text-warning"
                  : "text-muted-foreground",
            )}
          >
            {vencimentoLabel()}
          </p>
        </div>
      )}

      {!semContas && (
        <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="num">
            {resumo.pendentesCount}{" "}
            {resumo.pendentesCount === 1 ? t("contas.pendenteSing") : t("contas.pendentePlur")}
          </span>
          <span>·</span>
          <span className={cn("num", hasAtrasada && "text-destructive font-medium")}>
            {resumo.atrasadasCount}{" "}
            {resumo.atrasadasCount === 1 ? t("contas.atrasadaSing") : t("contas.atrasadaPlur")}
          </span>
        </div>
      )}

      {!semContas && !tudoPago && (
        <Link to="/adicionar" search={{ tipo: "conta" }} className="mt-4 block">
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 rounded-xl border-border bg-card-elevated hover:bg-accent"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("contas.adicionar")}
          </Button>
        </Link>
      )}

    </section>
  );
}

function DashboardSkeleton() {
  return (
    <MobileShell wide>
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

/**
 * Bloco compacto de alertas financeiros no Dashboard.
 * Mostra contagem de atrasadas, hoje e próximos 7 dias + a próxima conta a vencer.
 * Esconde-se silenciosamente se não houver nenhum alerta nem próxima conta.
 */
function AlertasContasCard({ contas }: { contas: ContaAPagar[] }) {
  const { t } = useTranslation("dashboard");
  const resumo = useMemo(() => buildResumoAlertas(contas), [contas]);
  const proxima = resumo.todos[0];
  const totalAtrasadas = resumo.atrasadas.length;
  const totalHoje = resumo.hoje.length;
  const totalAmanha = resumo.amanha.length;
  const totalEm7 = resumo.proximos7.length;

  if (resumo.totalRelevantes === 0) return null;

  const tone =
    totalAtrasadas > 0 ? "destructive" : totalHoje > 0 || totalAmanha > 0 ? "warning" : "brand";

  return (
    <section
      className={cn(
        "flex w-full flex-col rounded-3xl border bg-card p-4 transition-colors animate-rise",
        tone === "destructive"
          ? "border-destructive/40"
          : tone === "warning"
            ? "border-warning/40"
            : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-full",
              tone === "destructive"
                ? "bg-destructive/15 text-destructive"
                : tone === "warning"
                  ? "bg-warning/15 text-warning"
                  : "bg-card-elevated text-foreground",
            )}
          >
            <Bell className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("alertasContas.eyebrow")}
            </p>
            <h2 className="text-sm font-semibold">
              {totalAtrasadas > 0
                ? t(
                    totalAtrasadas === 1
                      ? "alertasContas.atrasadasSing"
                      : "alertasContas.atrasadasPlur",
                    { count: totalAtrasadas },
                  )
                : totalHoje > 0
                  ? t(totalHoje === 1 ? "alertasContas.hojeSing" : "alertasContas.hojePlur", {
                      count: totalHoje,
                    })
                  : totalAmanha > 0
                    ? t(
                        totalAmanha === 1 ? "alertasContas.amanhaSing" : "alertasContas.amanhaPlur",
                        { count: totalAmanha },
                      )
                    : t(totalEm7 === 1 ? "alertasContas.proxSing" : "alertasContas.proxPlur", {
                        count: totalEm7,
                      })}
            </h2>
          </div>
        </div>
        <Link to="/contas-a-pagar" className="text-xs text-muted-foreground hover:text-foreground">
          {t("contas.ver")}
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5 sm:gap-2">
        <AlertaPill
          label={t("alertasContas.pillAtrasadas")}
          count={totalAtrasadas}
          tone="destructive"
          icon={<AlertTriangle className="h-3 w-3" />}
        />
        <AlertaPill
          label={t("alertasContas.pillHojeAmanha")}
          count={totalHoje + totalAmanha}
          tone="warning"
          icon={<Clock className="h-3 w-3" />}
        />
        <AlertaPill
          label={t("alertasContas.pillProx7")}
          count={totalEm7}
          tone="brand"
          icon={<CalendarClock className="h-3 w-3" />}
        />
      </div>

      {proxima && (
        <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("contas.proximaVencer")}
          </p>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-semibold">{proxima.conta.nome}</p>
            <p className="num shrink-0 text-sm font-semibold">{formatBRL(proxima.conta.valor)}</p>
          </div>
          <p
            className={cn(
              "mt-0.5 text-[11px]",
              proxima.severidade === "atrasada"
                ? "text-destructive"
                : proxima.severidade === "hoje" || proxima.severidade === "amanha"
                  ? "text-warning"
                  : "text-muted-foreground",
            )}
          >
            {proxima.severidade === "atrasada"
              ? t("alertasContas.vencidaHa", { dias: Math.abs(proxima.dias) })
              : proxima.severidade === "hoje"
                ? t("alertasContas.venceHoje")
                : proxima.severidade === "amanha"
                  ? t("alertasContas.venceAmanha")
                  : t("alertasContas.venceEm", { dias: proxima.dias })}
          </p>
        </div>
      )}
    </section>

  );
}

function AlertaPill({
  label,
  count,
  tone,
  icon,
}: {
  label: string;
  count: number;
  tone: "destructive" | "warning" | "brand";
  icon: React.ReactNode;
}) {
  const toneClass =
    tone === "destructive"
      ? "bg-destructive/15 text-destructive"
      : tone === "warning"
        ? "bg-warning/15 text-warning"
        : "bg-[hsl(var(--brand))]/15 text-[hsl(var(--brand))]";
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background/40 p-2 text-center">
      <span
        className={cn(
          "mx-auto mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full",
          toneClass,
        )}
      >
        {icon}
      </span>
      <p className="num text-base font-bold leading-none">{count}</p>
      <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground break-words">{label}</p>
    </div>
  );
}

/**
 * Bloco compacto de Orçamento por categoria no Dashboard.
 * Mostra % geral usado, status (ok/atenção/estouro) e top 3 categorias.
 * Esconde-se silenciosamente se ainda não há nenhum limite configurado.
 */
function OrcamentoCard({
  categorias,
  gastos,
  mes,
  ano,
}: {
  categorias: Categoria[];
  gastos: Gasto[];
  mes: number;
  ano: number;
}) {
  const { t } = useTranslation("dashboard");
  const linhas = useMemo(
    () =>
      buildLinhasOrcamento(
        categorias,
        gastos,
        mes,
        ano,
        (catId) => getLimite(catId, mes, ano),
        mesEfetivoGasto,
      ),
    [categorias, gastos, mes, ano],
  );
  const resumo = useMemo(() => resumirOrcamento(linhas), [linhas]);

  if (!resumo.temOrcamento) return null;

  const { totalPlanejado, totalRealizado, pctGeral, qtdOk, qtdAtencao, qtdEstouro, top3 } = resumo;
  const tone = qtdEstouro > 0 ? "destructive" : qtdAtencao > 0 ? "warning" : "brand";

  return (
    <section
      className={cn(
        "flex w-full flex-col rounded-3xl border bg-card p-4 transition-colors animate-rise",
        tone === "destructive"
          ? "border-destructive/40"
          : tone === "warning"
            ? "border-warning/40"
            : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-full",
              tone === "destructive"
                ? "bg-destructive/15 text-destructive"
                : tone === "warning"
                  ? "bg-warning/15 text-warning"
                  : "bg-brand-soft text-brand",
            )}
          >
            <PieChartIcon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("orcamentoCard.eyebrow")}
            </p>
            <h2 className="text-sm font-semibold num">
              {formatBRL(totalRealizado)}
              <span className="ml-1 font-normal text-muted-foreground">
                / {formatBRL(totalPlanejado)}
              </span>
            </h2>
          </div>
        </div>
        <Link to="/orcamento" className="text-xs text-muted-foreground hover:text-foreground">
          {t("orcamentoCard.ver")}
        </Link>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-card-elevated">
        <div
          className={cn(
            "h-full rounded-full transition-all animate-fill",
            tone === "destructive"
              ? "bg-destructive"
              : tone === "warning"
                ? "bg-warning"
                : "bg-brand",
          )}
          style={{ width: `${Math.min(100, pctGeral)}%` }}
        />
      </div>
      <p className="num mt-1 text-[10px] text-muted-foreground">
        {t("orcamentoCard.usado", { pct: Math.round(pctGeral) })}
      </p>

      <div className="mt-3 grid grid-cols-3 gap-1.5 sm:gap-2">
        <AlertaPill
          label={t("orcamentoCard.pillDentro")}
          count={qtdOk}
          tone="brand"
          icon={<PieChartIcon className="h-3 w-3" />}
        />
        <AlertaPill
          label={t("orcamentoCard.pillAtencao")}
          count={qtdAtencao}
          tone="warning"
          icon={<AlertTriangle className="h-3 w-3" />}
        />
        <AlertaPill
          label={t("orcamentoCard.pillEstourou")}
          count={qtdEstouro}
          tone="destructive"
          icon={<AlertTriangle className="h-3 w-3" />}
        />
      </div>

      {top3.length > 0 && (
        <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("orcamentoCard.maiorUso")}
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {top3.map((l) => {
              const pct = Math.min(150, l.pct);
              const corBarra =
                l.status === "estouro"
                  ? "bg-destructive"
                  : l.status === "atencao"
                    ? "bg-warning"
                    : "bg-brand";
              return (
                <li key={l.cat.id} className="flex items-center gap-2">
                  <CategoryIcon categoria={l.cat} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-xs font-medium">{l.cat.nome}</p>
                      <span
                        className={cn(
                          "shrink-0 num text-[11px] font-semibold",
                          l.status === "estouro" && "text-destructive",
                          l.status === "atencao" && "text-warning",
                          l.status === "ok" && "text-brand",
                        )}
                      >
                        {Math.round(pct)}%
                      </span>
                    </div>
                    <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-card-elevated">
                      <div
                        className={cn("h-full transition-all", corBarra)}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

// ============================================================
// Resumo do mês — card compacto que linka para /relatorios
// ============================================================
function ResumoMesCard({
  mes,
  ano,
  saldo,
  totalEntradas,
  totalGastos,
  maiorCategoria,
  categorias,
  gastosConfirmados,
  contasAtrasadas,
  limiteTotal,
}: {
  mes: number;
  ano: number;
  saldo: number;
  totalEntradas: number;
  totalGastos: number;
  maiorCategoria: { nome: string; valor: number; pct: number } | null;
  categorias: Categoria[];
  gastosConfirmados: Gasto[];
  contasAtrasadas: number;
  limiteTotal: number | null | undefined;
}) {
  const { t } = useTranslation("dashboard");
  const linhas = useMemo(
    () =>
      buildLinhasOrcamento(
        categorias,
        gastosConfirmados,
        mes,
        ano,
        (catId) => getLimite(catId, mes, ano),
        mesEfetivoGasto,
      ),
    [categorias, gastosConfirmados, mes, ano],
  );
  const estouro = linhas.filter((l) => l.status === "estouro");
  const critica = estouro.sort((a, b) => b.pct - a.pct)[0]?.cat.nome ?? null;

  // Sem dados ainda
  const semDados = totalEntradas === 0 && totalGastos === 0;

  // Razão saldo/receita para classificar "folga"
  const folgaPct = totalEntradas > 0 ? saldo / totalEntradas : 0;
  const passouLimite = !!(limiteTotal && limiteTotal > 0 && totalGastos > limiteTotal);

  let emoji = "🙂";
  let titulo = t("resumoMes.default");
  let mensagem = t("resumoMes.defaultMsg");
  let toneCls = "border-border bg-card";
  let textCls = "text-foreground";

  if (semDados) {
    emoji = "✨";
    titulo = t("resumoMes.vamosComecar");
    mensagem = t("resumoMes.vamosComecarMsg");
  } else if (contasAtrasadas > 0) {
    emoji = "😬";
    titulo = t("resumoMes.atrasada");
    mensagem = t("resumoMes.atrasadaMsg", { count: contasAtrasadas });
    toneCls = "border-destructive/30 bg-destructive/5";
    textCls = "text-destructive";
  } else if (saldo < 0) {
    emoji = "🚨";
    titulo = t("resumoMes.negativo");
    mensagem = maiorCategoria
      ? t("resumoMes.negativoMsg", {
          valor: formatBRL(Math.abs(saldo)),
          categoria: maiorCategoria.nome,
        })
      : t("resumoMes.negativoMsgSemCat", { valor: formatBRL(Math.abs(saldo)) });
    toneCls = "border-destructive/30 bg-destructive/5";
    textCls = "text-destructive";
  } else if (passouLimite) {
    emoji = "⚠️";
    titulo = t("resumoMes.limite");
    mensagem = t("resumoMes.limiteMsg", { valor: formatBRL(totalGastos - (limiteTotal ?? 0)) });
    toneCls = "border-warning/30 bg-warning/5";
    textCls = "text-warning";
  } else if (estouro.length >= 2) {
    emoji = "⚠️";
    titulo = t("resumoMes.categorias");
    mensagem = t("resumoMes.categoriasMsg", { count: estouro.length, categoria: critica ?? "" });
    toneCls = "border-warning/30 bg-warning/5";
    textCls = "text-warning";
  } else if (estouro.length === 1) {
    emoji = "🧐";
    titulo = t("resumoMes.categoria");
    mensagem = t("resumoMes.categoriaMsg", { categoria: critica });
    toneCls = "border-warning/30 bg-warning/5";
    textCls = "text-warning";
  } else if (folgaPct >= 0.3 && totalEntradas > 0) {
    emoji = "🚀";
    titulo = t("resumoMes.otimo");
    mensagem = t("resumoMes.otimoMsg", {
      valor: formatBRL(saldo),
      pct: Math.round(folgaPct * 100),
    });
    toneCls = "border-success/30 bg-success/5";
    textCls = "text-success";
  } else if (folgaPct >= 0.1 && totalEntradas > 0) {
    emoji = "😁";
    titulo = t("resumoMes.bom");
    mensagem = t("resumoMes.bomMsg", { valor: formatBRL(saldo) });
    toneCls = "border-success/30 bg-success/5";
    textCls = "text-success";
  } else if (saldo > 0) {
    emoji = "🙂";
    titulo = t("resumoMes.apertado");
    mensagem = t("resumoMes.apertadoMsg", { valor: formatBRL(saldo) });
    toneCls = "border-warning/20 bg-warning/5";
    textCls = "text-foreground";
  } else {
    emoji = "🙂";
    titulo = t("resumoMes.equilibrado");
    mensagem = t("resumoMes.equilibradoMsg");
  }

  return (
    <section
      className={cn(
        "flex w-full flex-col rounded-3xl border p-4 transition-colors animate-rise",
        toneCls,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-card-elevated text-2xl">
          {emoji}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("resumoMes.eyebrow")}
          </p>
          <h3 className={cn("text-base font-bold leading-tight", textCls)}>{titulo}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{mensagem}</p>
        </div>
      </div>

      {!semDados && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-border/60 bg-background/40 p-2.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("resumoMes.maiorCategoria")}
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold">
              {maiorCategoria ? `${maiorCategoria.nome} · ${Math.round(maiorCategoria.pct)}%` : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/40 p-2.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("resumoMes.orcamento")}
            </p>
            <p
              className={cn(
                "mt-0.5 truncate text-sm font-semibold",
                critica ? "text-destructive" : "",
              )}
            >
              {critica
                ? t("resumoMes.estourou", { categoria: critica })
                : estouro.length === 0 && linhas.length > 0
                  ? t("resumoMes.tudoControle")
                  : t("resumoMes.semLimite")}
            </p>
          </div>
        </div>
      )}

      <Link
        to="/relatorios"
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card-elevated px-3 py-2 text-sm font-medium transition-all hover:bg-accent active:scale-[0.98]"
      >
        <Sparkles className="h-3.5 w-3.5 text-brand" />
        {t("resumoMes.verRelatorio")}
      </Link>
    </section>
  );
}

function ContasAReceberCard({ className }: { className?: string }) {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const userId = user?.id;
  const [resumo, setResumo] = useState<{
    totalAberto: number;
    totalAtrasado: number;
    countAbertas: number;
    countAtrasadas: number;
    proxima: { titulo: string; valor: number; data: string } | null;
    diasParaProxima: number | null;
  } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { listarContasReceber, calcularResumo } = await import("@/lib/contas-receber");
      try {
        const lista = await listarContasReceber(userId);
        if (cancelled) return;
        const r = calcularResumo(lista);
        setResumo({
          totalAberto: r.totalPendente + r.totalAtrasado,
          totalAtrasado: r.totalAtrasado,
          countAbertas: r.countPendentes + r.countAtrasadas,
          countAtrasadas: r.countAtrasadas,
          proxima: r.proxima
            ? {
                titulo: r.proxima.titulo,
                valor: Number(r.proxima.valor_restante) || Number(r.proxima.valor_total),
                data: r.proxima.data_prevista,
              }
            : null,
          diasParaProxima: r.diasParaProxima,
        });
      } catch (e) {
        console.warn("[dashboard] contas a receber load", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!resumo || resumo.countAbertas === 0) return null;

  const dias = resumo.diasParaProxima;
  const venceLabel =
    dias === null
      ? ""
      : dias < 0
        ? t("contasReceber.atrasada", { dias: Math.abs(dias) })
        : dias === 0
          ? t("contasReceber.venceHoje")
          : dias === 1
            ? t("contasReceber.venceAmanha")
            : t("contasReceber.venceEm", { dias });

  return (
    <section className={cn("rounded-2xl border border-border bg-card p-4 shadow-card", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-success/15 text-success">
            <HandCoins className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("contasReceber.eyebrow")}
            </p>
            <h2 className="text-sm font-semibold">
              {t("contasReceber.emAberto", { valor: formatBRL(resumo.totalAberto) })}
            </h2>
          </div>
        </div>
        <Link
          to="/contas-a-receber"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {t("contasReceber.ver")}
        </Link>
      </div>

      {resumo.proxima && (
        <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("contasReceber.proximaEntrada")}
          </p>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-semibold">{resumo.proxima.titulo}</p>
            <p className="num shrink-0 text-sm font-semibold">{formatBRL(resumo.proxima.valor)}</p>
          </div>
          <p
            className={cn(
              "mt-0.5 text-[11px]",
              dias !== null && dias < 0
                ? "text-destructive"
                : dias !== null && dias <= 1
                  ? "text-warning"
                  : "text-muted-foreground",
            )}
          >
            {venceLabel}
          </p>
        </div>
      )}

      <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="num">
          {t(
            resumo.countAbertas === 1 ? "contasReceber.abertasSing" : "contasReceber.abertasPlur",
            { count: resumo.countAbertas },
          )}
        </span>
        {resumo.countAtrasadas > 0 && (
          <>
            <span>·</span>
            <span className="num text-destructive font-medium">
              {t(
                resumo.countAtrasadas === 1
                  ? "contasReceber.atrasadasSing"
                  : "contasReceber.atrasadasPlur",
                { count: resumo.countAtrasadas },
              )}
            </span>
          </>
        )}
      </div>
    </section>
  );
}

function AssinaturasMoedaEstrangeiraBanner() {
  const { t } = useTranslation("dashboard");
  const recs = useRecorrencias();
  const ativas = recs.filter((r) => r.status === "ativa" && r.moeda && r.moeda !== "BRL");
  if (ativas.length === 0) return null;
  const moedas = Array.from(new Set(ativas.map((r) => r.moeda)));
  const moedaLabel =
    moedas.length === 1
      ? moedas[0] === "USD"
        ? t("moedaEstrangeira.dolar")
        : t("moedaEstrangeira.euro")
      : t("moedaEstrangeira.moedaEstrangeira");
  return (
    <Link
      to="/assinaturas"
      className="mt-4 flex items-start gap-3 rounded-2xl border border-sky-500/30 bg-sky-500/5 p-3 transition-colors hover:bg-sky-500/10"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-500">
        🌎
      </span>
      <div className="min-w-0 text-sm">
        <p className="font-semibold">
          {t(ativas.length === 1 ? "moedaEstrangeira.umaSing" : "moedaEstrangeira.umaPlur", {
            count: ativas.length,
            moeda: moedaLabel,
          })}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("moedaEstrangeira.subtitle")}</p>
      </div>
    </Link>
  );
}
