import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useIsMobile } from "@/hooks/use-mobile";
import { InvestimentoForm } from "@/components/investimentos/InvestimentoForm";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { usePlan } from "@/lib/use-plan";
import {
  Plus,
  Upload,
  TrendingUp,
  TrendingDown,
  Wallet,
  PiggyBank,
  Coins,
  BarChart3,
  Pencil,
  Trash2,
  ShieldCheck,
  Sparkles,
  Info,
  History,
  AlertTriangle,
  RefreshCw,
  Clock,
  ArrowRightLeft,
  HandCoins,
  Eye,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { confirmAsync } from "@/components/ConfirmDialog";
import { ImportInvestimentosFlow } from "@/components/ImportInvestimentosFlow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { toastFromError } from "@/lib/premium-error";
import { formatBRL, parseBRLInput, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import {
  TIPOS_INVESTIMENTO,
  TIPOS_MOVIMENTACAO,
  TIPOS_RENDIMENTO,
  TIPO_IMPORTACAO_LABEL,
  type Ativo,
  type Movimentacao,
  type Rendimento,
  type Importacao,
  type ItensImportacao,
  type TipoInvestimento,
  type TipoMovimentacao,
  type TipoRendimento,
  listarAtivos,
  listarMovimentacoes,
  listarRendimentos,
  listarImportacoes,
  listarItensImportacao,
  excluirImportacaoSomenteHistorico,
  excluirImportacaoComDados,
  criarAtivo,
  atualizarAtivo,
  excluirAtivo,
  atualizarValorAtivo,
  criarMovimentacao,
  atualizarMovimentacao,
  excluirMovimentacao,
  criarRendimento,
  atualizarRendimento,
  excluirRendimento,
  recalcularAtivoPorMovimentacoes,
  isRendaVariavel,
  descreverUltimaAtualizacao,
  formatarDataHora,
  calcularTotais,
  distribuicaoPorTipo,
  tipoLabel,
  classeAtivo,
  getTipoInvestimentoLabel,
  getTipoInvestimentoClasseLabel,
  getTipoMovimentacaoLabel,
  getTipoRendimentoLabel,
} from "@/lib/investimentos";

export const Route = createFileRoute("/investimentos/")({
  head: () => {
    const t = i18n.getFixedT(i18n.language, "misc");
    return { meta: [{ title: t("investimentos.title") + " — Gasto Inteligente" }] };
  },
  component: InvestimentosGate,
});

function InvestimentosGate() {
  const { can, loading } = usePlan();
  if (loading) return null;
  if (!can("investimentos")) return <InvestimentosBloqueado />;
  return <InvestimentosPage />;
}

function InvestimentosBloqueado() {
  const { t } = useTranslation("misc");
  return (
    <MobileShell wide>
      <div className="mx-auto mt-10 max-w-md rounded-3xl border border-border bg-card p-6 text-center shadow-card">
        <h1 className="text-xl font-bold">{t("investimentos.locked.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("investimentos.locked.desc")}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button asChild className="rounded-2xl">
            <Link to="/meu-plano">{t("investimentos.locked.plans")}</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-2xl">
            <Link to="/meu-plano">{t("investimentos.locked.subscribe")}</Link>
          </Button>
          <Button asChild variant="ghost" className="rounded-2xl">
            <Link to="/">{t("investimentos.locked.home")}</Link>
          </Button>
        </div>
      </div>
    </MobileShell>
  );
}

const RENT_TIPOS = [
  { id: "cdi", label: "% do CDI" },
  { id: "ipca", label: "IPCA +" },
  { id: "prefixado", label: "Prefixado" },
  { id: "selic", label: "Selic" },
  { id: "outro", label: "Outro" },
];

function InvestimentosPage() {
  const { t } = useTranslation("misc");
  const { t: tInv } = useTranslation("investimentos");
  const { user } = useAuth();
  const userId = user?.id;
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [ativos, setAtivos] = useState<Ativo[]>([]);
  const [movs, setMovs] = useState<Movimentacao[]>([]);
  const [rends, setRends] = useState<Rendimento[]>([]);
  const [importacoes, setImportacoes] = useState<Importacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [openAdd, setOpenAdd] = useState(false);
  const [openImport, setOpenImport] = useState(false);
  const [openHistorico, setOpenHistorico] = useState(false);
  const [openAtualizarLote, setOpenAtualizarLote] = useState(false);
  const [atualizandoAtivo, setAtualizandoAtivo] = useState<Ativo | null>(null);
  const [editing, setEditing] = useState<Ativo | null>(null);
  const [movDialog, setMovDialog] = useState<{ open: boolean; mov: Movimentacao | null; ativoId?: string | null }>({ open: false, mov: null });
  const [rendDialog, setRendDialog] = useState<{ open: boolean; rend: Rendimento | null; ativoId?: string | null }>({ open: false, rend: null });
  const [detalheAtivo, setDetalheAtivo] = useState<Ativo | null>(null);

  const openCreate = () => {
    if (isMobile) {
      navigate({ to: "/investimentos/novo" });
    } else {
      setEditing(null);
      setOpenAdd(true);
    }
  };
  const openEdit = (a: Ativo) => {
    if (isMobile) {
      navigate({ to: "/investimentos/$id/editar", params: { id: a.id } });
    } else {
      setEditing(a);
      setOpenAdd(true);
    }
  };
  const openMovimentacao = (ativoId?: string | null) => {
    if (isMobile) {
      const id = ativoId ?? ativos[0]?.id;
      if (!id) {
        toast.error("Cadastre um investimento primeiro.");
        return;
      }
      navigate({ to: "/investimentos/$id/movimentacao", params: { id } });
    } else {
      setMovDialog({ open: true, mov: null, ativoId: ativoId ?? null });
    }
  };
  const openEditMovimentacao = (m: Movimentacao) => {
    if (isMobile) {
      navigate({ to: "/investimentos/movimentacao/$movId/editar", params: { movId: m.id } });
    } else {
      setMovDialog({ open: true, mov: m });
    }
  };
  const openRendimento = (ativoId?: string | null) => {
    if (isMobile) {
      const id = ativoId ?? ativos[0]?.id;
      if (!id) {
        toast.error("Cadastre um investimento primeiro.");
        return;
      }
      navigate({ to: "/investimentos/$id/rendimento", params: { id } });
    } else {
      setRendDialog({ open: true, rend: null, ativoId: ativoId ?? null });
    }
  };
  const openEditRendimento = (r: Rendimento) => {
    if (isMobile) {
      navigate({ to: "/investimentos/rendimento/$rendId/editar", params: { rendId: r.id } });
    } else {
      setRendDialog({ open: true, rend: r });
    }
  };
  const openAtualizarValor = (a: Ativo) => {
    if (isMobile) {
      navigate({ to: "/investimentos/$id/atualizar", params: { id: a.id } });
    } else {
      setAtualizandoAtivo(a);
    }
  };

  const openImportar = () => {
    if (isMobile) navigate({ to: "/investimentos/importar" });
    else setOpenImport(true);
  };
  const openHistoricoImportacoes = () => {
    if (isMobile) navigate({ to: "/investimentos/importacoes" });
    else setOpenHistorico(true);
  };
  const openAtualizarLoteAction = () => {
    if (isMobile) navigate({ to: "/investimentos/atualizar-lote" });
    else setOpenAtualizarLote(true);
  };





  async function reload() {
    if (!userId) return;
    setLoading(true);
    try {
      const [a, m, r, imps] = await Promise.all([
        listarAtivos(userId),
        listarMovimentacoes(userId),
        listarRendimentos(userId),
        listarImportacoes(userId),
      ]);
      setAtivos(a);
      setMovs(m);
      setRends(r);
      setImportacoes(imps);
    } catch (e) {
      console.error(e);
      toast.error(t("investimentos.wallet.loadError"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const totais = useMemo(() => calcularTotais(ativos, rends), [ativos, rends]);
  const distribuicao = useMemo(() => distribuicaoPorTipo(ativos), [ativos]);

  const insights = useMemo(() => {
    const out: string[] = [];
    if (ativos.length === 0) return out;
    const fixaPct = distribuicao
      .filter((d) => classeAtivo(d.tipo) === "Renda fixa")
      .reduce((s, d) => s + d.pct, 0);
    if (fixaPct >= 70) out.push(t("investimentos.insights.concentradaFixa"));
    if (totais.rendimentosAno > 0)
      out.push(t("investimentos.insights.recebidoAno", { val: formatBRL(totais.rendimentosAno) }));
    if (distribuicao[0] && distribuicao[0].pct >= 40)
      out.push(t("investimentos.insights.maiorTipo", { label: getTipoInvestimentoLabel(distribuicao[0].tipo, tInv), pct: distribuicao[0].pct.toFixed(0) }));
    if (totais.rendimentosMes === 0) out.push(t("investimentos.insights.semRendMes"));
    if (movs.length < 3) out.push(t("investimentos.insights.poucasMov"));
    return out;
  }, [ativos, distribuicao, totais, movs, t]);

  return (
    <MobileShell wide>
      <header className="pt-4 pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("investimentos.title")}</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              {t("investimentos.subtitle")}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={openHistoricoImportacoes}>
              <History className="h-4 w-4 mr-1.5" /> {t("investimentos.actions.imports")}
              {importacoes.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">
                  {importacoes.length}
                </Badge>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={openAtualizarLoteAction}
              disabled={ativos.length === 0}
            >
              <RefreshCw className="h-4 w-4 mr-1.5" /> {t("investimentos.actions.updateValues")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => openMovimentacao()}
              disabled={ativos.length === 0}
            >
              <ArrowRightLeft className="h-4 w-4 mr-1.5" /> {t("investimentos.actions.movement")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => openRendimento()}
              disabled={ativos.length === 0}
            >
              <HandCoins className="h-4 w-4 mr-1.5" /> {t("investimentos.actions.income")}
            </Button>
            <Button variant="outline" size="sm" onClick={openImportar}>
              <Upload className="h-4 w-4 mr-1.5" /> {t("investimentos.actions.import")}
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1.5" /> {t("investimentos.actions.add")}
            </Button>
          </div>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-border/40 bg-muted/20 p-2.5 text-[11px] text-muted-foreground max-w-3xl">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {t("investimentos.infoCalc")}
          </span>
        </div>
      </header>
      {/* Cards de topo */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-2">
        <KpiCard icon={<Wallet className="h-4 w-4" />} label={t("investimentos.kpi.patrimony")} value={formatBRL(totais.patrimonio)} />
        <KpiCard icon={<PiggyBank className="h-4 w-4" />} label={t("investimentos.kpi.applied")} value={formatBRL(totais.aplicado)} />
        <KpiCard
          icon={totais.lucro >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          label={t("investimentos.kpi.profit")}
          value={`${totais.lucro >= 0 ? "+" : ""}${formatBRL(totais.lucro)}`}
          tone={totais.lucro >= 0 ? "pos" : "neg"}
        />
        <KpiCard
          icon={<BarChart3 className="h-4 w-4" />}
          label={t("investimentos.kpi.yield")}
          value={`${totais.rentabilidade >= 0 ? "+" : ""}${totais.rentabilidade.toFixed(2)}%`}
          tone={totais.rentabilidade >= 0 ? "pos" : "neg"}
        />
        <KpiCard
          icon={<Coins className="h-4 w-4" />}
          label={t("investimentos.kpi.incomeYear")}
          value={formatBRL(totais.rendimentosAno)}
        />
      </section>
      {/* Conteúdo principal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
        {/* Carteira */}
        <section className="lg:col-span-2 rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">{t("investimentos.wallet.title")}</h2>
            <span className="text-xs text-muted-foreground">{t(ativos.length === 1 ? "investimentos.wallet.countOne" : "investimentos.wallet.countOther", { count: ativos.length })}</span>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">{t("investimentos.wallet.loading")}</p>
          ) : ativos.length === 0 ? (
            <EmptyState
              title={t("investimentos.wallet.emptyTitle")}
              description={t("investimentos.wallet.emptyDesc")}
              cta={
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-4 w-4 mr-1.5" /> {t("investimentos.actions.add")}
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border/40">
              {ativos.map((a) => {
                const lucro = Number(a.valor_atual || 0) - Number(a.valor_aplicado || 0);
                const rent =
                  Number(a.valor_aplicado || 0) > 0
                    ? (lucro / Number(a.valor_aplicado)) * 100
                    : 0;
                const ult = descreverUltimaAtualizacao(a.ultima_atualizacao);
                return (
                  <li key={a.id} className="py-3 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-brand-soft/60 grid place-items-center text-brand-on-soft font-semibold text-xs shrink-0">
                      {(a.ticker || a.nome).slice(0, 4).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{a.nome}</span>
                        <Badge variant="secondary" className="text-[10px]">{getTipoInvestimentoLabel(a.tipo, tInv)}</Badge>
                        {a.instituicao && (
                          <span className="text-[11px] text-muted-foreground">{a.instituicao}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {a.quantidade ? `${a.quantidade} · ` : ""}
                        {t("investimentos.wallet.applied")} {formatBRL(Number(a.valor_aplicado || 0))} · {t("investimentos.wallet.current")} {formatBRL(Number(a.valor_atual || 0))}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <Badge
                          variant="outline"
                          className={`text-[10px] gap-1 ${ult.desatualizado ? "border-amber-500/40 text-amber-500" : "text-muted-foreground"}`}
                        >
                          <Clock className="h-2.5 w-2.5" />
                          {ult.label}
                        </Badge>
                        {ult.desatualizado && a.ultima_atualizacao && (
                          <span className="text-[10px] text-amber-500/80 flex items-center gap-1">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            {t("investimentos.wallet.outdated")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-sm font-semibold ${lucro >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                        {lucro >= 0 ? "+" : ""}{formatBRL(lucro)}
                      </div>
                      <div className={`text-[11px] ${rent >= 0 ? "text-emerald-500/80" : "text-rose-500/80"}`}>
                        {rent >= 0 ? "+" : ""}{rent.toFixed(2)}%
                      </div>
                    </div>
                    <div className="flex gap-0.5 sm:gap-1 ml-2 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-10 w-10 sm:h-8 sm:w-8 shrink-0"
                        title={t("investimentos.wallet.details")}
                        onClick={() => setDetalheAtivo(a)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-10 w-10 sm:h-8 sm:w-8 shrink-0 text-brand"
                        title={t("investimentos.wallet.refresh")}
                        onClick={() => openAtualizarValor(a)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-10 w-10 sm:h-8 sm:w-8 shrink-0" title={t("investimentos.wallet.edit")} onClick={() => openEdit(a)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-10 w-10 sm:h-8 sm:w-8 shrink-0 text-rose-500 hover:text-rose-500"
                        title={t("investimentos.wallet.delete")}
                        onClick={async () => {
                          const ok = await confirmAsync({ title: t("investimentos.wallet.confirmDelete", { name: a.nome }), destructive: true });
                          if (!ok) return;
                          await excluirAtivo(a.id);
                          toast.success(t("investimentos.wallet.deleted"));
                          reload();
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />

                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Distribuição + Insights */}
        <aside className="space-y-4">
          <section className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4">
            <h2 className="font-semibold mb-3">{t("investimentos.dist.title")}</h2>
            {distribuicao.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("investimentos.dist.empty")}</p>
            ) : (
              <ul className="space-y-2.5">
                {distribuicao.map((d) => (
                  <li key={d.tipo}>
                    <div className="flex justify-between text-xs mb-1">
                      <span>{getTipoInvestimentoLabel(d.tipo, tInv)}</span>
                      <span className="text-muted-foreground">{d.pct.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-brand"
                        style={{ width: `${Math.min(100, d.pct)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {insights.length > 0 && (
            <section className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-brand" />
                <h2 className="font-semibold">{t("investimentos.insights.title")}</h2>
              </div>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                {insights.map((i, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span className="text-brand">•</span>
                    <span>{i}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
      {/* Evolução patrimonial */}
      <section className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4 mt-4">
        <h2 className="font-semibold mb-3">{t("investimentos.evol.title")}</h2>
        {ativos.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("investimentos.evol.empty")}
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <MiniStat label={t("investimentos.evol.patrimony")} value={formatBRL(totais.patrimonio)} />
            <MiniStat label={t("investimentos.evol.contributed")} value={formatBRL(totais.aplicado)} />
            <MiniStat label={t("investimentos.evol.variation")} value={`${totais.lucro >= 0 ? "+" : ""}${formatBRL(totais.lucro)}`} />
            <MiniStat label={t("investimentos.evol.incomeMonth")} value={formatBRL(totais.rendimentosMes)} />
          </div>
        )}
      </section>
      {/* Movimentações + Rendimentos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <section className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">{t("investimentos.movs.title")}</h2>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => openMovimentacao()}
              disabled={ativos.length === 0}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> {t("investimentos.actions.new")}
            </Button>
          </div>
          {movs.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("investimentos.movs.empty")}</p>
          ) : (
            <ul className="divide-y divide-border/40 text-sm">
              {movs.slice(0, 10).map((m) => {
                const ativo = ativos.find((a) => a.id === m.ativo_id);
                return (
                  <li key={m.id} className="py-2 flex justify-between gap-2 items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium capitalize">{m.tipo}</span>
                        {m.instituicao && (
                          <span className="text-[10px] text-muted-foreground">· {m.instituicao}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {ativo?.nome ?? "—"} · {formatDataBR(m.data)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold">{formatBRL(Number(m.valor_total || 0))}</div>
                      {m.quantidade ? <div className="text-[11px] text-muted-foreground">{m.quantidade}</div> : null}
                    </div>
                    <div className="flex gap-0.5 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title={t("investimentos.wallet.edit")}
                        onClick={() => openEditMovimentacao(m)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-rose-500 hover:text-rose-500"
                        title={t("investimentos.wallet.delete")}
                        onClick={async () => {
                          const ok = await confirmAsync({ title: t("investimentos.movs.confirmDelete"), destructive: true });
                          if (!ok) return;
                          try {
                            const aId = m.ativo_id;
                            await excluirMovimentacao(m.id);
                            if (aId && userId) await recalcularAtivoPorMovimentacoes(userId, aId);
                            toast.success(t("investimentos.movs.deleted"));
                            reload();
                          } catch (e) {
                            console.error(e);
                            toast.error(t("investimentos.wallet.deleteError"));
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">{t("investimentos.rends.title")}</h2>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => openRendimento()}
              disabled={ativos.length === 0}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> {t("investimentos.actions.newM")}
            </Button>
          </div>
          {rends.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("investimentos.rends.empty")}</p>
          ) : (
            <ul className="divide-y divide-border/40 text-sm">
              {rends.slice(0, 10).map((r) => {
                const ativo = ativos.find((a) => a.id === r.ativo_id);
                return (
                  <li key={r.id} className="py-2 flex justify-between gap-2 items-center">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium capitalize">{r.tipo.replace(/_/g, " ")}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {ativo?.nome ?? "—"} · {formatDataBR(r.data_pagamento)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold text-emerald-500">+{formatBRL(Number(r.valor || 0))}</div>
                      <Badge variant="secondary" className="text-[10px]">{r.status}</Badge>
                    </div>
                    <div className="flex gap-0.5 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title={t("investimentos.wallet.edit")}
                        onClick={() => openEditRendimento(r)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-rose-500 hover:text-rose-500"
                        title={t("investimentos.wallet.delete")}
                        onClick={async () => {
                          const ok = await confirmAsync({ title: t("investimentos.rends.confirmDelete"), destructive: true });
                          if (!ok) return;
                          try {
                            await excluirRendimento(r.id);
                            toast.success(t("investimentos.rends.deleted"));
                            reload();
                          } catch (e) {
                            console.error(e);
                            toast.error(t("investimentos.wallet.deleteError"));
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
      {/* Integração B3 */}
      <section className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4 mt-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-brand-soft/60 grid place-items-center text-brand-on-soft shrink-0">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-semibold">{t("investimentos.b3.title")}</h2>
              <Badge variant="outline" className="text-[10px]">{t("investimentos.b3.notConnected")}</Badge>
              <Badge variant="secondary" className="text-[10px]">{t("investimentos.b3.manualAvail")}</Badge>
              <Badge variant="outline" className="text-[10px]">{t("investimentos.b3.apiSoon")}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-2 max-w-2xl">
              {t("investimentos.b3.desc")}
            </p>
            <div className="flex items-start gap-2 mt-3 rounded-lg bg-muted/40 p-2.5 text-[11px] text-muted-foreground">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                {t("investimentos.b3.security")}
              </span>
            </div>
          </div>
        </div>
      </section>
      <AddAtivoDialog
        open={openAdd}
        onOpenChange={setOpenAdd}
        editing={editing}
        userId={userId}
        onSaved={() => { setOpenAdd(false); setEditing(null); reload(); }}
      />
      <ImportDialog
        open={openImport}
        onOpenChange={setOpenImport}
        userId={userId}
        ativos={ativos}
        onImported={reload}
      />
      <HistoricoImportacoesDialog
        open={openHistorico}
        onOpenChange={setOpenHistorico}
        importacoes={importacoes}
        userId={userId}
        onChanged={reload}
      />
      <AtualizarValorDialog
        ativo={atualizandoAtivo}
        userId={userId}
        onClose={() => setAtualizandoAtivo(null)}
        onSaved={() => { setAtualizandoAtivo(null); reload(); }}
      />
      <AtualizarLoteDialog
        open={openAtualizarLote}
        onOpenChange={setOpenAtualizarLote}
        ativos={ativos}
        userId={userId}
        onSaved={() => { setOpenAtualizarLote(false); reload(); }}
      />
      <MovimentacaoDialog
        state={movDialog}
        ativos={ativos}
        userId={userId}
        onClose={() => setMovDialog({ open: false, mov: null })}
        onSaved={() => { setMovDialog({ open: false, mov: null }); reload(); }}
      />
      <RendimentoDialog
        state={rendDialog}
        ativos={ativos}
        userId={userId}
        onClose={() => setRendDialog({ open: false, rend: null })}
        onSaved={() => { setRendDialog({ open: false, rend: null }); reload(); }}
      />
      <DetalheAtivoDialog
        ativo={detalheAtivo}
        movimentacoes={movs}
        rendimentos={rends}
        onClose={() => setDetalheAtivo(null)}
        onEditar={(a) => { setDetalheAtivo(null); openEdit(a); }}
        onAtualizarValor={(a) => { setDetalheAtivo(null); openAtualizarValor(a); }}
        onAddMovimentacao={(a) => openMovimentacao(a.id)}
        onAddRendimento={(a) => { setDetalheAtivo(null); openRendimento(a.id); }}
        onExcluirAtivo={async (a) => {
          const ok = await confirmAsync({ title: t("investimentos.detail.confirmDeleteAtivo", { name: a.nome }), destructive: true });
          if (!ok) return;
          try {
            await excluirAtivo(a.id);
            toast.success(t("investimentos.wallet.deleted"));
            setDetalheAtivo(null);
            reload();
          } catch (e) {
            console.error(e);
            toast.error(t("investimentos.wallet.deleteError"));
          }
        }}
      />
    </MobileShell>
  )
}

// Helper local para formatar data ISO (yyyy-mm-dd) em pt-BR
function formatDataBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return iso;
}

function KpiCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "pos" | "neg";
}) {
  const valueClass =
    tone === "pos" ? "text-emerald-500" : tone === "neg" ? "text-rose-500" : "";
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-3.5">
      <div className="flex items-center gap-2 text-muted-foreground text-[11px] uppercase tracking-wide">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-1.5 text-lg font-bold tracking-tight ${valueClass}`}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/30 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold">{value}</div>
    </div>
  );
}

function EmptyState({ title, description, cta }: { title: string; description: string; cta?: React.ReactNode }) {
  return (
    <div className="py-10 text-center">
      <div className="mx-auto h-12 w-12 rounded-2xl bg-brand-soft/60 grid place-items-center text-brand-on-soft mb-3">
        <Wallet className="h-5 w-5" />
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{description}</p>
      {cta && <div className="mt-4">{cta}</div>}
    </div>
  );
}

function AddAtivoDialog({
  open,
  onOpenChange,
  editing,
  userId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Ativo | null;
  userId?: string;
  onSaved: () => void;
}) {
  const { t: tInv } = useTranslation("investimentos");
  const [nome, setNome] = useState("");
  const [ticker, setTicker] = useState("");
  const [tipo, setTipo] = useState<TipoInvestimento>("acoes");
  const [instituicao, setInstituicao] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [precoMedio, setPrecoMedio] = useState("");
  const [precoAtual, setPrecoAtual] = useState("");
  const [valorAplicado, setValorAplicado] = useState("");
  const [valorAtual, setValorAtual] = useState("");
  const [rentTipo, setRentTipo] = useState("");
  const [rentPct, setRentPct] = useState("");
  const [dataInicio, setDataInicio] = useState(todayISO());
  const [dataVenc, setDataVenc] = useState("");
  const [liquidez, setLiquidez] = useState("");
  const [observacao, setObservacao] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAvancado, setShowAvancado] = useState(false);

  const classe = classeAtivo(tipo);
  const isRendaVariavel = classe === "Renda variável" || tipo === "cripto";
  const isRendaFixa = classe === "Renda fixa" || classe === "Fundos";

  // Auto-cálculo para renda variável: quantidade × preço
  useEffect(() => {
    if (!isRendaVariavel) return;
    const qtd = quantidade ? Number(quantidade.replace(",", ".")) : NaN;
    const pm = precoMedio ? Number(precoMedio.replace(",", ".")) : NaN;
    if (!isNaN(qtd) && !isNaN(pm) && qtd > 0 && pm > 0) {
      const total = qtd * pm;
      setValorAplicado(total.toFixed(2).replace(".", ","));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantidade, precoMedio, isRendaVariavel]);

  useEffect(() => {
    if (!isRendaVariavel) return;
    const qtd = quantidade ? Number(quantidade.replace(",", ".")) : NaN;
    const pa = precoAtual ? Number(precoAtual.replace(",", ".")) : NaN;
    if (!isNaN(qtd) && !isNaN(pa) && qtd > 0 && pa > 0) {
      const total = qtd * pa;
      setValorAtual(total.toFixed(2).replace(".", ","));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantidade, precoAtual, isRendaVariavel]);

  useEffect(() => {
    if (editing) {
      setNome(editing.nome);
      setTicker(editing.ticker ?? "");
      setTipo(editing.tipo);
      setInstituicao(editing.instituicao ?? "");
      setQuantidade(editing.quantidade?.toString() ?? "");
      setPrecoMedio(editing.preco_medio?.toString() ?? "");
      setPrecoAtual(editing.preco_atual?.toString() ?? "");
      setValorAplicado(editing.valor_aplicado.toString());
      setValorAtual(editing.valor_atual.toString());
      setRentTipo(editing.rentabilidade_tipo ?? "");
      setRentPct(editing.rentabilidade_percentual ?? "");
      setDataInicio(editing.data_inicio ?? todayISO());
      setDataVenc(editing.data_vencimento ?? "");
      setLiquidez(editing.liquidez ?? "");
      setObservacao(editing.observacao ?? "");
    } else {
      setNome(""); setTicker(""); setTipo("acoes"); setInstituicao("");
      setQuantidade(""); setPrecoMedio(""); setPrecoAtual("");
      setValorAplicado(""); setValorAtual("");
      setRentTipo(""); setRentPct(""); setDataInicio(todayISO()); setDataVenc("");
      setLiquidez(""); setObservacao("");
    }
  }, [editing, open]);

  async function handleSave() {
    if (!userId) return;
    if (!nome.trim()) {
      toast.error("Informe o nome do investimento.");
      return;
    }
    const aplicado = parseBRLInput(valorAplicado) || 0;
    const atual = parseBRLInput(valorAtual) || aplicado;
    const qtd = quantidade ? Number(quantidade.replace(",", ".")) : null;
    const pm = precoMedio ? Number(precoMedio.replace(",", ".")) : null;
    const pa = precoAtual ? Number(precoAtual.replace(",", ".")) : null;
    const payload: Partial<Ativo> = {
      nome: nome.trim(),
      ticker: ticker.trim() || null,
      tipo,
      instituicao: instituicao.trim() || null,
      quantidade: qtd,
      preco_medio: pm,
      preco_atual: pa,
      valor_aplicado: aplicado,
      valor_atual: atual,
      rentabilidade_tipo: rentTipo || null,
      rentabilidade_percentual: rentPct.trim() || null,
      data_inicio: dataInicio || null,
      data_vencimento: dataVenc || null,
      liquidez: liquidez.trim() || null,
      observacao: observacao.trim() || null,
    };
    setSaving(true);
    try {
      if (editing) {
        await atualizarAtivo(editing.id, payload);
        toast.success("Investimento atualizado.");
      } else {
        await criarAtivo(userId, payload);
        toast.success("Investimento cadastrado.");
      }
      onSaved();
    } catch (e) {
      console.error(e);
      toastFromError(e, "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar investimento" : "Adicionar investimento"}</DialogTitle>
          <DialogDescription>Cadastre as informações do ativo. Apenas Nome é obrigatório.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {/* Texto de ajuda contextual */}
          <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-2.5 text-[11px] text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              {isRendaVariavel
                ? "Use quantidade, preço médio e preço atual para calcular os valores automaticamente."
                : "Use valor aplicado e valor atual. Quantidade e preço médio não são necessários."}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo *">
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoInvestimento)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS_INVESTIMENTO.map((it) => (
                    <SelectItem key={it.id} value={it.id}>{getTipoInvestimentoLabel(it.id, tInv)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Instituição / corretora">
              <Input value={instituicao} onChange={(e) => setInstituicao(e.target.value)} placeholder="XP, Nubank, Rico…" />
            </Field>
          </div>

          <Field label="Nome do investimento *">
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder={isRendaVariavel ? "Ex.: Maxi Renda FII" : "Ex.: Tesouro Selic 2029"}
            />
          </Field>

          {/* Ticker — destaque para renda variável, opcional/escondido para renda fixa */}
          {isRendaVariavel && (
            <Field label="Ticker / código *">
              <Input
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="MXRF11, PETR4, BTC…"
              />
            </Field>
          )}

          {/* Renda variável: quantidade + preços com auto-cálculo */}
          {isRendaVariavel && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Quantidade">
                  <Input value={quantidade} onChange={(e) => setQuantidade(e.target.value)} placeholder="10" />
                </Field>
                <Field label="Preço médio">
                  <Input value={precoMedio} onChange={(e) => setPrecoMedio(e.target.value)} placeholder="10,20" />
                </Field>
                <Field label="Preço atual">
                  <Input value={precoAtual} onChange={(e) => setPrecoAtual(e.target.value)} placeholder="10,50" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Valor aplicado (auto)">
                  <Input value={valorAplicado} onChange={(e) => setValorAplicado(e.target.value)} placeholder="R$ 102,00" />
                </Field>
                <Field label="Valor atual (auto)">
                  <Input value={valorAtual} onChange={(e) => setValorAtual(e.target.value)} placeholder="R$ 105,00" />
                </Field>
              </div>
              <Field label="Data da compra">
                <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
              </Field>
            </>
          )}

          {/* Renda fixa / fundos: valores + rentabilidade + datas */}
          {isRendaFixa && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Valor aplicado *">
                  <Input value={valorAplicado} onChange={(e) => setValorAplicado(e.target.value)} placeholder="R$ 1.000,00" />
                </Field>
                <Field label="Valor atual">
                  <Input value={valorAtual} onChange={(e) => setValorAtual(e.target.value)} placeholder="R$ 1.042,30" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tipo de rentabilidade">
                  <Select value={rentTipo} onValueChange={setRentTipo}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {RENT_TIPOS.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Percentual / índice">
                  <Input value={rentPct} onChange={(e) => setRentPct(e.target.value)} placeholder="110% do CDI" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Data da aplicação">
                  <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
                </Field>
                <Field label="Vencimento">
                  <Input type="date" value={dataVenc} onChange={(e) => setDataVenc(e.target.value)} />
                </Field>
              </div>
              <Field label="Liquidez">
                <Input value={liquidez} onChange={(e) => setLiquidez(e.target.value)} placeholder="Diária, no vencimento…" />
              </Field>

              {/* Avançado: ticker/quantidade/preços ocultos por padrão */}
              <button
                type="button"
                onClick={() => setShowAvancado((v) => !v)}
                className="text-xs text-brand hover:underline self-start"
              >
                {showAvancado ? "Ocultar campos avançados" : "Mostrar campos avançados (ticker, quantidade)"}
              </button>
              {showAvancado && (
                <div className="grid gap-3 rounded-lg border border-dashed border-border/60 p-3">
                  <Field label="Ticker / código (opcional)">
                    <Input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="—" />
                  </Field>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="Quantidade">
                      <Input value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
                    </Field>
                    <Field label="Preço médio">
                      <Input value={precoMedio} onChange={(e) => setPrecoMedio(e.target.value)} />
                    </Field>
                    <Field label="Preço atual">
                      <Input value={precoAtual} onChange={(e) => setPrecoAtual(e.target.value)} />
                    </Field>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Fallback "Outros" — campos genéricos */}
          {!isRendaVariavel && !isRendaFixa && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Valor aplicado">
                  <Input value={valorAplicado} onChange={(e) => setValorAplicado(e.target.value)} placeholder="R$ 1.000,00" />
                </Field>
                <Field label="Valor atual">
                  <Input value={valorAtual} onChange={(e) => setValorAtual(e.target.value)} placeholder="R$ 1.042,30" />
                </Field>
              </div>
              <Field label="Data da aplicação">
                <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
              </Field>
            </>
          )}

          <Field label="Observação">
            <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando…" : editing ? "Salvar" : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function ImportDialog({
  open,
  onOpenChange,
  userId,
  ativos,
  onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string | undefined;
  ativos: Ativo[];
  onImported: () => void;
}) {
  const [origem, setOrigem] = useState<"b3" | "corretora" | "csv" | "pdf" | null>(null);

  const opcoes: Array<{
    id: "b3" | "corretora" | "csv" | "pdf";
    label: string;
    desc: string;
  }> = [
    {
      id: "b3",
      label: "Importar extrato da B3",
      desc: "Arquivo exportado da Área do Investidor (PDF, CSV ou XLSX).",
    },
    {
      id: "corretora",
      label: "Importar extrato da corretora",
      desc: "Relatório oficial da sua corretora (PDF, CSV ou XLSX).",
    },
    {
      id: "csv",
      label: "Importar CSV / planilha",
      desc: "Modelo livre com seus ativos. Aceita CSV, XLSX e XLS.",
    },
    {
      id: "pdf",
      label: "Importar PDF",
      desc: "Extrato em PDF com prévia antes de salvar.",
    },
  ];

  return (
    <>
      <Dialog open={open && !origem} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Importar investimentos</DialogTitle>
            <DialogDescription>Escolha de onde quer trazer seus dados.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {opcoes.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="w-full text-left rounded-xl border border-border/60 bg-card/40 hover:bg-accent/40 p-3 transition-colors"
                onClick={() => setOrigem(opt.id)}
              >
                <div className="font-medium text-sm">{opt.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{opt.desc}</div>
              </button>
            ))}
          </div>
          <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-2.5 text-[11px] text-muted-foreground mt-1">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Não pedimos senha, CPF, token bancário ou acesso à sua conta. A importação
              usa apenas arquivos enviados por você.
            </span>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportInvestimentosFlow
        open={open && !!origem}
        origem={origem}
        userId={userId}
        ativosExistentes={ativos}
        onOpenChange={(v) => {
          if (!v) {
            setOrigem(null);
            onOpenChange(false);
          }
        }}
        onImported={() => {
          onImported();
        }}
      />
    </>
  );
}

function HistoricoImportacoesDialog({
  open,
  onOpenChange,
  importacoes,
  userId,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  importacoes: Importacao[];
  userId?: string;
  onChanged: () => void;
}) {
  const { t: tInv } = useTranslation("investimentos");
  const [detalhe, setDetalhe] = useState<Importacao | null>(null);
  const [confirmar, setConfirmar] = useState<Importacao | null>(null);
  const [itensDetalhe, setItensDetalhe] = useState<ItensImportacao | null>(null);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  async function abrirDetalhe(imp: Importacao) {
    if (!userId) return;
    setDetalhe(imp);
    setItensDetalhe(null);
    setCarregandoDetalhe(true);
    try {
      const itens = await listarItensImportacao(userId, imp.id);
      setItensDetalhe(itens);
    } catch (e) {
      console.error(e);
      toast.error(i18n.t("common:errors.loadDetails"));
    } finally {
      setCarregandoDetalhe(false);
    }
  }

  async function handleExcluir(modo: "historico" | "tudo") {
    if (!userId || !confirmar) return;
    setExcluindo(true);
    try {
      if (modo === "historico") {
        await excluirImportacaoSomenteHistorico(confirmar.id);
        toast.success("Histórico da importação excluído.");
      } else {
        await excluirImportacaoComDados(userId, confirmar.id);
        toast.success("Importação e dados vinculados excluídos.");
      }
      setConfirmar(null);
      setDetalhe(null);
      onChanged();
    } catch (e) {
      console.error(e);
      toastFromError(e, "Não foi possível excluir.");
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Histórico de importações</DialogTitle>
            <DialogDescription>
              Veja todas as importações realizadas e remova quando precisar.
            </DialogDescription>
          </DialogHeader>

          {importacoes.length === 0 ? (
            <div className="py-10 text-center">
              <div className="mx-auto h-12 w-12 rounded-2xl bg-brand-soft/60 grid place-items-center text-brand-on-soft mb-3">
                <History className="h-5 w-5" />
              </div>
              <h3 className="font-semibold">Nenhuma importação ainda</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                Quando você importar extratos da B3, corretora, CSV ou PDF, eles aparecerão aqui.
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {importacoes.map((imp) => {
                const r = imp.resumo ?? {};
                const data = new Date(imp.created_at).toLocaleDateString("pt-BR");
                return (
                  <li
                    key={imp.id}
                    className="rounded-xl border border-border/60 bg-card/40 p-3"
                  >
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">
                          {imp.arquivo_nome || "Importação manual"}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <Badge variant="secondary" className="text-[10px]">
                            {TIPO_IMPORTACAO_LABEL[imp.tipo] ?? imp.tipo}
                          </Badge>
                          <Badge
                            variant={imp.status === "concluida" ? "secondary" : "outline"}
                            className="text-[10px] capitalize"
                          >
                            {imp.status}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">
                            Importado em {data}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1.5">
                          {(r.ativos ?? 0)} ativos · {(r.movimentacoes ?? 0)} movimentações ·{" "}
                          {(r.rendimentos ?? 0)} rendimentos
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => abrirDetalhe(imp)}>
                          Ver detalhes
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9 text-rose-500 hover:text-rose-500"
                          onClick={() => setConfirmar(imp)}
                          aria-label="Excluir importação"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detalhes */}
      <Dialog open={!!detalhe} onOpenChange={(v) => !v && setDetalhe(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes da importação</DialogTitle>
            <DialogDescription>
              {detalhe?.arquivo_nome || "Importação manual"} ·{" "}
              {detalhe ? new Date(detalhe.created_at).toLocaleDateString("pt-BR") : ""}
            </DialogDescription>
          </DialogHeader>

          {carregandoDetalhe ? (
            <p className="text-sm text-muted-foreground py-6 text-center">{i18n.t("common:loading.investmentDetails")}</p>
          ) : itensDetalhe ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <MiniStat label="Ativos" value={String(itensDetalhe.ativos.length)} />
                <MiniStat label="Movimentações" value={String(itensDetalhe.movimentacoes.length)} />
                <MiniStat label="Rendimentos" value={String(itensDetalhe.rendimentos.length)} />
              </div>

              {itensDetalhe.ativos.length > 0 && (
                <section>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                    Ativos criados
                  </div>
                  <ul className="space-y-1">
                    {itensDetalhe.ativos.map((a) => (
                      <li key={a.id} className="flex justify-between gap-2">
                        <span className="truncate">{a.nome}</span>
                        <span className="text-xs text-muted-foreground">{getTipoInvestimentoLabel(a.tipo, tInv)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {itensDetalhe.movimentacoes.length > 0 && (
                <section>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                    Movimentações
                  </div>
                  <ul className="space-y-1">
                    {itensDetalhe.movimentacoes.map((m) => (
                      <li key={m.id} className="flex justify-between gap-2">
                        <span className="capitalize">{m.tipo}</span>
                        <span className="text-xs text-muted-foreground">{m.data}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {itensDetalhe.rendimentos.length > 0 && (
                <section>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                    Rendimentos
                  </div>
                  <ul className="space-y-1">
                    {itensDetalhe.rendimentos.map((r) => (
                      <li key={r.id} className="flex justify-between gap-2">
                        <span className="capitalize">{r.tipo.replace("_", " ")}</span>
                        <span className="text-xs text-muted-foreground">{r.data_pagamento}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {detalhe?.erros && (
                <div className="rounded-lg bg-rose-500/10 text-rose-500 p-2.5 text-xs">
                  {detalhe.erros}
                </div>
              )}
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDetalhe(null)}>Fechar</Button>
            {detalhe && (
              <Button variant="destructive" onClick={() => setConfirmar(detalhe)}>
                <Trash2 className="h-4 w-4 mr-1.5" /> Excluir
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar exclusão — modal premium com 2 caminhos claros */}
      <Dialog open={!!confirmar} onOpenChange={(v) => !v && !excluindo && setConfirmar(null)}>
        <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
          {/* Cabeçalho com ícone destaque */}
          <div className="px-6 pt-6 pb-4 bg-gradient-to-br from-destructive/10 via-transparent to-transparent border-b border-border/60">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-destructive/15 text-destructive shadow-sm">
                <Trash2 className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <DialogHeader className="space-y-1 text-left">
                  <DialogTitle className="text-lg leading-tight">
                    Excluir esta importação?
                  </DialogTitle>
                  <DialogDescription className="text-sm">
                    Escolha como deseja remover esta importação dos seus registros.
                  </DialogDescription>
                </DialogHeader>
              </div>
            </div>
          </div>

          {/* Opções como cards selecionáveis */}
          <div className="px-6 py-5 space-y-3">
            {/* Opção 1: somente histórico */}
            <button
              type="button"
              onClick={() => !excluindo && handleExcluir("historico")}
              disabled={excluindo}
              className={cn(
                "group w-full flex items-start gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-all",
                "hover:border-brand/60 hover:bg-card-elevated hover:shadow-md",
                "disabled:opacity-60 disabled:cursor-not-allowed",
              )}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground group-hover:bg-brand-soft group-hover:text-brand-on-soft transition-colors">
                <History className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm">Excluir apenas histórico</p>
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                  Remove o registro desta importação da lista de histórico.
                  Os ativos, movimentações e rendimentos criados por ela{" "}
                  <strong className="text-foreground">permanecem</strong> na sua carteira.
                </p>
              </div>
            </button>

            {/* Opção 2: tudo relacionado — destacada como destrutiva */}
            <button
              type="button"
              onClick={() => !excluindo && handleExcluir("tudo")}
              disabled={excluindo}
              className={cn(
                "group w-full flex items-start gap-3 rounded-2xl border-2 border-destructive/30 bg-destructive/5 p-4 text-left transition-all",
                "hover:border-destructive hover:bg-destructive/10 hover:shadow-lg hover:shadow-destructive/10",
                "disabled:opacity-60 disabled:cursor-not-allowed",
              )}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-destructive/15 text-destructive">
                <Trash2 className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm text-destructive">
                  Excluir tudo relacionado
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                  Remove o registro <strong className="text-foreground">e</strong> os
                  ativos, movimentações e rendimentos que esta importação criou.
                  Esta ação não pode ser desfeita.
                </p>
              </div>
            </button>

            {/* Aviso de segurança */}
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/8 p-3">
              <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
              <p className="text-xs text-amber-200/90 leading-relaxed">
                <strong className="text-amber-300">Investimentos cadastrados manualmente
                não são afetados</strong> — apenas itens vinculados a esta importação
                serão removidos.
              </p>
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t border-border/60 bg-muted/30">
            <Button
              variant="ghost"
              onClick={() => setConfirmar(null)}
              disabled={excluindo}
              className="w-full sm:w-auto"
            >
              Cancelar
            </Button>
            {excluindo && (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
                Excluindo…
              </span>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ===== Modal: Atualizar valor (individual) =====
function AtualizarValorDialog({
  ativo,
  userId,
  onClose,
  onSaved,
}: {
  ativo: Ativo | null;
  userId: string | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t: tInv } = useTranslation("investimentos");
  const [valorAtual, setValorAtual] = useState("");
  const [precoAtual, setPrecoAtual] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [observacao, setObservacao] = useState("");
  const [data, setData] = useState(todayISO());
  const [salvando, setSalvando] = useState(false);

  const isVariavel = ativo
    ? ["acoes", "fii", "etf", "bdr", "cripto"].includes(ativo.tipo)
    : false;

  useEffect(() => {
    if (!ativo) return;
    setValorAtual(
      ativo.valor_atual != null ? String(ativo.valor_atual).replace(".", ",") : "",
    );
    setPrecoAtual(
      ativo.preco_atual != null ? String(ativo.preco_atual).replace(".", ",") : "",
    );
    setQuantidade(
      ativo.quantidade != null ? String(ativo.quantidade).replace(".", ",") : "",
    );
    setObservacao("");
    setData(todayISO());
  }, [ativo]);

  // Auto-calcular valor atual a partir de preço × quantidade (renda variável)
  useEffect(() => {
    if (!isVariavel) return;
    const p = Number(precoAtual.replace(",", "."));
    const q = Number(quantidade.replace(",", "."));
    if (p > 0 && q > 0) {
      setValorAtual((p * q).toFixed(2).replace(".", ","));
    }
  }, [precoAtual, quantidade, isVariavel]);

  if (!ativo) return null;

  async function salvar() {
    if (!ativo || !userId) return;
    const valorNovo = parseBRLInput(valorAtual);
    if (!Number.isFinite(valorNovo) || valorNovo < 0) {
      toast.error("Informe um valor atual válido.");
      return;
    }
    setSalvando(true);
    try {
      await atualizarValorAtivo(userId, ativo, {
        valor_novo: valorNovo,
        preco_novo: precoAtual ? parseBRLInput(precoAtual) : null,
        quantidade: quantidade ? Number(quantidade.replace(",", ".")) : null,
        observacao: observacao || null,
        data_atualizacao: new Date(data + "T" + new Date().toTimeString().slice(0, 8)).toISOString(),
        origem: "manual",
      });
      toast.success("Valor atualizado.");
      onSaved();
    } catch (e) {
      console.error(e);
      toastFromError(e, "Não foi possível atualizar o valor.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={!!ativo} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> Atualizar valor
          </DialogTitle>
          <DialogDescription>
            Atualização manual · valor informado pelo usuário.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Investimento</label>
            <div className="text-sm font-medium">{ativo.nome}</div>
            <div className="text-[11px] text-muted-foreground">
              {getTipoInvestimentoLabel(ativo.tipo, tInv)}
              {ativo.instituicao ? ` · ${ativo.instituicao}` : ""}
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Valor aplicado</label>
            <Input
              value={formatBRL(Number(ativo.valor_aplicado || 0))}
              disabled
              className="bg-muted/30"
            />
          </div>

          {isVariavel && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Preço atual</label>
                <Input
                  value={precoAtual}
                  onChange={(e) => setPrecoAtual(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Quantidade</label>
                <Input
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground">
              Valor atual{isVariavel ? " (calculado)" : ""}
            </label>
            <Input
              value={valorAtual}
              onChange={(e) => setValorAtual(e.target.value)}
              placeholder="0,00"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Data da atualização</label>
            <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Observação</label>
            <Textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ex.: cotação consultada na corretora"
              rows={2}
            />
          </div>

          {ativo.ultima_atualizacao && (
            <div className="text-[11px] text-muted-foreground">
              Última atualização: {formatarDataHora(ativo.ultima_atualizacao)}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar atualização"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===== Modal: Atualizar valores em lote =====
function AtualizarLoteDialog({
  open,
  onOpenChange,
  ativos,
  userId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ativos: Ativo[];
  userId: string | undefined;
  onSaved: () => void;
}) {
  const { t: tInv } = useTranslation("investimentos");
  const [valores, setValores] = useState<Record<string, { valor: string; preco: string; obs: string }>>({});
  const [data, setData] = useState(todayISO());
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!open) return;
    const map: Record<string, { valor: string; preco: string; obs: string }> = {};
    for (const a of ativos) {
      map[a.id] = {
        valor: a.valor_atual != null ? String(a.valor_atual).replace(".", ",") : "",
        preco: a.preco_atual != null ? String(a.preco_atual).replace(".", ",") : "",
        obs: "",
      };
    }
    setValores(map);
    setData(todayISO());
  }, [open, ativos]);

  function setCampo(id: string, campo: "valor" | "preco" | "obs", v: string) {
    setValores((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { valor: "", preco: "", obs: "" }), [campo]: v } }));
  }

  async function salvarTodos() {
    if (!userId) return;
    setSalvando(true);
    let ok = 0;
    let erros = 0;
    const dataIso = new Date(data + "T" + new Date().toTimeString().slice(0, 8)).toISOString();
    for (const a of ativos) {
      const entry = valores[a.id];
      if (!entry) continue;
      const isVariavel = ["acoes", "fii", "etf", "bdr", "cripto"].includes(a.tipo);
      let valorNovo = parseBRLInput(entry.valor);
      const precoNovo = entry.preco ? parseBRLInput(entry.preco) : null;
      // Se variável e tem preço + quantidade existente, recalcular valor automaticamente
      if (isVariavel && precoNovo != null && a.quantidade && a.quantidade > 0) {
        valorNovo = precoNovo * Number(a.quantidade);
      }
      const valorAnterior = Number(a.valor_atual ?? 0);
      const precoAnterior = a.preco_atual != null ? Number(a.preco_atual) : null;
      // Pula se nada mudou
      if (
        valorNovo === valorAnterior &&
        (precoNovo ?? null) === precoAnterior &&
        !entry.obs
      ) {
        continue;
      }
      if (!Number.isFinite(valorNovo)) {
        erros++;
        continue;
      }
      try {
        await atualizarValorAtivo(userId, a, {
          valor_novo: valorNovo,
          preco_novo: precoNovo,
          observacao: entry.obs || null,
          data_atualizacao: dataIso,
          origem: "manual",
        });
        ok++;
      } catch (e) {
        console.error(e);
        erros++;
      }
    }
    setSalvando(false);
    if (ok > 0) toast.success(`${ok} investimento(s) atualizado(s).`);
    if (erros > 0) toast.error(`${erros} falha(s) ao atualizar.`);
    if (ok === 0 && erros === 0) toast.info("Nenhuma alteração para salvar.");
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> Atualizar valores
          </DialogTitle>
          <DialogDescription>
            Atualize os valores atuais dos seus investimentos. Valor informado pelo usuário.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 mb-2">
          <label className="text-xs text-muted-foreground">Data da atualização</label>
          <Input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="max-w-[180px]"
          />
        </div>

        <div className="space-y-3">
          {ativos.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhum investimento cadastrado.
            </p>
          ) : (
            ativos.map((a) => {
              const isVariavel = ["acoes", "fii", "etf", "bdr", "cripto"].includes(a.tipo);
              const ult = descreverUltimaAtualizacao(a.ultima_atualizacao);
              const entry = valores[a.id] ?? { valor: "", preco: "", obs: "" };
              return (
                <div key={a.id} className="rounded-xl border border-border/40 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <div className="text-sm font-medium">{a.nome}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {getTipoInvestimentoLabel(a.tipo, tInv)} · Aplicado {formatBRL(Number(a.valor_aplicado || 0))}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] gap-1 ${ult.desatualizado ? "border-amber-500/40 text-amber-500" : "text-muted-foreground"}`}
                    >
                      <Clock className="h-2.5 w-2.5" />
                      {ult.label}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    {isVariavel && (
                      <div>
                        <label className="text-[11px] text-muted-foreground">Preço atual</label>
                        <Input
                          value={entry.preco}
                          onChange={(e) => setCampo(a.id, "preco", e.target.value)}
                          placeholder="0,00"
                        />
                      </div>
                    )}
                    <div className={isVariavel ? "" : "md:col-span-2"}>
                      <label className="text-[11px] text-muted-foreground">Valor atual</label>
                      <Input
                        value={entry.valor}
                        onChange={(e) => setCampo(a.id, "valor", e.target.value)}
                        placeholder="0,00"
                      />
                    </div>
                    <div className={isVariavel ? "" : "md:col-span-1"}>
                      <label className="text-[11px] text-muted-foreground">Observação</label>
                      <Input
                        value={entry.obs}
                        onChange={(e) => setCampo(a.id, "obs", e.target.value)}
                        placeholder="opcional"
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvarTodos} disabled={salvando || ativos.length === 0}>
            {salvando ? "Salvando…" : "Salvar atualizações"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===== Modal: Movimentação =====
const TIPOS_MOV_PRINCIPAIS: TipoMovimentacao[] = [
  "compra",
  "venda",
  "aplicacao",
  "resgate",
  "transferencia",
  "rendimento",
  "dividendo",
  "jcp",
  "amortizacao",
  "bonificacao",
];

function MovimentacaoDialog({
  state,
  ativos,
  userId,
  onClose,
  onSaved,
}: {
  state: { open: boolean; mov: Movimentacao | null; ativoId?: string | null };
  ativos: Ativo[];
  userId: string | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t: tInv } = useTranslation("investimentos");
  const editing = state.mov;
  const [ativoId, setAtivoId] = useState<string>("");
  const [tipo, setTipo] = useState<TipoMovimentacao>("compra");
  const [data, setData] = useState(todayISO());
  const [quantidade, setQuantidade] = useState("");
  const [valorUnitario, setValorUnitario] = useState("");
  const [valorTotal, setValorTotal] = useState("");
  const [instituicao, setInstituicao] = useState("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  const ativoSelecionado = useMemo(() => ativos.find((a) => a.id === ativoId) ?? null, [ativos, ativoId]);
  const variavel = ativoSelecionado ? isRendaVariavel(ativoSelecionado.tipo) : false;

  useEffect(() => {
    if (!state.open) return;
    if (editing) {
      setAtivoId(editing.ativo_id ?? "");
      setTipo(editing.tipo);
      setData(editing.data ?? todayISO());
      setQuantidade(editing.quantidade != null ? String(editing.quantidade).replace(".", ",") : "");
      setValorUnitario(editing.valor_unitario != null ? String(editing.valor_unitario).replace(".", ",") : "");
      setValorTotal(editing.valor_total != null ? String(editing.valor_total).replace(".", ",") : "");
      setInstituicao(editing.instituicao ?? "");
      setObservacao(editing.observacao ?? "");
    } else {
      setAtivoId(state.ativoId ?? (ativos[0]?.id ?? ""));
      setTipo("compra");
      setData(todayISO());
      setQuantidade("");
      setValorUnitario("");
      setValorTotal("");
      setInstituicao("");
      setObservacao("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open, state.mov, state.ativoId]);

  // Auto-cálculo: quantidade × valor unitário => total (renda variável)
  useEffect(() => {
    if (!variavel) return;
    const q = Number(quantidade.replace(",", "."));
    const vu = Number(valorUnitario.replace(",", "."));
    if (q > 0 && vu > 0) {
      setValorTotal((q * vu).toFixed(2).replace(".", ","));
    }
  }, [quantidade, valorUnitario, variavel]);

  async function salvar() {
    if (!userId) return;
    if (!ativoId) {
      toast.error("Selecione um investimento.");
      return;
    }
    const vt = parseBRLInput(valorTotal);
    if (!Number.isFinite(vt) || vt < 0) {
      toast.error("Informe um valor total válido.");
      return;
    }
    const payload: Partial<Movimentacao> = {
      ativo_id: ativoId,
      tipo,
      data,
      quantidade: quantidade ? Number(quantidade.replace(",", ".")) : null,
      valor_unitario: valorUnitario ? parseBRLInput(valorUnitario) : null,
      valor_total: vt,
      instituicao: instituicao || null,
      observacao: observacao || null,
      origem: "manual",
    };
    setSalvando(true);
    try {
      if (editing) {
        await atualizarMovimentacao(editing.id, payload);
        // se trocou de ativo, recalcular ambos
        const oldAtivo = editing.ativo_id;
        if (oldAtivo && oldAtivo !== ativoId) {
          await recalcularAtivoPorMovimentacoes(userId, oldAtivo);
        }
      } else {
        await criarMovimentacao(userId, payload);
      }
      await recalcularAtivoPorMovimentacoes(userId, ativoId);
      toast.success(editing ? "Movimentação atualizada." : "Movimentação adicionada.");
      onSaved();
    } catch (e) {
      console.error(e);
      toastFromError(e, "Não foi possível salvar a movimentação.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={state.open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4" />
            {editing ? "Editar movimentação" : "Nova movimentação"}
          </DialogTitle>
          <DialogDescription>Registro manual · não realiza compra ou venda real.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Investimento</label>
            <Select value={ativoId} onValueChange={setAtivoId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {ativos.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.nome} ({getTipoInvestimentoLabel(a.tipo, tInv)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Tipo</label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoMovimentacao)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_MOVIMENTACAO.filter((m) => TIPOS_MOV_PRINCIPAIS.includes(m.id) || m.id === tipo).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {getTipoMovimentacaoLabel(m.id, tInv)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Data</label>
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
          </div>

          {variavel && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Quantidade</label>
                <Input
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Valor unitário</label>
                <Input
                  value={valorUnitario}
                  onChange={(e) => setValorUnitario(e.target.value)}
                  placeholder="0,00"
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground">
              Valor total{variavel ? " (calculado)" : ""}
            </label>
            <Input
              value={valorTotal}
              onChange={(e) => setValorTotal(e.target.value)}
              placeholder="0,00"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Instituição / corretora</label>
            <Input
              value={instituicao}
              onChange={(e) => setInstituicao(e.target.value)}
              placeholder="Ex.: NuInvest, XP, Banco Inter"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Observação</label>
            <Textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
              placeholder="opcional"
            />
          </div>

          {ativoSelecionado && !variavel && (
            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <Info className="h-3 w-3 mt-0.5 shrink-0" />
              Para renda fixa, quantidade não é obrigatória. Os totais do investimento serão recalculados automaticamente.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : editing ? "Salvar" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===== Modal: Rendimento =====
function RendimentoDialog({
  state,
  ativos,
  userId,
  onClose,
  onSaved,
}: {
  state: { open: boolean; rend: Rendimento | null; ativoId?: string | null };
  ativos: Ativo[];
  userId: string | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t: tInv } = useTranslation("investimentos");
  const editing = state.rend;
  const [ativoId, setAtivoId] = useState<string>("");
  const [tipo, setTipo] = useState<TipoRendimento>("dividendo");
  const [dataPag, setDataPag] = useState(todayISO());
  const [valor, setValor] = useState("");
  const [status, setStatus] = useState<"recebido" | "previsto">("recebido");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!state.open) return;
    if (editing) {
      setAtivoId(editing.ativo_id ?? "");
      setTipo(editing.tipo);
      setDataPag(editing.data_pagamento ?? todayISO());
      setValor(editing.valor != null ? String(editing.valor).replace(".", ",") : "");
      setStatus(editing.status);
      setObservacao(editing.observacao ?? "");
    } else {
      setAtivoId(state.ativoId ?? (ativos[0]?.id ?? ""));
      setTipo("dividendo");
      setDataPag(todayISO());
      setValor("");
      setStatus("recebido");
      setObservacao("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open, state.rend, state.ativoId]);

  async function salvar() {
    if (!userId) return;
    if (!ativoId) {
      toast.error("Selecione um investimento.");
      return;
    }
    const v = parseBRLInput(valor);
    if (!Number.isFinite(v) || v <= 0) {
      toast.error("Informe um valor válido.");
      return;
    }
    const payload: Partial<Rendimento> = {
      ativo_id: ativoId,
      tipo,
      data_pagamento: dataPag,
      valor: v,
      status,
      observacao: observacao || null,
      origem: "manual",
    };
    setSalvando(true);
    try {
      if (editing) await atualizarRendimento(editing.id, payload);
      else await criarRendimento(userId, payload);
      toast.success(editing ? "Rendimento atualizado." : "Rendimento adicionado.");
      onSaved();
    } catch (e) {
      console.error(e);
      toastFromError(e, "Não foi possível salvar o rendimento.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={state.open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins className="h-4 w-4" />
            {editing ? "Editar rendimento" : "Novo rendimento"}
          </DialogTitle>
          <DialogDescription>Registro manual · valor informado pelo usuário.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Investimento</label>
            <Select value={ativoId} onValueChange={setAtivoId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {ativos.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.nome} ({getTipoInvestimentoLabel(a.tipo, tInv)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Tipo</label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoRendimento)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_RENDIMENTO.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {getTipoRendimentoLabel(r.id, tInv)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Status</label>
              <Select value={status} onValueChange={(v) => setStatus(v as "recebido" | "previsto")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recebido">Recebido</SelectItem>
                  <SelectItem value="previsto">Previsto</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Data de pagamento</label>
              <Input type="date" value={dataPag} onChange={(e) => setDataPag(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Valor recebido</label>
              <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Observação</label>
            <Textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
              placeholder="opcional"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : editing ? "Salvar" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===== Modal: Detalhe do investimento =====
function DetalheAtivoDialog({
  ativo,
  movimentacoes,
  rendimentos,
  onClose,
  onEditar,
  onAtualizarValor,
  onAddMovimentacao,
  onAddRendimento,
  onExcluirAtivo,
}: {
  ativo: Ativo | null;
  movimentacoes: Movimentacao[];
  rendimentos: Rendimento[];
  onClose: () => void;
  onEditar: (a: Ativo) => void;
  onAtualizarValor: (a: Ativo) => void;
  onAddMovimentacao: (a: Ativo) => void;
  onAddRendimento: (a: Ativo) => void;
  onExcluirAtivo: (a: Ativo) => void;
}) {
  const { t: tInv } = useTranslation("investimentos");
  if (!ativo) return null;

  const movs = movimentacoes.filter((m) => m.ativo_id === ativo.id);
  const rends = rendimentos.filter((r) => r.ativo_id === ativo.id);
  const lucro = Number(ativo.valor_atual || 0) - Number(ativo.valor_aplicado || 0);
  const rent = Number(ativo.valor_aplicado || 0) > 0 ? (lucro / Number(ativo.valor_aplicado)) * 100 : 0;
  const ult = descreverUltimaAtualizacao(ativo.ultima_atualizacao);
  const totalRends = rends.filter((r) => r.status === "recebido").reduce((s, r) => s + Number(r.valor || 0), 0);

  return (
    <Dialog open={!!ativo} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="truncate">{ativo.nome}</span>
            <Badge variant="secondary" className="text-[10px]">{tipoLabel(ativo.tipo)}</Badge>
          </DialogTitle>
          <DialogDescription>
            {ativo.instituicao ?? "—"} · {classeAtivo(ativo.tipo)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <MiniStat label="Aplicado" value={formatBRL(Number(ativo.valor_aplicado || 0))} />
          <MiniStat label="Atual" value={formatBRL(Number(ativo.valor_atual || 0))} />
          <MiniStat
            label="Lucro / Prejuízo"
            value={`${lucro >= 0 ? "+" : ""}${formatBRL(lucro)}`}
          />
          <MiniStat
            label="Rentabilidade"
            value={`${rent >= 0 ? "+" : ""}${rent.toFixed(2)}%`}
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-xs text-muted-foreground">
          {ativo.quantidade != null && (
            <div><span className="block uppercase tracking-wide text-[10px]">Quantidade</span>{ativo.quantidade}</div>
          )}
          {ativo.preco_medio != null && (
            <div><span className="block uppercase tracking-wide text-[10px]">Preço médio</span>{formatBRL(Number(ativo.preco_medio))}</div>
          )}
          <div className="col-span-2 md:col-span-2 flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            <span>
              Última atualização:{" "}
              {ativo.ultima_atualizacao ? formatarDataHora(ativo.ultima_atualizacao) : "valor informado no cadastro"}
            </span>
            {ult.desatualizado && ativo.ultima_atualizacao && (
              <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-500">desatualizado</Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <Button size="sm" variant="outline" onClick={() => onEditar(ativo)}>
            <Pencil className="h-3.5 w-3.5 mr-1.5" /> Editar
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAtualizarValor(ativo)}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Atualizar valor
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAddMovimentacao(ativo)}>
            <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" /> Movimentação
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAddRendimento(ativo)}>
            <HandCoins className="h-3.5 w-3.5 mr-1.5" /> Rendimento
          </Button>
          <Button size="sm" variant="outline" className="text-rose-500 hover:text-rose-500" onClick={() => onExcluirAtivo(ativo)}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Excluir
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <section className="rounded-xl border border-border/40 p-3">
            <h3 className="text-sm font-semibold mb-2 flex items-center justify-between">
              <span>Movimentações</span>
              <span className="text-[10px] text-muted-foreground">{movs.length}</span>
            </h3>
            {movs.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sem movimentações.</p>
            ) : (
              <ul className="divide-y divide-border/30 text-xs max-h-64 overflow-y-auto">
                {movs.map((m) => (
                  <li key={m.id} className="py-1.5 flex justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium capitalize">{m.tipo}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {formatDataBR(m.data)}{m.instituicao ? ` · ${m.instituicao}` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{formatBRL(Number(m.valor_total || 0))}</div>
                      {m.quantidade ? <div className="text-[10px] text-muted-foreground">{m.quantidade}</div> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-border/40 p-3">
            <h3 className="text-sm font-semibold mb-2 flex items-center justify-between">
              <span>Rendimentos</span>
              <span className="text-[10px] text-muted-foreground">
                {totalRends > 0 ? `+${formatBRL(totalRends)}` : "0"}
              </span>
            </h3>
            {rends.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sem rendimentos.</p>
            ) : (
              <ul className="divide-y divide-border/30 text-xs max-h-64 overflow-y-auto">
                {rends.map((r) => (
                  <li key={r.id} className="py-1.5 flex justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium capitalize">{r.tipo.replace(/_/g, " ")}</div>
                      <div className="text-[10px] text-muted-foreground">{formatDataBR(r.data_pagamento)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-emerald-500">+{formatBRL(Number(r.valor || 0))}</div>
                      <Badge variant="secondary" className="text-[9px]">{r.status}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
