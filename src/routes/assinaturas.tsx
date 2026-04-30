import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
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
import { TransactionAvatar } from "@/components/TransactionAvatar";
import { toast } from "sonner";
import { formatBRL, parseBRLInput, parseDateLocal, toLocalISODate } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import {
  useStore,
  getCategorias,
  getCartoes,
  getCategoriaById,
  getCartaoById,
  getLimite,
  getGastos,
} from "@/lib/store";
import {
  hydrateRecorrencias,
  useRecorrencias,
  sincronizarDeteccoes,
  totaisRecorrencias,
  criarRecorrencia,
  atualizarRecorrencia,
  excluirRecorrencia,
  gerarGastoDoMes,
  historicoDaRecorrencia,
  type Recorrencia,
  type FrequenciaRecorrencia,
  type StatusRecorrencia,
} from "@/lib/recorrencias";
import { FORMAS_PAGAMENTO, type FormaPagamento } from "@/lib/types";

export const Route = createFileRoute("/assinaturas")({
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

const FREQ_LABEL: Record<FrequenciaRecorrencia, string> = {
  mensal: "Mensal",
  semanal: "Semanal",
  quinzenal: "Quinzenal",
  anual: "Anual",
  personalizada: "Personalizada",
};

const STATUS_BADGE: Record<StatusRecorrencia, string> = {
  ativa: "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
  pausada: "border-amber-500/40 text-amber-400 bg-amber-500/10",
  cancelada: "border-zinc-500/40 text-zinc-400 bg-zinc-500/10",
  suspeita: "border-sky-500/40 text-sky-400 bg-sky-500/10",
  aguardando: "border-violet-500/40 text-violet-400 bg-violet-500/10",
};

const STATUS_LABEL: Record<StatusRecorrencia, string> = {
  ativa: "Ativa",
  pausada: "Pausada",
  cancelada: "Cancelada",
  suspeita: "Suspeita",
  aguardando: "Aguardando confirmação",
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

function descrevePrazo(iso?: string | null): string {
  const d = diasAteHoje(iso);
  if (d == null) return "—";
  if (d < 0) return `há ${Math.abs(d)} ${Math.abs(d) === 1 ? "dia" : "dias"}`;
  if (d === 0) return "hoje";
  if (d === 1) return "amanhã";
  if (d < 30) return `em ${d} dias`;
  return parseDateLocal(iso!)!.toLocaleDateString("pt-BR");
}

function AssinaturasPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const recs = useRecorrencias();
  const gastos = useStore(getGastos);
  const categorias = useStore(getCategorias);
  const cartoes = useStore(getCartoes);

  const [syncing, setSyncing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Recorrencia | null>(null);
  const [historicoOpen, setHistoricoOpen] = useState<Recorrencia | null>(null);
  const [filtroStatus, setFiltroStatus] = useState<"todas" | StatusRecorrencia>(
    "todas",
  );

  // Hidrata + sincroniza detecções na entrada da página.
  useEffect(() => {
    if (!userId) return;
    let cancelado = false;
    (async () => {
      await hydrateRecorrencias(userId);
      if (cancelado) return;
      const r = await sincronizarDeteccoes(userId, getGastos());
      if (cancelado) return;
      if (r.criadas + r.suspeitas > 0) {
        toast.success(
          `${r.criadas} recorrências detectadas${
            r.suspeitas ? `, ${r.suspeitas} suspeitas` : ""
          }`,
        );
      }
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const totais = useMemo(() => totaisRecorrencias(recs), [recs]);

  const proxima = useMemo(() => {
    const ativas = recs.filter(
      (r) => r.status === "ativa" && r.proximaCobranca,
    );
    if (!ativas.length) return null;
    return ativas
      .slice()
      .sort((a, b) =>
        (a.proximaCobranca ?? "") < (b.proximaCobranca ?? "") ? -1 : 1,
      )[0];
  }, [recs]);

  const recsFiltradas = useMemo(() => {
    if (filtroStatus === "todas") return recs;
    return recs.filter((r) => r.status === filtroStatus);
  }, [recs, filtroStatus]);

  const suspeitas = recs.filter((r) => r.status === "suspeita");

  // Insights
  const insights = useMemo(() => {
    const out: string[] = [];
    const ativas = recs.filter((r) => r.status === "ativa");
    if (ativas.length === 0) return out;
    const maior = ativas.reduce((a, b) => (a.valor > b.valor ? a : b));
    out.push(
      `Você gasta ${formatBRL(totais.mensal)} por mês em recorrências, ${formatBRL(
        totais.anual,
      )} por ano.`,
    );
    out.push(`${maior.nome} é sua maior recorrência ativa.`);
    // Cartão dominante
    const porCartao = new Map<string, number>();
    for (const r of ativas) {
      if (!r.cartaoId) continue;
      porCartao.set(r.cartaoId, (porCartao.get(r.cartaoId) ?? 0) + 1);
    }
    if (porCartao.size > 0) {
      const [topCartao] = [...porCartao.entries()].sort((a, b) => b[1] - a[1]);
      const card = getCartaoById(topCartao[0]);
      if (card && topCartao[1] >= 2) {
        out.push(
          `Você tem ${topCartao[1]} recorrências cobradas no cartão ${card.nome}.`,
        );
      }
    }
    // Aumento de valor
    const aumentos = recs.filter(
      (r) => r.ultimoValor && Math.abs(r.valor - r.ultimoValor) > 0.5,
    );
    for (const r of aumentos.slice(0, 1)) {
      const diff = r.valor - (r.ultimoValor ?? 0);
      if (diff > 0) {
        out.push(
          `Detectamos aumento de ${formatBRL(diff)} na recorrência ${r.nome}.`,
        );
      }
    }
    return out;
  }, [recs, totais]);

  // Integração com orçamento por categoria (apenas leitura/análise)
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
      const r = await sincronizarDeteccoes(userId, gastos);
      toast.success(
        `Análise concluída: ${r.criadas} novas, ${r.suspeitas} suspeitas`,
      );
    } finally {
      setSyncing(false);
    }
  }

  async function handleConfirmarSuspeita(r: Recorrencia) {
    await atualizarRecorrencia(r.id, { status: "ativa" });
    toast.success(`${r.nome} confirmada como recorrência`);
  }

  async function handleIgnorar(r: Recorrencia) {
    await atualizarRecorrencia(r.id, { status: "cancelada" });
    toast(`${r.nome} ignorada`);
  }

  async function handleTogglePause(r: Recorrencia) {
    const novo: StatusRecorrencia = r.status === "pausada" ? "ativa" : "pausada";
    await atualizarRecorrencia(r.id, { status: novo });
    toast.success(`${r.nome} ${novo === "pausada" ? "pausada" : "reativada"}`);
  }

  async function handleCancelar(r: Recorrencia) {
    if (!confirm(`Cancelar a recorrência "${r.nome}"?`)) return;
    await atualizarRecorrencia(r.id, { status: "cancelada" });
    toast.success("Recorrência cancelada");
  }

  async function handleExcluir(r: Recorrencia) {
    if (!confirm(`Excluir a recorrência "${r.nome}"? Essa ação não pode ser desfeita.`))
      return;
    await excluirRecorrencia(r.id);
    toast.success("Recorrência excluída");
  }

  async function handleGerarGasto(r: Recorrencia) {
    const res = await gerarGastoDoMes(r);
    if (res.ok) {
      toast.success("Gasto criado a partir da recorrência");
    } else {
      toast.error("Não foi possível criar o gasto");
    }
  }

  return (
    <MobileShell wide>
      <header className="pt-6 pb-4 lg:pt-10">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
              Assinaturas e recorrências
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Veja quais gastos voltam todo mês e quanto eles pesam no seu orçamento.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={syncing}
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Reanalisar</span>
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Nova recorrência</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Cards do topo */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="Total mensal"
          value={formatBRL(totais.mensal)}
        />
        <SummaryCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Total anual estimado"
          value={formatBRL(totais.anual)}
        />
        <SummaryCard
          icon={<Sparkles className="h-4 w-4" />}
          label="Próxima cobrança"
          value={
            proxima
              ? `${proxima.nome.split(" ")[0]} • ${descrevePrazo(proxima.proximaCobranca)}`
              : "—"
          }
          small
        />
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />}
          label="Recorrências ativas"
          value={`${totais.ativas}`}
        />
      </section>

      {/* Suspeitas */}
      {suspeitas.length > 0 && (
        <section className="mt-5 rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4">
          <div className="flex items-center gap-2 text-sky-400">
            <Sparkles className="h-4 w-4" />
            <h2 className="text-sm font-semibold">
              Detectamos {suspeitas.length} possível(is) recorrência(s)
            </h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Confirme para começar a acompanhar.
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
                      {formatBRL(r.valor)} · {FREQ_LABEL[r.frequencia]}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleIgnorar(r)}
                  >
                    Ignorar
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleConfirmarSuspeita(r)}
                  >
                    <Check className="h-4 w-4" /> Confirmar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Insights */}
      {insights.length > 0 && (
        <section className="mt-5 rounded-2xl border border-border/60 bg-card/40 p-4">
          <h2 className="text-sm font-semibold">Insights</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            {insights.map((t, i) => (
              <li key={i} className="flex gap-2">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
          {orcamentoAssinaturas && (
            <div className="mt-3 rounded-xl border border-border/40 bg-background/40 p-3 text-xs">
              <p className="font-medium text-foreground">
                Orçamento de Assinaturas
              </p>
              <p className="text-muted-foreground">
                Limite: {formatBRL(orcamentoAssinaturas.limite)} · Recorrências
                previstas: {formatBRL(orcamentoAssinaturas.totalRec)}
              </p>
              {orcamentoAssinaturas.totalRec >
                orcamentoAssinaturas.limite * 0.8 && (
                <p className="mt-1 flex items-center gap-1 text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  Suas assinaturas consomem mais de 80% do orçamento.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* Filtro */}
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
              {s === "todas" ? "Todas" : STATUS_LABEL[s]}
            </button>
          ),
        )}
      </div>

      {/* Lista */}
      <section className="mt-2 space-y-3">
        {recsFiltradas.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 p-8 text-center">
            <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">
              Nenhuma recorrência {filtroStatus === "todas" ? "" : STATUS_LABEL[filtroStatus as StatusRecorrencia].toLowerCase()}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Continue registrando seus gastos. Quando algo se repetir, vamos sugerir aqui.
            </p>
          </div>
        ) : (
          recsFiltradas.map((r) => (
            <RecorrenciaCard
              key={r.id}
              rec={r}
              onEdit={() => {
                setEditing(r);
                setDialogOpen(true);
              }}
              onTogglePause={() => handleTogglePause(r)}
              onCancelar={() => handleCancelar(r)}
              onExcluir={() => handleExcluir(r)}
              onHistorico={() => setHistoricoOpen(r)}
              onGerarGasto={() => handleGerarGasto(r)}
            />
          ))
        )}
      </section>

      {/* Dialog Nova/Editar */}
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

      {/* Histórico */}
      <Dialog
        open={!!historicoOpen}
        onOpenChange={(o) => !o && setHistoricoOpen(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{historicoOpen?.nome}</DialogTitle>
            <DialogDescription>Histórico de cobranças</DialogDescription>
          </DialogHeader>
          {historicoOpen && (
            <HistoricoLista rec={historicoOpen} gastos={gastos} />
          )}
        </DialogContent>
      </Dialog>
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
  onEdit,
  onTogglePause,
  onCancelar,
  onExcluir,
  onHistorico,
  onGerarGasto,
}: {
  rec: Recorrencia;
  onEdit: () => void;
  onTogglePause: () => void;
  onCancelar: () => void;
  onExcluir: () => void;
  onHistorico: () => void;
  onGerarGasto: () => void;
}) {
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
              {STATUS_LABEL[rec.status]}
            </Badge>
          </div>
          <p className="mt-0.5 text-base font-bold tracking-tight">
            {formatBRL(rec.valor)}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              /{rec.frequencia === "mensal" ? "mês" : FREQ_LABEL[rec.frequencia].toLowerCase()}
            </span>
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {cat?.nome ?? "Sem categoria"}
            {formaLabel && ` · ${formaLabel}`}
            {cartao && ` · ${cartao.nome}`}
            {rec.proximaCobranca && ` · próxima ${descrevePrazo(rec.proximaCobranca)}`}
          </p>
          {aumentou && (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              Aumento de {formatBRL(rec.valor - (rec.ultimoValor ?? 0))} desde a última cobrança
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/40 pt-3">
        <Button size="sm" variant="ghost" onClick={onHistorico}>
          <History className="h-3.5 w-3.5" /> Histórico
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" /> Editar
        </Button>
        {rec.status !== "cancelada" && (
          <>
            <Button size="sm" variant="ghost" onClick={onTogglePause}>
              {rec.status === "pausada" ? (
                <>
                  <Play className="h-3.5 w-3.5" /> Reativar
                </>
              ) : (
                <>
                  <Pause className="h-3.5 w-3.5" /> Pausar
                </>
              )}
            </Button>
            <Button size="sm" variant="ghost" onClick={onGerarGasto}>
              <CreditCard className="h-3.5 w-3.5" /> Gerar gasto
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancelar}>
              <X className="h-3.5 w-3.5" /> Cancelar
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
  const historico = useMemo(
    () => historicoDaRecorrencia(rec, gastos),
    [rec, gastos],
  );
  return (
    <div className="space-y-2">
      {historico.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhum gasto vinculado encontrado ainda.
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
            Ver
          </a>
        </div>
      ))}
      {rec.proximaCobranca && rec.status === "ativa" && (
        <div className="flex items-center justify-between rounded-lg border border-dashed border-brand/40 bg-brand/5 p-2.5 text-sm">
          <div>
            <p className="font-medium text-brand">{formatBRL(rec.valor)}</p>
            <p className="text-xs text-muted-foreground">
              Previsto · {parseDateLocal(rec.proximaCobranca)?.toLocaleDateString("pt-BR")}
            </p>
          </div>
          <Badge variant="outline" className="text-[10px]">
            previsão
          </Badge>
        </div>
      )}
    </div>
  );
}

function RecorrenciaDialog({
  open,
  onOpenChange,
  editing,
  userId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Recorrencia | null;
  userId: string | null;
  onSaved: () => void;
}) {
  const categorias = useStore(getCategorias);
  const cartoes = useStore(getCartoes);
  const [nome, setNome] = useState("");
  const [valor, setValor] = useState("");
  const [categoriaId, setCategoriaId] = useState<string>("");
  const [frequencia, setFrequencia] = useState<FrequenciaRecorrencia>("mensal");
  const [proximaCobranca, setProximaCobranca] = useState<string>("");
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento | "">("");
  const [cartaoId, setCartaoId] = useState<string>("");
  const [observacao, setObservacao] = useState("");
  const [status, setStatus] = useState<StatusRecorrencia>("ativa");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setNome(editing.nome);
      setValor(editing.valor.toFixed(2).replace(".", ","));
      setCategoriaId(editing.categoriaId ?? "");
      setFrequencia(editing.frequencia);
      setProximaCobranca(editing.proximaCobranca ?? "");
      setFormaPagamento((editing.formaPagamento ?? "") as FormaPagamento | "");
      setCartaoId(editing.cartaoId ?? "");
      setObservacao(editing.observacao ?? "");
      setStatus(editing.status);
    } else {
      setNome("");
      setValor("");
      setCategoriaId("");
      setFrequencia("mensal");
      setProximaCobranca(toLocalISODate(new Date()));
      setFormaPagamento("");
      setCartaoId("");
      setObservacao("");
      setStatus("ativa");
    }
  }, [editing, open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    const valorNum = parseBRLInput(valor);
    if (!nome.trim() || valorNum <= 0) {
      toast.error("Informe nome e valor válidos");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await atualizarRecorrencia(editing.id, {
          nome: nome.trim(),
          valor: valorNum,
          categoriaId: categoriaId || null,
          frequencia,
          proximaCobranca: proximaCobranca || null,
          formaPagamento: (formaPagamento || null) as FormaPagamento | null,
          cartaoId: cartaoId || null,
          observacao: observacao || null,
          status,
        });
        toast.success("Recorrência atualizada");
      } else {
        await criarRecorrencia(userId, {
          nome: nome.trim(),
          valor: valorNum,
          categoriaId: categoriaId || null,
          frequencia,
          proximaCobranca: proximaCobranca || null,
          formaPagamento: (formaPagamento || null) as FormaPagamento | null,
          cartaoId: cartaoId || null,
          observacao: observacao || null,
          status,
          origem: "manual",
        });
        toast.success("Recorrência criada");
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Editar recorrência" : "Nova recorrência"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Ajuste os dados da assinatura ou recorrência."
              : "Cadastre uma nova assinatura ou despesa que se repete."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium">Nome</label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Spotify, Aluguel"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium">Valor</label>
              <Input
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Frequência</label>
              <Select
                value={frequencia}
                onValueChange={(v) => setFrequencia(v as FrequenciaRecorrencia)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(FREQ_LABEL) as FrequenciaRecorrencia[]
                  ).map((f) => (
                    <SelectItem key={f} value={f}>
                      {FREQ_LABEL[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium">Próxima cobrança</label>
            <Input
              type="date"
              value={proximaCobranca}
              onChange={(e) => setProximaCobranca(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-medium">Categoria</label>
            <Select
              value={categoriaId || "__none__"}
              onValueChange={(v) => setCategoriaId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecionar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sem categoria</SelectItem>
                {categorias.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium">Forma de pagamento</label>
              <Select
                value={formaPagamento || "__none__"}
                onValueChange={(v) =>
                  setFormaPagamento((v === "__none__" ? "" : v) as FormaPagamento | "")
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Não definida</SelectItem>
                  {FORMAS_PAGAMENTO.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium">Cartão</label>
              <Select
                value={cartaoId || "__none__"}
                onValueChange={(v) => setCartaoId(v === "__none__" ? "" : v)}
                disabled={formaPagamento !== "credito"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {cartoes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium">Status</label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as StatusRecorrencia)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["ativa", "pausada", "cancelada"] as const).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium">Observação</label>
            <Textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : editing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
