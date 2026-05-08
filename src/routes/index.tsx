import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
} from "recharts";
import { MobileShell } from "@/components/MobileShell";
import { CalendarioFinanceiro } from "@/components/CalendarioFinanceiro";
import { PlanoCard } from "@/components/PlanoCard";
import { CategoryIcon, categoryColor } from "@/components/CategoryIcon";
import { TransactionAvatar } from "@/components/TransactionAvatar";
import { FluxoCaixaChart } from "@/components/FluxoCaixaChart";
import { DashboardCartoesInsights } from "@/components/DashboardCartoesInsights";
import { SmartLimiteCard } from "@/components/SmartLimiteCard";
import { AvisoWhatsAppBanner } from "@/components/AvisoWhatsAppBanner";
import {
  contaPertenceAoMesRef,
  getCategoriaById,
  getCategorias,
  getContasAPagar,
  getGastos,
  getGuardado,
  getLimite,
  getLimites,
  getMetas,
  getReceitas,
  mesEfetivoGasto,
  statusContaEfetivo,
  statusMeta,
  useBootstrap,
  useStore,
} from "@/lib/store";
import { formatBRL, formatBRLCompact, formatMonthYear, parseDateLocal } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/Money";
import { NotificationBell } from "@/components/NotificationBell";
import { DashboardAlertasBloco } from "@/components/DashboardAlertasBloco";
import { buildResumoAlertas } from "@/lib/alertas-contas";
import {
  buildLinhasOrcamento,
  resumirOrcamento,
} from "@/lib/orcamento";
import type { Categoria, ContaAPagar, Gasto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { getVocab, type TipoCadastro } from "@/lib/profile-utils";
import { PublicLanding } from "@/components/landing/PublicLanding";
import { BrandLoader } from "@/components/BrandLoader";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gasto Inteligente — Controle financeiro simples, visual e inteligente" },
      {
        name: "description",
        content:
          "Organize gastos, cartões, contas, metas, renda e investimentos em um só lugar. Visão clara do mês, alertas inteligentes e planos para pessoa física, MEI e empresa.",
      },
    ],
  }),
  component: IndexGate,
});

function IndexGate() {
  const { session, loading } = useAuth();
  if (loading) return <BrandLoader message="Carregando sua conta…" />;
  if (!session) return <PublicLanding />;
  return <Index />;
}

function Index() {
  const ready = useBootstrap();
  const { profile } = useAuth();
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
  const limiteTotal = useStore(() => getLimite("total", ym.mes, ym.ano));
  // Re-render quando limites mudam
  useStore(() => getLimites().length);

  const gastosConfirmados = useMemo(
    () => gastos.filter((g) => g.confirmado !== false),
    [gastos],
  );
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
    if (typeof window === "undefined" || window.localStorage.getItem("gf:debug-finance") !== "1") return;
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
        .map((g) => ({ id: g.id, descricao: g.descricao, valor: g.valor, data: g.data, mes: g.mes, ano: g.ano })),
    });
  }, [gastos, gastosConfirmados, doMes, ym]);
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
  const resumoAlertasDashboard = useMemo(() => buildResumoAlertas(contas), [contas]);
  const temAlertasDashboard = resumoAlertasDashboard.totalRelevantes > 0;
  const temOrcamentoMes = useMemo(() => {
    const linhas = buildLinhasOrcamento(categorias, gastosConfirmados, ym.mes, ym.ano, (catId) =>
      getLimite(catId, ym.mes, ym.ano),
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
      <MobileShell wide>
        <header className="pt-2 animate-rise">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Gasto Inteligente
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Bora começar? 🚀</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Seu dinheiro mais claro, sem complicação. Escolha por onde começar:
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
            title="Lançar gasto"
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
            title="Criar primeira meta"
            tint="muted"
          />
        </section>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Tudo fica salvo na sua conta. 🔒
        </p>
      </MobileShell>
    );
  }

  const monthSwitcher = (
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
  );

  return (
    <MobileShell wide>
      {/* Header */}
      <header className="flex items-start justify-between gap-3 pt-2 animate-rise">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            {getVocab(profile?.tipo_cadastro as TipoCadastro).dashboardEyebrow}
          </p>
          <h1 className="mt-0.5 text-[26px] font-bold capitalize leading-tight tracking-tight">
            {formatMonthYear(ym.ano, ym.mes)}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {getVocab(profile?.tipo_cadastro as TipoCadastro).dashboardSubtitle}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Switcher solto apenas no mobile/tablet — no desktop ele vai pro card */}
          <div className="lg:hidden">{monthSwitcher}</div>
          <NotificationBell />
        </div>
      </header>

      {/* Card de assinatura/plano */}
      <PlanoCard className="mt-4" />

      {/* Bloco da Central de Alertas */}
      <DashboardAlertasBloco className="mt-4" />

      {/* Banner discreto: completar perfil (usuários antigos sem tipo_cadastro) */}
      {profile && !profile.tipo_cadastro && (
        <Link
          to="/perfil"
          className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-3 transition-colors hover:bg-primary/10"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold">Complete seu perfil</p>
            <p className="truncate text-xs text-muted-foreground">
              Personalize sua experiência: Pessoa física, MEI ou Empresa.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground">
            Completar
          </span>
        </Link>
      )}

      {/* ===== KPIs ===== */}
      <SectionLabel>Tá tudo no radar</SectionLabel>
      <section className="grid grid-cols-2 gap-2.5 sm:gap-3 md:gap-4 lg:grid-cols-4">
        <KpiCard
          label="Saldo"
          valueNum={saldo}
          icon={<Wallet className="h-4 w-4" />}
          tone={saldo < 0 ? "destructive" : "brand"}
          hint={saldo < 0 ? `${formatBRL(-saldo)} a mais que recebeu` : "no mês atual"}
        />
        <KpiCard
          label="Receitas"
          valueNum={totalEntradas}
          icon={<ArrowUp className="h-4 w-4" />}
          tone="success"
          hint={`${receitasMes.length} ${receitasMes.length === 1 ? "entrada" : "entradas"}`}
        />
        <KpiCard
          label="Despesas"
          valueNum={total}
          icon={<ArrowDown className="h-4 w-4" />}
          tone="destructive"
          hint={`${doMes.length} ${doMes.length === 1 ? "lançamento" : "lançamentos"}`}
        />
        <KpiCard
          label="A pagar"
          valueNum={contasResumo.pendente}
          icon={<CalendarClock className="h-4 w-4" />}
          tone={contasResumo.atrasadasCount > 0 ? "destructive" : "warning"}
          hint={
            contasResumo.atrasadasCount > 0
              ? `${contasResumo.atrasadasCount} atrasada(s)`
              : contasResumo.pendentesCount > 0
                ? `${contasResumo.pendentesCount} pendente(s)`
                : "tudo em dia"
          }
        />
      </section>

      {saldo < 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive animate-fade-in">
          <AlertTriangle className="h-3.5 w-3.5" />
          Ops, você passou {formatBRL(-saldo)} do que recebeu este mês.
        </p>
      )}

      {/* ===== Limite inteligente (premium) ===== */}
      <section className="mt-4">
        <SmartLimiteCard
          mes={ym.mes}
          ano={ym.ano}
          totalEntradas={totalEntradas}
          totalGastos={total}
        />
      </section>

      {/* CTA principal — apenas mobile (sidebar tem o seu) */}
      <Link to="/adicionar" className="mt-3 block lg:hidden">
        <Button
          size="lg"
          className="card-press h-14 w-full rounded-2xl bg-brand-grad text-base font-semibold shadow-elevated hover:opacity-95"
        >
          <Plus className="mr-1 h-5 w-5" />
          Lançar gasto
        </Button>
      </Link>

      {/* ===== Linha 2: Visão financeira (60%) + Calendário financeiro (40%) ===== */}
      <SectionLabel>Visão financeira</SectionLabel>
      <section className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12 lg:items-stretch lg:gap-5 xl:gap-6">
        <div className="flex min-w-0 lg:col-span-7">
          <FluxoCaixaChart ano={ym.ano} mes={ym.mes} gastos={gastosConfirmados} receitas={receitas} />
        </div>
        <div className="flex min-w-0 lg:col-span-5">
          <CalendarioFinanceiro
            ano={ym.ano}
            mes={ym.mes}
            onChangeMonth={changeMonth}
            compact
          />
        </div>
      </section>

      {/* ===== Transações recentes (linha cheia) ===== */}
      <SectionLabel>Transações recentes</SectionLabel>
      <section className="min-w-0">
        <RecentTransactionsCard ultimos={ultimos} />
      </section>

      {/* ===== Linha 3: Alertas financeiros + (Limite mensal / Minha renda) ===== */}
      <SectionLabel>Alertas e limites</SectionLabel>
      {/* xl (>=1280): Alertas 8col à esquerda, direita 4col empilhada (Limite em cima, Renda embaixo) */}
      {/* lg (1024-1279): Alertas full-width, abaixo Limite + Renda lado a lado */}
      {/* < lg: tudo empilhado */}
      <section className="grid min-w-0 grid-cols-1 gap-4 lg:gap-5 xl:grid-cols-12 xl:items-stretch xl:gap-6">
        {temAlertasDashboard && (
          <div className="flex min-w-0 xl:col-span-8">
            <div className="flex w-full">
              <AlertasContasCard contas={contas} />
            </div>
          </div>
        )}
        <div
          className={cn(
            "grid min-w-0 grid-cols-1 gap-4 lg:gap-5",
            // Em md/lg sem xl: Limite + Renda lado a lado; no xl com alertas: empilhados na coluna direita
            "md:grid-cols-2 xl:grid-cols-1",
            temAlertasDashboard ? "xl:col-span-4" : "xl:col-span-12 xl:grid-cols-2",
          )}
        >
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
        </div>
      </section>

      {/* ===== Linha 4: Resumo do mês + Orçamento do mês ===== */}
      <SectionLabel>Resumo e orçamento</SectionLabel>
      <section className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch lg:gap-5 xl:gap-6">
        <div className={cn("flex min-w-0", !temOrcamentoMes && "lg:col-span-2")}>
          <div className="flex w-full">
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
        </div>
        {temOrcamentoMes && (
          <div className="flex min-w-0">
            <div className="flex w-full">
              <OrcamentoCard
                categorias={categorias}
                gastos={gastosConfirmados}
                mes={ym.mes}
                ano={ym.ano}
              />
            </div>
          </div>
        )}
      </section>

      {/* ===== Linha 5: Próximas contas ===== */}
      {contasResumo.total > 0 && (
        <>
          <SectionLabel>Próximos passos</SectionLabel>
          <section className="min-w-0">
            <ContasCard resumo={contasResumo} variant="sideTop" />
          </section>
        </>
      )}

      {/* ===== Contas a receber ===== */}
      <ContasAReceberCard />

      {/* ===== Atalhos secundários ===== */}
      <SectionLabel>Controle financeiro</SectionLabel>
      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Link
          to="/orcamento"
          className="card-press hover-lift rounded-2xl border border-border bg-card p-3.5 transition-colors hover:border-brand/60 hover:bg-card-elevated"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Orçamento
            </p>
            <PieChartIcon className="h-3.5 w-3.5 text-brand" />
          </div>
          <p className="mt-1.5 text-sm font-bold">Por categoria</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Definir e acompanhar</p>
        </Link>
        <Link
          to="/guardado"
          className="card-press hover-lift rounded-2xl border border-border bg-card p-3.5 transition-colors hover:border-brand/60 hover:bg-card-elevated"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Total guardado
            </p>
            <Wallet className="h-3.5 w-3.5 text-brand" />
          </div>
          <Money value={totalGuardado} className="num mt-1.5 block text-lg font-bold" />
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {guardado.length} {guardado.length === 1 ? "reserva" : "reservas"}
          </p>
        </Link>
        <div className="hover-lift rounded-2xl border border-border bg-card p-3.5 transition-colors">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Gastos fixos
            </p>
            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <Money value={gastosFixos} className="num mt-1.5 block text-lg font-bold" />
          {totalEntradas > 0 ? (
            <p className="num mt-0.5 text-[10px] text-muted-foreground">
              {Math.round((gastosFixos / totalEntradas) * 100)}% da renda
            </p>
          ) : (
            <p className="mt-0.5 text-[10px] text-muted-foreground">—</p>
          )}
        </div>
        <Link
          to="/metas"
          className="card-press hover-lift rounded-2xl border border-border bg-card p-3.5 transition-colors hover:border-brand/60 hover:bg-card-elevated"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Metas
            </p>
            <Target className="h-3.5 w-3.5 text-brand" />
          </div>
          <p className="num mt-1.5 text-lg font-bold">{metasAndamento.length}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">em andamento</p>
        </Link>
      </section>


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
            <div className="mt-4 grid min-w-0 grid-cols-1 items-center gap-3 sm:grid-cols-[140px_1fr]">
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
              <ul className="min-w-0 space-y-2">
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

      {/* ===== Cartões, faturas e insights ===== */}
      <SectionLabel>Cartões e insights</SectionLabel>
      <DashboardCartoesInsights
        mes={ym.mes}
        ano={ym.ano}
        gastosMes={doMes}
        totalMes={total}
        totalMesAnterior={totalMesAnterior}
        maiorCategoria={maior ?? null}
        onAbrirFatura={(cartaoId) => abrirFatura(cartaoId)}
      />

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
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card/50 p-8 text-center animate-fade-in">
            <ReceiptIcon className="h-8 w-8 text-muted-foreground animate-breathe" />
            <p className="mt-3 text-sm font-medium">Nada por aqui ainda</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Quando você lançar um gasto, ele aparece aqui pra você acompanhar.
            </p>
            <Link to="/adicionar" className="mt-3 text-sm font-medium underline hover:text-foreground transition-colors">
              Lançar meu primeiro gasto
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
                    <TransactionAvatar estabelecimento={g.estabelecimento} categoria={cat} />
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

      {/* ===== Aviso: Em breve integração com WhatsApp ===== */}
      <AvisoWhatsAppBanner />

    </MobileShell>
  );
}

/* ====================== Helpers de UI ====================== */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2.5 mt-6 px-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground sm:mt-7 lg:mb-3 lg:mt-8">
      {children}
    </h2>
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
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5 shadow-card transition-all hover-lift hover:border-brand/60 lg:p-4 animate-rise">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <span className={cn("grid h-7 w-7 place-items-center rounded-full transition-colors", toneRing)}>
          {icon}
        </span>
      </div>
      <Money
        value={valueNum}
        className="num mt-2 block text-xl font-bold leading-tight lg:text-2xl"
      />
      {hint && (
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function LimiteMensalCard({
  total,
  limiteTotal,
  usoLimite,
  passouLimite,
  proximoLimite,
}: {
  total: number;
  limiteTotal: number;
  usoLimite: number;
  passouLimite: boolean;
  proximoLimite: boolean;
}) {
  return (
    <section className="w-full rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Limite mensal
          </p>
          <p className="num mt-1 text-sm font-semibold">
            {formatBRL(total)} <span className="font-normal text-muted-foreground">/ {formatBRL(limiteTotal)}</span>
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
          Limite ultrapassado em {formatBRL(total - limiteTotal)}
        </p>
      ) : proximoLimite ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Você já usou {Math.round((total / limiteTotal) * 100)}% do limite
        </p>
      ) : (
        <p className="num mt-2 text-[11px] text-muted-foreground">
          {Math.round((total / limiteTotal) * 100)}% usado
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
        <p className="truncate text-sm font-medium">Minha renda</p>
        <p className="num truncate text-[11px] text-muted-foreground">
          {formatBRL(totalEntradas)} este mês
        </p>
      </div>
      <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function RecentTransactionsCard({ ultimos }: { ultimos: import("@/lib/types").Gasto[] }) {
  return (
    <section className="flex h-full w-full flex-col rounded-3xl border border-border bg-card p-4 shadow-card sm:p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Atividade
          </p>
          <h2 className="mt-0.5 text-base font-semibold sm:text-lg">Transações recentes</h2>
        </div>
        <Link
          to="/gastos"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Ver tudo →
        </Link>
      </div>
      <div className="mt-3">
        {ultimos.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-5 text-center animate-fade-in">
            <ReceiptIcon className="h-7 w-7 text-muted-foreground" />
            <p className="mt-2 text-xs text-muted-foreground">
              Tudo vazio por aqui ainda.
            </p>
            <Link to="/adicionar" className="mt-2 text-xs font-medium underline hover:text-foreground transition-colors">
              Lançar o primeiro gasto
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
                      {cat?.nome ?? "Outros"} ·{" "}
                      {new Date(g.data + "T00:00:00").toLocaleDateString("pt-BR")}
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
}: {
  resumo: ContasResumo;
  variant?: "default" | "sideTop";
}) {
  const hasAtrasada = resumo.atrasadasCount > 0;
  const hasPendentes = resumo.pendentesCount > 0 || hasAtrasada;
  const tudoPago = resumo.total > 0 && !hasPendentes;
  const semContas = resumo.total === 0;
  const isSide = variant === "sideTop";

  function vencimentoLabel(): string {
    const d = resumo.diasParaProxima;
    if (d === null) return "";
    if (d < 0) return `vencida há ${Math.abs(d)}d`;
    if (d === 0) return "vence hoje";
    if (d === 1) return "vence amanhã";
    return `vence em ${d}d`;
  }

  return (
    <section
      className={cn(
        "rounded-3xl border bg-card p-4 transition-colors",
        isSide ? "h-auto self-start shadow-elevated" : "mt-2.5",
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
              Próximas contas
            </p>
            <h2 className="text-sm font-semibold">
              {semContas
                ? "Cadastre suas contas e não perca nenhum vencimento"
                : tudoPago
                  ? "Tudo pago neste mês 🎉"
                  : `${formatBRL(resumo.pendente)} pendentes`}
            </h2>
          </div>
        </div>
        <Link
          to="/contas-a-pagar"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Ver →
        </Link>
      </div>

      {!semContas && !tudoPago && resumo.proxima && (
        <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Próxima a vencer
          </p>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-semibold">{resumo.proxima.nome}</p>
            <p className="num shrink-0 text-sm font-semibold">
              {formatBRL(resumo.proxima.valor)}
            </p>
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
            {resumo.pendentesCount === 1 ? "pendente" : "pendentes"}
          </span>
          <span>·</span>
          <span className={cn("num", hasAtrasada && "text-destructive font-medium")}>
            {resumo.atrasadasCount}{" "}
            {resumo.atrasadasCount === 1 ? "atrasada" : "atrasadas"}
          </span>
        </div>
      )}

      {semContas && (
        <Link to="/contas-a-pagar" className="mt-3 block">
          <Button variant="outline" size="sm" className="w-full">
            <Plus className="mr-1 h-4 w-4" />
            Adicionar conta
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
  const resumo = useMemo(() => buildResumoAlertas(contas), [contas]);
  const proxima = resumo.todos[0];
  const totalAtrasadas = resumo.atrasadas.length;
  const totalHoje = resumo.hoje.length;
  const totalAmanha = resumo.amanha.length;
  const totalEm7 = resumo.proximos7.length;

  if (resumo.totalRelevantes === 0) return null;

  const tone =
    totalAtrasadas > 0
      ? "destructive"
      : totalHoje > 0 || totalAmanha > 0
        ? "warning"
        : "brand";

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
              Alertas financeiros
            </p>
            <h2 className="text-sm font-semibold">
              {totalAtrasadas > 0
                ? `${totalAtrasadas} ${totalAtrasadas === 1 ? "conta atrasada" : "contas atrasadas"}`
                : totalHoje > 0
                  ? `${totalHoje} ${totalHoje === 1 ? "conta vence" : "contas vencem"} hoje`
                  : totalAmanha > 0
                    ? `${totalAmanha} ${totalAmanha === 1 ? "conta vence" : "contas vencem"} amanhã`
                    : `${totalEm7} ${totalEm7 === 1 ? "conta vence" : "contas vencem"} nos próximos dias`}
            </h2>
          </div>
        </div>
        <Link
          to="/contas-a-pagar"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Ver →
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <AlertaPill
          label="Atrasadas"
          count={totalAtrasadas}
          tone="destructive"
          icon={<AlertTriangle className="h-3 w-3" />}
        />
        <AlertaPill
          label="Hoje/amanhã"
          count={totalHoje + totalAmanha}
          tone="warning"
          icon={<Clock className="h-3 w-3" />}
        />
        <AlertaPill
          label="Próx. 7 dias"
          count={totalEm7}
          tone="brand"
          icon={<CalendarClock className="h-3 w-3" />}
        />
      </div>

      {proxima && (
        <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Próxima a vencer
          </p>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-semibold">{proxima.conta.nome}</p>
            <p className="num shrink-0 text-sm font-semibold">
              {formatBRL(proxima.conta.valor)}
            </p>
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
              ? `Vencida há ${Math.abs(proxima.dias)}d`
              : proxima.severidade === "hoje"
                ? "Vence hoje"
                : proxima.severidade === "amanha"
                  ? "Vence amanhã"
                  : `Vence em ${proxima.dias}d`}
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
    <div className="rounded-xl border border-border bg-background/40 p-2 text-center">
      <span
        className={cn(
          "mx-auto mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full",
          toneClass,
        )}
      >
        {icon}
      </span>
      <p className="num text-base font-bold leading-none">{count}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{label}</p>
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
  const linhas = useMemo(
    () =>
      buildLinhasOrcamento(categorias, gastos, mes, ano, (catId) =>
        getLimite(catId, mes, ano),
        mesEfetivoGasto,
      ),
    [categorias, gastos, mes, ano],
  );
  const resumo = useMemo(() => resumirOrcamento(linhas), [linhas]);

  if (!resumo.temOrcamento) return null;

  const { totalPlanejado, totalRealizado, pctGeral, qtdOk, qtdAtencao, qtdEstouro, top3 } = resumo;
  const tone =
    qtdEstouro > 0 ? "destructive" : qtdAtencao > 0 ? "warning" : "brand";

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
              Orçamento do mês
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
          Ver →
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
        {Math.round(pctGeral)}% usado
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <AlertaPill
          label="Dentro"
          count={qtdOk}
          tone="brand"
          icon={<PieChartIcon className="h-3 w-3" />}
        />
        <AlertaPill
          label="Atenção"
          count={qtdAtencao}
          tone="warning"
          icon={<AlertTriangle className="h-3 w-3" />}
        />
        <AlertaPill
          label="Estourou"
          count={qtdEstouro}
          tone="destructive"
          icon={<AlertTriangle className="h-3 w-3" />}
        />
      </div>

      {top3.length > 0 && (
        <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Maior uso no mês
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
  const linhas = useMemo(
    () =>
      buildLinhasOrcamento(categorias, gastosConfirmados, mes, ano, (catId) =>
        getLimite(catId, mes, ano),
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

  type Estado = "ótimo" | "bom" | "apertado" | "atencao" | "critico" | "neutro";
  let estado: Estado = "neutro";
  let emoji = "🙂";
  let titulo = "Resumo do mês";
  let mensagem = "Continue lançando seus dados para a gente entender melhor seu mês.";
  let toneCls = "border-border bg-card";
  let textCls = "text-foreground";

  if (semDados) {
    estado = "neutro";
    emoji = "✨";
    titulo = "Vamos começar?";
    mensagem = "Adicione receitas e gastos para ver um resumo personalizado do seu mês aqui.";
  } else if (contasAtrasadas > 0) {
    estado = "critico";
    emoji = "😬";
    titulo = "Tem conta atrasada por aí";
    mensagem = `Você tem ${contasAtrasadas} ${contasAtrasadas === 1 ? "conta atrasada" : "contas atrasadas"}. Resolver isso primeiro evita juros e dor de cabeça.`;
    toneCls = "border-destructive/30 bg-destructive/5";
    textCls = "text-destructive";
  } else if (saldo < 0) {
    estado = "critico";
    emoji = "🚨";
    titulo = "Saldo negativo";
    mensagem = `Os gastos passaram da receita em ${formatBRL(Math.abs(saldo))}. Vale revisar a categoria ${maiorCategoria?.nome ?? "principal"} para frear.`;
    toneCls = "border-destructive/30 bg-destructive/5";
    textCls = "text-destructive";
  } else if (passouLimite) {
    estado = "atencao";
    emoji = "⚠️";
    titulo = "Eita, o limite foi ultrapassado";
    mensagem = `Você passou ${formatBRL(totalGastos - (limiteTotal ?? 0))} do limite mensal. Bora desacelerar nos próximos dias?`;
    toneCls = "border-warning/30 bg-warning/5";
    textCls = "text-warning";
  } else if (estouro.length >= 2) {
    estado = "atencao";
    emoji = "⚠️";
    titulo = "Algumas categorias estouraram";
    mensagem = `${estouro.length} categorias passaram do orçamento — começando por ${critica ?? ""}.`;
    toneCls = "border-warning/30 bg-warning/5";
    textCls = "text-warning";
  } else if (estouro.length === 1) {
    estado = "atencao";
    emoji = "🧐";
    titulo = "Atenção: esse mês pesou um pouco";
    mensagem = `A categoria ${critica} passou do orçamento. As outras estão sob controle 👍`;
    toneCls = "border-warning/30 bg-warning/5";
    textCls = "text-warning";
  } else if (folgaPct >= 0.3 && totalEntradas > 0) {
    estado = "ótimo";
    emoji = "🚀";
    titulo = "Mandou muito bem!";
    mensagem = `Sobrou ${formatBRL(saldo)} no mês — uma folga de ${Math.round(folgaPct * 100)}% da sua renda. Que tal direcionar pra uma meta?`;
    toneCls = "border-success/30 bg-success/5";
    textCls = "text-success";
  } else if (folgaPct >= 0.1 && totalEntradas > 0) {
    estado = "bom";
    emoji = "😁";
    titulo = "Boa! Você terminou no azul";
    mensagem = `Sobrou ${formatBRL(saldo)} este mês. Continue assim e ainda dá pra guardar uma parte 💰`;
    toneCls = "border-success/30 bg-success/5";
    textCls = "text-success";
  } else if (saldo > 0) {
    estado = "apertado";
    emoji = "🙂";
    titulo = "Fechou positivo, mas com pouca folga";
    mensagem = `Sobrou ${formatBRL(saldo)} no fim do mês. Tá apertado — qualquer imprevisto pode virar o jogo.`;
    toneCls = "border-warning/20 bg-warning/5";
    textCls = "text-foreground";
  } else {
    estado = "neutro";
    emoji = "🙂";
    titulo = "Mês equilibrado";
    mensagem = "Entradas e gastos no mesmo patamar. Vale tentar abrir uma folguinha pro próximo mês.";
  }

  return (
    <section className={cn("flex w-full flex-col rounded-3xl border p-4 transition-colors animate-rise", toneCls)}>
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-card-elevated text-2xl">
          {emoji}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Resumo do mês
          </p>
          <h3 className={cn("text-base font-bold leading-tight", textCls)}>{titulo}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{mensagem}</p>
        </div>
      </div>

      {!semDados && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-border/60 bg-background/40 p-2.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Maior categoria</p>
            <p className="mt-0.5 truncate text-sm font-semibold">
              {maiorCategoria ? `${maiorCategoria.nome} · ${Math.round(maiorCategoria.pct)}%` : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/40 p-2.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Orçamento</p>
            <p className={cn("mt-0.5 truncate text-sm font-semibold", critica ? "text-destructive" : "")}>
              {critica ? `Estourou: ${critica}` : estouro.length === 0 && linhas.length > 0 ? "Tudo no controle" : "Sem limite"}
            </p>
          </div>
        </div>
      )}

      <Link
        to="/relatorios"
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card-elevated px-3 py-2 text-sm font-medium transition-all hover:bg-accent active:scale-[0.98]"
      >
        <Sparkles className="h-3.5 w-3.5 text-brand" />
        Ver relatório completo
      </Link>
    </section>
  );
}



function ContasAReceberCard() {
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
        ? `${Math.abs(dias)} dia(s) atrasado`
        : dias === 0
          ? "vence hoje"
          : dias === 1
            ? "vence amanhã"
            : `vence em ${dias} dia(s)`;

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-success/15 text-success">
            <HandCoins className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              A receber
            </p>
            <h2 className="text-sm font-semibold">
              {formatBRL(resumo.totalAberto)} em aberto
            </h2>
          </div>
        </div>
        <Link
          to="/contas-a-receber"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Ver →
        </Link>
      </div>

      {resumo.proxima && (
        <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Próxima entrada
          </p>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-semibold">{resumo.proxima.titulo}</p>
            <p className="num shrink-0 text-sm font-semibold">
              {formatBRL(resumo.proxima.valor)}
            </p>
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
          {resumo.countAbertas} aberta(s)
        </span>
        {resumo.countAtrasadas > 0 && (
          <>
            <span>·</span>
            <span className="num text-destructive font-medium">
              {resumo.countAtrasadas} atrasada(s)
            </span>
          </>
        )}
      </div>
    </section>
  );
}
