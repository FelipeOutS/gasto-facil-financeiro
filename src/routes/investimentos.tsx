import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
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
import { formatBRL, parseBRLInput, todayISO } from "@/lib/format";
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
} from "@/lib/investimentos";

export const Route = createFileRoute("/investimentos")({
  component: InvestimentosPage,
});

const RENT_TIPOS = [
  { id: "cdi", label: "% do CDI" },
  { id: "ipca", label: "IPCA +" },
  { id: "prefixado", label: "Prefixado" },
  { id: "selic", label: "Selic" },
  { id: "outro", label: "Outro" },
];

function InvestimentosPage() {
  const { user } = useAuth();
  const userId = user?.id;
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
      toast.error("Não foi possível carregar os investimentos.");
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
    if (fixaPct >= 70) out.push("Sua carteira está concentrada em renda fixa.");
    if (totais.rendimentosAno > 0)
      out.push(`Você recebeu ${formatBRL(totais.rendimentosAno)} em rendimentos este ano.`);
    if (distribuicao[0] && distribuicao[0].pct >= 40)
      out.push(`Seu maior tipo de ativo (${distribuicao[0].label}) representa ${distribuicao[0].pct.toFixed(0)}% da carteira.`);
    if (totais.rendimentosMes === 0) out.push("Você ainda não cadastrou rendimentos este mês.");
    if (movs.length < 3) out.push("Adicione mais movimentações para calcular a rentabilidade com mais precisão.");
    return out;
  }, [ativos, distribuicao, totais, movs]);

  return (
    <MobileShell wide>
      <header className="pt-4 pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Investimentos</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              Acompanhe sua carteira, evolução patrimonial e rendimentos em um só lugar.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setOpenHistorico(true)}>
              <History className="h-4 w-4 mr-1.5" /> Importações
              {importacoes.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">
                  {importacoes.length}
                </Badge>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpenAtualizarLote(true)}
              disabled={ativos.length === 0}
            >
              <RefreshCw className="h-4 w-4 mr-1.5" /> Atualizar valores
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMovDialog({ open: true, mov: null })}
              disabled={ativos.length === 0}
            >
              <ArrowRightLeft className="h-4 w-4 mr-1.5" /> Movimentação
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRendDialog({ open: true, rend: null })}
              disabled={ativos.length === 0}
            >
              <HandCoins className="h-4 w-4 mr-1.5" /> Rendimento
            </Button>
            <Button variant="outline" size="sm" onClick={() => setOpenImport(true)}>
              <Upload className="h-4 w-4 mr-1.5" /> Importar
            </Button>
            <Button size="sm" onClick={() => { setEditing(null); setOpenAdd(true); }}>
              <Plus className="h-4 w-4 mr-1.5" /> Adicionar investimento
            </Button>
          </div>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-border/40 bg-muted/20 p-2.5 text-[11px] text-muted-foreground max-w-3xl">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Os valores são calculados com base nas informações cadastradas ou importadas. Para acompanhar a carteira
            com mais precisão, atualize o valor atual dos investimentos periodicamente.
          </span>
        </div>
      </header>

      {/* Cards de topo */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-2">
        <KpiCard icon={<Wallet className="h-4 w-4" />} label="Patrimônio total" value={formatBRL(totais.patrimonio)} />
        <KpiCard icon={<PiggyBank className="h-4 w-4" />} label="Valor aplicado" value={formatBRL(totais.aplicado)} />
        <KpiCard
          icon={totais.lucro >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          label="Lucro / Prejuízo"
          value={`${totais.lucro >= 0 ? "+" : ""}${formatBRL(totais.lucro)}`}
          tone={totais.lucro >= 0 ? "pos" : "neg"}
        />
        <KpiCard
          icon={<BarChart3 className="h-4 w-4" />}
          label="Rentabilidade"
          value={`${totais.rentabilidade >= 0 ? "+" : ""}${totais.rentabilidade.toFixed(2)}%`}
          tone={totais.rentabilidade >= 0 ? "pos" : "neg"}
        />
        <KpiCard
          icon={<Coins className="h-4 w-4" />}
          label="Rendimentos no ano"
          value={formatBRL(totais.rendimentosAno)}
        />
      </section>

      {/* Conteúdo principal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
        {/* Carteira */}
        <section className="lg:col-span-2 rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Minha carteira</h2>
            <span className="text-xs text-muted-foreground">{ativos.length} ativo(s)</span>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Carregando…</p>
          ) : ativos.length === 0 ? (
            <EmptyState
              title="Nenhum investimento cadastrado"
              description="Comece cadastrando seu primeiro ativo manualmente ou importe um extrato."
              cta={
                <Button size="sm" onClick={() => setOpenAdd(true)}>
                  <Plus className="h-4 w-4 mr-1.5" /> Adicionar investimento
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
                        <Badge variant="secondary" className="text-[10px]">{tipoLabel(a.tipo)}</Badge>
                        {a.instituicao && (
                          <span className="text-[11px] text-muted-foreground">{a.instituicao}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {a.quantidade ? `${a.quantidade} · ` : ""}
                        Aplicado {formatBRL(Number(a.valor_aplicado || 0))} · Atual {formatBRL(Number(a.valor_atual || 0))}
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
                            Valor pode estar desatualizado
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
                    <div className="flex gap-1 ml-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-brand"
                        title="Atualizar valor"
                        onClick={() => setAtualizandoAtivo(a)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditing(a); setOpenAdd(true); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-rose-500 hover:text-rose-500"
                        onClick={async () => {
                          if (!confirm(`Excluir ${a.nome}?`)) return;
                          await excluirAtivo(a.id);
                          toast.success("Investimento excluído.");
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
            <h2 className="font-semibold mb-3">Distribuição da carteira</h2>
            {distribuicao.length === 0 ? (
              <p className="text-xs text-muted-foreground">Cadastre ativos para ver a distribuição.</p>
            ) : (
              <ul className="space-y-2.5">
                {distribuicao.map((d) => (
                  <li key={d.tipo}>
                    <div className="flex justify-between text-xs mb-1">
                      <span>{d.label}</span>
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
                <h2 className="font-semibold">Insights da carteira</h2>
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
        <h2 className="font-semibold mb-3">Evolução patrimonial</h2>
        {ativos.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Adicione investimentos ou importe um extrato para acompanhar sua evolução.
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <MiniStat label="Patrimônio" value={formatBRL(totais.patrimonio)} />
            <MiniStat label="Aportado" value={formatBRL(totais.aplicado)} />
            <MiniStat label="Variação" value={`${totais.lucro >= 0 ? "+" : ""}${formatBRL(totais.lucro)}`} />
            <MiniStat label="Rendimentos no mês" value={formatBRL(totais.rendimentosMes)} />
          </div>
        )}
      </section>

      {/* Movimentações + Rendimentos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <section className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4">
          <h2 className="font-semibold mb-3">Movimentações</h2>
          {movs.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sem movimentações ainda.</p>
          ) : (
            <ul className="divide-y divide-border/40 text-sm">
              {movs.slice(0, 8).map((m) => {
                const ativo = ativos.find((a) => a.id === m.ativo_id);
                return (
                  <li key={m.id} className="py-2 flex justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium capitalize">{m.tipo}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {ativo?.nome ?? "—"} · {m.data}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{formatBRL(Number(m.valor_total || 0))}</div>
                      {m.quantidade ? <div className="text-xs text-muted-foreground">{m.quantidade}</div> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4">
          <h2 className="font-semibold mb-3">Rendimentos</h2>
          {rends.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sem rendimentos cadastrados.</p>
          ) : (
            <ul className="divide-y divide-border/40 text-sm">
              {rends.slice(0, 8).map((r) => {
                const ativo = ativos.find((a) => a.id === r.ativo_id);
                return (
                  <li key={r.id} className="py-2 flex justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium capitalize">{r.tipo.replace("_", " ")}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {ativo?.nome ?? "—"} · {r.data_pagamento}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-emerald-500">+{formatBRL(Number(r.valor || 0))}</div>
                      <Badge variant="secondary" className="text-[10px]">{r.status}</Badge>
                    </div>
                  </li>
                );
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
              <h2 className="font-semibold">Integração B3</h2>
              <Badge variant="outline" className="text-[10px]">Não conectado</Badge>
              <Badge variant="secondary" className="text-[10px]">Importação manual disponível</Badge>
              <Badge variant="outline" className="text-[10px]">API B3 — em breve</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-2 max-w-2xl">
              A conexão automática com a B3 depende de acesso oficial/autorizado. Por enquanto, você pode importar
              extratos da Área do Investidor ou cadastrar seus investimentos manualmente.
            </p>
            <div className="flex items-start gap-2 mt-3 rounded-lg bg-muted/40 p-2.5 text-[11px] text-muted-foreground">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Não pedimos senha da B3, senha da corretora, CPF ou token bancário. Use apenas arquivos exportados
                oficialmente ou cadastre os dados manualmente.
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

      <ImportDialog open={openImport} onOpenChange={setOpenImport} />

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
    </MobileShell>
  );
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
      toast.error("Não foi possível salvar.");
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
                  {TIPOS_INVESTIMENTO.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
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
              <div className="grid grid-cols-3 gap-3">
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
                  <div className="grid grid-cols-3 gap-3">
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

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar investimentos</DialogTitle>
          <DialogDescription>Escolha de onde quer trazer seus dados.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {[
            { label: "Importar extrato da B3", desc: "Arquivo exportado da Área do Investidor (CSV/PDF)." },
            { label: "Importar extrato da corretora", desc: "Relatório oficial da sua corretora." },
            { label: "Importar CSV / planilha", desc: "Modelo livre com seus ativos." },
            { label: "Importar PDF", desc: "Extrato em PDF com prévia antes de salvar." },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              className="w-full text-left rounded-xl border border-border/60 bg-card/40 hover:bg-accent/40 p-3 transition-colors"
              onClick={() => toast.info("Importação será habilitada em breve. Por enquanto, cadastre manualmente.")}
            >
              <div className="font-medium text-sm">{opt.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{opt.desc}</div>
            </button>
          ))}
        </div>
        <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-2.5 text-[11px] text-muted-foreground mt-1">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Não pedimos senha da B3, senha da corretora, CPF ou token bancário. Use apenas arquivos exportados
            oficialmente ou cadastre os dados manualmente.
          </span>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      toast.error("Não foi possível carregar os detalhes.");
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
      toast.error("Não foi possível excluir.");
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
            <p className="text-sm text-muted-foreground py-6 text-center">Carregando…</p>
          ) : itensDetalhe ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-3 gap-2">
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
                        <span className="text-xs text-muted-foreground">{tipoLabel(a.tipo)}</span>
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

      {/* Confirmar exclusão */}
      <Dialog open={!!confirmar} onOpenChange={(v) => !v && !excluindo && setConfirmar(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Deseja excluir esta importação?</DialogTitle>
            <DialogDescription>
              Você pode excluir apenas o histórico da importação ou excluir também os investimentos,
              movimentações e rendimentos criados por ela.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 text-amber-500 p-2.5 text-xs">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Apenas ativos, movimentações e rendimentos vinculados a esta importação serão removidos.
              Investimentos cadastrados manualmente não são afetados.
            </span>
          </div>

          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <Button variant="outline" onClick={() => setConfirmar(null)} disabled={excluindo}>
              Cancelar
            </Button>
            <Button
              variant="outline"
              onClick={() => handleExcluir("historico")}
              disabled={excluindo}
            >
              Excluir apenas histórico
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleExcluir("tudo")}
              disabled={excluindo}
            >
              {excluindo ? "Excluindo…" : "Excluir tudo relacionado"}
            </Button>
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
      toast.error("Não foi possível atualizar o valor.");
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
              {tipoLabel(ativo.tipo)}
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
                        {tipoLabel(a.tipo)} · Aplicado {formatBRL(Number(a.valor_aplicado || 0))}
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
