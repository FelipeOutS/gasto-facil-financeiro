import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Plus,
  RefreshCw,
  CalendarClock,
  TrendingUp,
  AlertTriangle,
  Pause,
  Play,
  X,
  Check,
  History,
  Pencil,
  Trash2,
  Sparkles,
  CreditCard,
  Wallet,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { TransactionAvatar } from "@/components/TransactionAvatar";
import { RecorrenciaDialog } from "@/components/assinaturas/RecorrenciaForm";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { formatBRL, parseDateLocal } from "@/lib/format";
import { requireOnline } from "@/lib/use-online-status";
import { confirmAsync } from "@/components/ConfirmDialog";
import { useAuth } from "@/lib/auth-context";
import { usePlan } from "@/lib/use-plan";
import { PremiumLockModal } from "@/components/PremiumLockModal";
import { Lock } from "lucide-react";

import {
  useStore,
  getCategorias,
  getCartoes,
  getCategoriaById,
  getCartaoById,
  getLimite,
  getGastos,
  refreshGastos,
  useBootstrap,
} from "@/lib/store";
import {
  hydrateRecorrencias,
  useRecorrencias,
  sincronizarDeteccoes,
  totaisRecorrencias,
  atualizarRecorrencia,
  excluirRecorrencia,
  gerarGastoDoMes,
  historicoDaRecorrencia,
  type Recorrencia,
  type FrequenciaRecorrencia,
  type StatusRecorrencia,
  type TipoRecorrencia,
} from "@/lib/recorrencias";
import { FORMAS_PAGAMENTO } from "@/lib/types";

export const Route = createFileRoute("/assinaturas/")({
  head: () => ({
    meta: [
      { title: "Assinaturas e recorrências — Gasto Inteligente" },
      {
        name: "description",
        content:
          "Veja quais gastos voltam todo mês e quanto eles pesam no seu orçamento.",
      },
    ],
  }),
  component: AssinaturasPage,
});

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function useLabels() {
  const { t } = useTranslation("assinaturas");
  const freqLabel = (f: FrequenciaRecorrencia) => t(`freq.${f}`);
  const statusLabel = (s: StatusRecorrencia) => t(`status.${s}`);
  const tipoLabel = (k: TipoRecorrencia) => t(`tipo.${k}`);
  return { t, freqLabel, statusLabel, tipoLabel };
}

const STATUS_BADGE: Record<StatusRecorrencia, string> = {
  ativa: "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
  pausada: "border-amber-500/40 text-amber-400 bg-amber-500/10",
  cancelada: "border-zinc-500/40 text-zinc-400 bg-zinc-500/10",
  suspeita: "border-sky-500/40 text-sky-400 bg-sky-500/10",
  aguardando: "border-violet-500/40 text-violet-400 bg-violet-500/10",
};

function diasAteHoje(iso?: string | null): number | null {
  if (!iso) return null;
  const d = parseDateLocal(iso);
  if (!d) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - hoje.getTime()) / 86400000);
  return diff;
}

function describePrazo(t: TFn, iso?: string | null, locale = "pt-BR"): string {
  const d = diasAteHoje(iso);
  if (d == null) return t("prazo.dash");
  if (d < 0) {
    const n = Math.abs(d);
    return n === 1 ? t("prazo.agoOne", { count: n }) : t("prazo.agoOther", { count: n });
  }
  if (d === 0) return t("prazo.today");
  if (d === 1) return t("prazo.tomorrow");
  if (d < 30) return t("prazo.inDays", { count: d });
  return parseDateLocal(iso!)!.toLocaleDateString(locale);
}

function AssinaturasPage() {
  const { t, freqLabel, statusLabel, tipoLabel } = useLabels();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const ready = useBootstrap();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const recs = useRecorrencias();
  const gastos = useStore(getGastos);
  const categorias = useStore(getCategorias);
  const cartoes = useStore(getCartoes);

  const [syncing, setSyncing] = useState(false);
  const { can } = usePlan();
  const canAutomations = can("assinaturas_recorrencias");
  const [premiumOpen, setPremiumOpen] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Recorrencia | null>(null);
  const [historicoOpen, setHistoricoOpen] = useState<Recorrencia | null>(null);
  const [filtroStatus, setFiltroStatus] = useState<"todas" | StatusRecorrencia>(
    "todas",
  );
  const [debugAnalise, setDebugAnalise] = useState<null | {
    gastos: number;
    analisados: number;
    encontradas: number;
    criadas: number;
    suspeitas: number;
    assinaturas: number;
    fixas: number;
    nomes: string[];
  }>(null);

  const categoriaNomePorId = useMemo(() => {
    const map = new Map(categorias.map((c) => [c.id, c.nome]));
    return (id: string | null | undefined) => (id ? map.get(id) ?? null : null);
  }, [categorias]);

  function openCreate() {
    if (isMobile) {
      void navigate({ to: "/assinaturas/nova" });
      return;
    }
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(r: Recorrencia) {
    if (isMobile) {
      void navigate({ to: "/assinaturas/$id/editar", params: { id: r.id } });
      return;
    }
    setEditing(r);
    setDialogOpen(true);
  }

  useEffect(() => {
    if (!userId || !ready) return;
    let cancelado = false;
    (async () => {
      await refreshGastos();
      await hydrateRecorrencias(userId);
      if (cancelado) return;
      const gastosAtuais = getGastos();
      const r = await sincronizarDeteccoes(userId, gastosAtuais, {
        categoriaNomePorId,
      });
      if (cancelado) return;
      setDebugAnalise({
        gastos: gastosAtuais.length,
        analisados: r.analisados,
        encontradas: r.encontradas,
        criadas: r.criadas,
        suspeitas: r.suspeitas,
        assinaturas: r.assinaturas,
        fixas: r.fixas,
        nomes: gastosAtuais.map((g) => g.estabelecimento || g.descricao).filter(Boolean).slice(0, 20),
      });
      if (r.criadas + r.suspeitas > 0) {
        toast.success(
          r.suspeitas
            ? t("toasts.detectedWithSuspects", { criadas: r.criadas, suspeitas: r.suspeitas })
            : t("toasts.detected", { criadas: r.criadas }),
        );
      }
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, ready]);

  const totais = useMemo(() => totaisRecorrencias(recs), [recs]);

  const recsFiltradas = useMemo(() => {
    if (filtroStatus === "todas") return recs;
    return recs.filter((r) => r.status === filtroStatus);
  }, [recs, filtroStatus]);

  const suspeitas = recs.filter((r) => r.status === "suspeita");

  const insights = useMemo(() => {
    const out: string[] = [];
    const ativas = recs.filter((r) => r.status === "ativa");
    if (ativas.length === 0) return out;
    const maior = ativas.reduce((a, b) => (a.valor > b.valor ? a : b));
    out.push(
      t("insights.totals", {
        monthly: formatBRL(totais.mensal),
        yearly: formatBRL(totais.anual),
      }),
    );
    out.push(t("insights.biggest", { name: maior.nome }));
    const porCartao = new Map<string, number>();
    for (const r of ativas) {
      if (!r.cartaoId) continue;
      porCartao.set(r.cartaoId, (porCartao.get(r.cartaoId) ?? 0) + 1);
    }
    if (porCartao.size > 0) {
      const [topCartao] = [...porCartao.entries()].sort((a, b) => b[1] - a[1]);
      const card = getCartaoById(topCartao[0]);
      if (card && topCartao[1] >= 2) {
        out.push(t("insights.topCard", { count: topCartao[1], card: card.nome }));
      }
    }
    const aumentos = recs.filter(
      (r) => r.ultimoValor && Math.abs(r.valor - r.ultimoValor) > 0.5,
    );
    for (const r of aumentos.slice(0, 1)) {
      const diff = r.valor - (r.ultimoValor ?? 0);
      if (diff > 0) {
        out.push(t("insights.increase", { diff: formatBRL(diff), name: r.nome }));
      }
    }
    return out;
  }, [recs, totais, t]);

  const orcamentoAssinaturas = useMemo(() => {
    const cat = categorias.find(
      (c) => c.nome.toLowerCase() === "assinaturas",
    );
    if (!cat) return null;
    const hoje = new Date();
    const limite = getLimite(cat.id, hoje.getMonth() + 1, hoje.getFullYear());
    if (!limite) return null;
    const totalRec = recs
      .filter((r) => r.status === "ativa" && r.categoriaId === cat.id)
      .reduce((s, r) => s + r.valor, 0);
    return { limite, totalRec, cat };
  }, [recs, categorias]);

  async function handleSync() {
    if (!userId) return;
    setSyncing(true);
    try {
      await refreshGastos();
      const gastosAtuais = getGastos();
      const r = await sincronizarDeteccoes(userId, gastosAtuais, {
        categoriaNomePorId,
      });
      const nomes = gastosAtuais.map((g) => g.estabelecimento || g.descricao).filter(Boolean);
      setDebugAnalise({
        gastos: gastosAtuais.length,
        analisados: r.analisados,
        encontradas: r.encontradas,
        criadas: r.criadas,
        suspeitas: r.suspeitas,
        assinaturas: r.assinaturas,
        fixas: r.fixas,
        nomes: nomes.slice(0, 20),
      });
      toast.success(
        t("toasts.syncDone", { ativas: r.criadas, suspeitas: r.suspeitas }),
      );
    } finally {
      setSyncing(false);
    }
  }

  async function handleConfirmarSuspeita(r: Recorrencia) {
    if (!(await requireOnline())) return;
    await atualizarRecorrencia(r.id, { status: "ativa" });
    toast.success(t("toasts.confirmed", { name: r.nome }));
  }

  async function handleIgnorar(r: Recorrencia) {
    if (!(await requireOnline())) return;
    await atualizarRecorrencia(r.id, { status: "cancelada" });
    toast(t("toasts.ignored", { name: r.nome }));
  }

  async function handleTogglePause(r: Recorrencia) {
    if (!(await requireOnline())) return;
    const novo: StatusRecorrencia = r.status === "pausada" ? "ativa" : "pausada";
    await atualizarRecorrencia(r.id, { status: novo });
    toast.success(
      novo === "pausada"
        ? t("toasts.paused", { name: r.nome })
        : t("toasts.reactivated", { name: r.nome }),
    );
  }

  async function handleCancelar(r: Recorrencia) {
    const ok = await confirmAsync({
      title: t("confirms.cancel", { name: r.nome }),
      destructive: true,
    });
    if (!ok) return;
    if (!(await requireOnline())) return;
    await atualizarRecorrencia(r.id, { status: "cancelada" });
    toast.success(t("toasts.canceled"));
  }

  async function handleExcluir(r: Recorrencia) {
    const ok = await confirmAsync({
      title: t("confirms.delete", { name: r.nome }),
      destructive: true,
    });
    if (!ok) return;
    await excluirRecorrencia(r.id);
    toast.success(t("toasts.deleted"));
  }

  async function handleGerarGasto(r: Recorrencia) {
    const res = await gerarGastoDoMes(r);
    if (res.ok) {
      toast.success(t("toasts.expenseCreated"));
    } else {
      toast.error(t("toasts.expenseError"));
    }
  }

  return (
    <MobileShell wide>
      <header className="pt-6 pb-4 lg:pt-10">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
              {t("title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => (canAutomations ? handleSync() : setPremiumOpen(true))}
              disabled={syncing}
              title={!canAutomations ? t("premium.reanalyzeLocked") : undefined}
            >
              {canAutomations ? (
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              ) : (
                <Lock className="h-4 w-4 text-amber-500" />
              )}
              <span className="hidden sm:inline">{t("actions.reanalyze")}</span>
            </Button>

            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{t("actions.new")}</span>
            </Button>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          icon={<CalendarClock className="h-4 w-4" />}
          label={t("summary.monthly")}
          value={formatBRL(totais.mensal)}
        />
        <SummaryCard
          icon={<TrendingUp className="h-4 w-4" />}
          label={t("summary.possible")}
          value={formatBRL(suspeitas.reduce((s, r) => s + r.valor, 0))}
        />
        <SummaryCard
          icon={<Sparkles className="h-4 w-4" />}
          label={t("summary.active")}
          value={`${totais.ativas}`}
        />
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />}
          label={t("summary.suspect")}
          value={`${suspeitas.length}`}
        />
      </section>

      {suspeitas.length > 0 && (
        <section className="mt-5 rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4">
          <div className="flex items-center gap-2 text-sky-400">
            <Sparkles className="h-4 w-4" />
            <h2 className="text-sm font-semibold">
              {t("suspects.heading", { count: suspeitas.length })}
            </h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("suspects.hint")}
          </p>
          <ul className="mt-3 space-y-2">
            {suspeitas.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/40 bg-card/50 p-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <TransactionAvatar
                    estabelecimento={r.nome}
                    categoria={
                      r.categoriaId
                        ? getCategoriaById(r.categoriaId) ?? undefined
                        : undefined
                    }
                    size="md"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.nome}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatBRL(r.valor)} · {tipoLabel(r.tipoRecorrencia)} · {getCategoriaById(r.categoriaId ?? "")?.nome ?? t("suspects.noCategory")} · {freqLabel(r.frequencia)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openEdit(r)}
                  >
                    {t("actions.edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleIgnorar(r)}
                  >
                    {t("actions.ignore")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleConfirmarSuspeita(r)}
                  >
                    <Check className="h-4 w-4" /> {t("actions.confirm")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {insights.length > 0 && (
        <section className="mt-5 rounded-2xl border border-border/60 bg-card/40 p-4">
          <h2 className="text-sm font-semibold">{t("insights.title")}</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            {insights.map((line, i) => (
              <li key={i} className="flex gap-2">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          {orcamentoAssinaturas && (
            <div className="mt-3 rounded-xl border border-border/40 bg-background/40 p-3 text-xs">
              <p className="font-medium text-foreground">
                {t("insights.budgetTitle")}
              </p>
              <p className="text-muted-foreground">
                {t("insights.budgetLine", {
                  limit: formatBRL(orcamentoAssinaturas.limite),
                  total: formatBRL(orcamentoAssinaturas.totalRec),
                })}
              </p>
              {orcamentoAssinaturas.totalRec >
                orcamentoAssinaturas.limite * 0.8 && (
                <p className="mt-1 flex items-center gap-1 text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  {t("insights.budgetWarn")}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <div className="mt-6 flex items-center gap-2 overflow-x-auto pb-2">
        {(["todas", "ativa", "pausada", "suspeita", "cancelada"] as const).map(
          (s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFiltroStatus(s)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                filtroStatus === s
                  ? "border-brand bg-brand-soft text-brand-on-soft"
                  : "border-border/60 text-muted-foreground hover:bg-accent/40"
              }`}
            >
              {s === "todas" ? t("status.all") : statusLabel(s)}
            </button>
          ),
        )}
      </div>

      <section className="mt-2 space-y-3">
        {recsFiltradas.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 p-8 text-center">
            <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">
              {filtroStatus === "todas"
                ? t("empty.none")
                : t("empty.noneStatus", { status: statusLabel(filtroStatus as StatusRecorrencia).toLowerCase() })}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("empty.hint")}
            </p>
            <Button className="mt-4 min-h-11" onClick={openCreate}>
              <Plus className="h-4 w-4" /> {t("empty.cta")}
            </Button>
            {import.meta.env.DEV && debugAnalise && debugAnalise.encontradas === 0 && (
              <div className="mt-4 rounded-xl border border-border/50 bg-background/40 p-3 text-left text-xs text-muted-foreground">
                <p>{t("debug.found", { n: debugAnalise.gastos })}</p>
                <p>{t("debug.analyzed", { n: debugAnalise.analisados })}</p>
                <p>{t("debug.matched", { n: debugAnalise.encontradas })}</p>
                <p>{t("debug.created", { n: debugAnalise.criadas })}</p>
                <p>{t("debug.suspects", { n: debugAnalise.suspeitas })}</p>
                <p>{t("debug.subs", { n: debugAnalise.assinaturas })}</p>
                <p>{t("debug.fixed", { n: debugAnalise.fixas })}</p>
                <p className="mt-2 truncate">{t("debug.sample", { names: debugAnalise.nomes.join(", ") || t("prazo.dash") })}</p>
              </div>
            )}
          </div>
        ) : (
          recsFiltradas.map((r) => (
            <RecorrenciaCard
              key={r.id}
              rec={r}
              onConfirmar={() => handleConfirmarSuspeita(r)}
              onIgnorar={() => handleIgnorar(r)}
              onEdit={() => openEdit(r)}
              onTogglePause={() => handleTogglePause(r)}
              onCancelar={() => handleCancelar(r)}
              onExcluir={() => handleExcluir(r)}
              onHistorico={() => setHistoricoOpen(r)}
              onGerarGasto={() => handleGerarGasto(r)}
            />
          ))
        )}
      </section>

      {/* Desktop: Dialog Nova/Editar (mobile usa páginas dedicadas) */}
      {!isMobile && (
        <RecorrenciaDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editing={editing}
          userId={userId}
          onSaved={() => {
            setDialogOpen(false);
            setEditing(null);
          }}
        />
      )}

      <Dialog
        open={!!historicoOpen}
        onOpenChange={(o) => !o && setHistoricoOpen(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{historicoOpen?.nome}</DialogTitle>
            <DialogDescription>{t("history.title")}</DialogDescription>
          </DialogHeader>
          {historicoOpen && (
            <HistoricoLista rec={historicoOpen} gastos={gastos} />
          )}
        </DialogContent>
      </Dialog>

      <PremiumLockModal
        open={premiumOpen}
        onOpenChange={setPremiumOpen}
        title={t("premium.title")}
        description={t("premium.desc")}
        feature="assinaturas_recorrencias"
      />
    </MobileShell>

  );
}

function SummaryCard({
  icon,
  label,
  value,
  small,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/50 p-3 lg:p-4">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <p
        className={`mt-1.5 font-bold tracking-tight ${small ? "text-base lg:text-lg" : "text-xl lg:text-2xl"}`}
      >
        {value}
      </p>
    </div>
  );
}

function RecorrenciaCard({
  rec,
  onConfirmar,
  onIgnorar,
  onEdit,
  onTogglePause,
  onCancelar,
  onExcluir,
  onHistorico,
  onGerarGasto,
}: {
  rec: Recorrencia;
  onConfirmar: () => void;
  onIgnorar: () => void;
  onEdit: () => void;
  onTogglePause: () => void;
  onCancelar: () => void;
  onExcluir: () => void;
  onHistorico: () => void;
  onGerarGasto: () => void;
}) {
  const { t, freqLabel, statusLabel, tipoLabel } = useLabels();
  const cat = rec.categoriaId ? getCategoriaById(rec.categoriaId) : undefined;
  const cartao = rec.cartaoId ? getCartaoById(rec.cartaoId) : undefined;
  const formaLabel = rec.formaPagamento
    ? FORMAS_PAGAMENTO.find((f) => f.id === rec.formaPagamento)?.label
    : null;
  const aumentou = rec.ultimoValor && rec.valor - rec.ultimoValor > 0.5;

  return (
    <article className="rounded-2xl border border-border/60 bg-card/50 p-3 transition-colors hover:bg-card/70 lg:p-4">
      <div className="flex items-start gap-3">
        <TransactionAvatar
          estabelecimento={rec.nome}
          categoria={cat}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{rec.nome}</h3>
            <Badge
              variant="outline"
              className={`shrink-0 text-[10px] ${STATUS_BADGE[rec.status]}`}
            >
              {statusLabel(rec.status)}
            </Badge>
            {rec.moeda && rec.moeda !== "BRL" && (
              <Badge
                variant="outline"
                className="shrink-0 border-sky-500/40 bg-sky-500/10 text-[10px] text-sky-500"
              >
                {rec.moeda === "USD" ? "🇺🇸 USD" : "🇪🇺 EUR"}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-base font-bold tracking-tight">
            {formatBRL(rec.valor)}
            {rec.moeda && rec.moeda !== "BRL" && rec.valorOriginal ? (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                (~{rec.moeda} {rec.valorOriginal.toFixed(2).replace(".", ",")})
              </span>
            ) : null}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              /{rec.frequencia === "mensal" ? t("freq.monthShort") : freqLabel(rec.frequencia).toLowerCase()}
            </span>
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {tipoLabel(rec.tipoRecorrencia)} · {cat?.nome ?? t("card.noCategory")}
            {formaLabel && ` · ${formaLabel}`}
            {cartao && ` · ${cartao.nome}`}
            {rec.proximaCobranca && ` · ${t("card.nextLabel", { when: describePrazo(t, rec.proximaCobranca) })}`}
          </p>
          {aumentou && (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              {t("card.increased", { diff: formatBRL(rec.valor - (rec.ultimoValor ?? 0)) })}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/40 pt-3">
        <Button size="sm" variant="ghost" onClick={onHistorico}>
          <History className="h-3.5 w-3.5" /> {t("actions.history")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" /> {t("actions.edit")}
        </Button>
        {rec.status === "suspeita" && (
          <>
            <Button size="sm" variant="ghost" onClick={onIgnorar}>
              <X className="h-3.5 w-3.5" /> {t("actions.ignore")}
            </Button>
            <Button size="sm" variant="ghost" onClick={onConfirmar}>
              <Check className="h-3.5 w-3.5" /> {t("actions.confirm")}
            </Button>
          </>
        )}
        {rec.status !== "cancelada" && (
          <>
            <Button size="sm" variant="ghost" onClick={onTogglePause}>
              {rec.status === "pausada" ? (
                <>
                  <Play className="h-3.5 w-3.5" /> {t("actions.reactivate")}
                </>
              ) : (
                <>
                  <Pause className="h-3.5 w-3.5" /> {t("actions.pause")}
                </>
              )}
            </Button>
            <Button size="sm" variant="ghost" onClick={onGerarGasto}>
              <CreditCard className="h-3.5 w-3.5" /> {t("actions.generateExpense")}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancelar}>
              <X className="h-3.5 w-3.5" /> {t("actions.cancel")}
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-destructive hover:text-destructive"
          onClick={onExcluir}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </article>
  );
}

function HistoricoLista({
  rec,
  gastos,
}: {
  rec: Recorrencia;
  gastos: ReturnType<typeof getGastos>;
}) {
  const { t } = useTranslation("assinaturas");
  const historico = useMemo(
    () => historicoDaRecorrencia(rec, gastos),
    [rec, gastos],
  );
  return (
    <div className="space-y-2">
      {historico.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("history.empty")}
        </p>
      )}
      {historico.map((g) => (
        <div
          key={g.id}
          className="flex items-center justify-between rounded-lg border border-border/40 bg-background/40 p-2.5 text-sm"
        >
          <div>
            <p className="font-medium">{formatBRL(g.valor)}</p>
            <p className="text-xs text-muted-foreground">
              {parseDateLocal(g.data)?.toLocaleDateString("pt-BR")}
            </p>
          </div>
          <a
            href={`/gastos?highlight=${g.id}`}
            className="text-xs text-brand hover:underline"
          >
            {t("history.view")}
          </a>
        </div>
      ))}
      {rec.proximaCobranca && rec.status === "ativa" && (
        <div className="flex items-center justify-between rounded-lg border border-dashed border-brand/40 bg-brand/5 p-2.5 text-sm">
          <div>
            <p className="font-medium text-brand">{formatBRL(rec.valor)}</p>
            <p className="text-xs text-muted-foreground">
              {t("history.forecast", { date: parseDateLocal(rec.proximaCobranca)?.toLocaleDateString("pt-BR") ?? "" })}
            </p>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {t("history.forecastBadge")}
          </Badge>
        </div>
      )}
    </div>
  );
}
