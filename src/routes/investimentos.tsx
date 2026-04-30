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
  type Ativo,
  type Movimentacao,
  type Rendimento,
  type TipoInvestimento,
  listarAtivos,
  listarMovimentacoes,
  listarRendimentos,
  criarAtivo,
  atualizarAtivo,
  excluirAtivo,
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
  const [loading, setLoading] = useState(true);
  const [openAdd, setOpenAdd] = useState(false);
  const [openImport, setOpenImport] = useState(false);
  const [editing, setEditing] = useState<Ativo | null>(null);

  async function reload() {
    if (!userId) return;
    setLoading(true);
    try {
      const [a, m, r] = await Promise.all([
        listarAtivos(userId),
        listarMovimentacoes(userId),
        listarRendimentos(userId),
      ]);
      setAtivos(a);
      setMovs(m);
      setRends(r);
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
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpenImport(true)}>
              <Upload className="h-4 w-4 mr-1.5" /> Importar
            </Button>
            <Button size="sm" onClick={() => { setEditing(null); setOpenAdd(true); }}>
              <Plus className="h-4 w-4 mr-1.5" /> Adicionar investimento
            </Button>
          </div>
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
          <Field label="Nome do investimento *">
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Tesouro Selic 2029" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ticker / código">
              <Input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="MXRF11" />
            </Field>
            <Field label="Tipo">
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoInvestimento)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS_INVESTIMENTO.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Instituição / corretora">
            <Input value={instituicao} onChange={(e) => setInstituicao(e.target.value)} placeholder="XP, Nubank, Rico…" />
          </Field>
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
            <Field label="Valor aplicado">
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
