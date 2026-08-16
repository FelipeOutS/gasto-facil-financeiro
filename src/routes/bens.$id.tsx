import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Archive,
  Landmark,
  Plus,
  Trash2,
  Info,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastFromError } from "@/lib/premium-error";
import { formatBRL, parseBRLInput, todayISO } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import {
  STATUS_FINANCIAMENTO,
  TIPOS_CUSTO_AQUISICAO,
  arquivarBem,
  atualizarFinanciamento,
  calcularResumoBem,
  criarAmortizacao,
  criarCustoAquisicao,
  criarFinanciamento,
  criarPagamento,
  excluirAmortizacao,
  excluirCustoAquisicao,
  excluirPagamento,
  financiamentoAtivo,
  listarAmortizacoes,
  listarCustosAquisicao,
  listarFinanciamentos,
  listarGastosDoBem,
  listarGastosSemBem,
  listarPagamentos,
  obterBem,
  snapshotDivergente,
  vincularGastoAoBem,
  type AmortizacaoBem,
  type Bem,
  type CustoAquisicaoBem,
  type Financiamento,
  type GastoDoBem,
  type PagamentoBem,
  type StatusFinanciamento,
  type TipoCustoAquisicao,
} from "@/lib/bens";

export const Route = createFileRoute("/bens/$id")({
  head: () => ({
    meta: [
      { title: "Detalhes do bem — Gasto Inteligente" },
      {
        name: "description",
        content:
          "Financiamento, parcelas pagas, amortizações e custos adicionais do seu imóvel ou veículo.",
      },
      { property: "og:title", content: "Detalhes do bem" },
      {
        property: "og:description",
        content: "Financiamento, parcelas, amortizações e custos adicionais do bem.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BemDetalhePage,
});

function BemDetalhePage() {
  const { id } = useParams({ from: "/bens/$id" });
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [bem, setBem] = useState<Bem | null>(null);
  const [financiamentos, setFinanciamentos] = useState<Financiamento[]>([]);
  const [pagamentos, setPagamentos] = useState<PagamentoBem[]>([]);
  const [amortizacoes, setAmortizacoes] = useState<AmortizacaoBem[]>([]);
  const [custos, setCustos] = useState<CustoAquisicaoBem[]>([]);
  const [gastos, setGastos] = useState<GastoDoBem[]>([]);
  const [gastosDisponiveis, setGastosDisponiveis] = useState<GastoDoBem[]>([]);
  const [gastoParaVincular, setGastoParaVincular] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [b, f, p, a, c, g] = await Promise.all([
        obterBem(id),
        listarFinanciamentos(id),
        listarPagamentos(id),
        listarAmortizacoes(id),
        listarCustosAquisicao(id),
        listarGastosDoBem(id),
      ]);
      setBem(b);
      setFinanciamentos(f);
      setPagamentos(p);
      setAmortizacoes(a);
      setCustos(c);
      setGastos(g);
    } catch (e) {
      toastFromError(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const valoresGastos = useMemo(
    () => Object.fromEntries(gastos.map((g) => [g.id, Number(g.valor)])),
    [gastos],
  );

  const ativo = financiamentoAtivo(financiamentos);

  const resumo = useMemo(
    () =>
      bem
        ? calcularResumoBem({
            bem,
            financiamento: ativo,
            pagamentos,
            amortizacoes,
            custos,
            valoresGastos,
            gastos,
            mesReferencia: todayISO().slice(0, 7),
          })
        : null,
    [bem, ativo, pagamentos, amortizacoes, custos, valoresGastos],
  );

  // ---- formulários simples -------------------------------------------------
  const [fin, setFin] = useState({
    instituicao: "",
    valor_financiado: "",
    prazo_meses: "",
    taxa_juros_anual: "",
    sistema_amortizacao: "sac",
    primeiro_vencimento: "",
    dia_vencimento: "",
    saldo_devedor_informado: "",
    saldo_devedor_data: "",
  });
  const [pag, setPag] = useState({
    data_pagamento: todayISO(),
    valor_pago: "",
    valor_juros: "",
    valor_amortizacao: "",
    numero_parcela: "",
  });
  const [amo, setAmo] = useState({
    data: todayISO(),
    valor: "",
    efeito: "reduz_prazo",
    origem_recurso: "proprio",
  });
  const [cus, setCus] = useState({ tipo: "itbi" as TipoCustoAquisicao, valor: "", data: "" });

  async function novoFinanciamento() {
    if (!user?.id) return;
    setBusy(true);
    try {
      const criado = await criarFinanciamento(user.id, id, {
        instituicao: fin.instituicao || null,
        valor_financiado: parseBRLInput(fin.valor_financiado || "0"),
        prazo_meses: fin.prazo_meses ? Number(fin.prazo_meses) : null,
        taxa_juros_anual: fin.taxa_juros_anual ? Number(fin.taxa_juros_anual) : null,
        sistema_amortizacao: fin.sistema_amortizacao as "sac" | "price" | "outro",
        primeiro_vencimento: fin.primeiro_vencimento || null,
        dia_vencimento: fin.dia_vencimento ? Number(fin.dia_vencimento) : null,
        saldo_devedor_informado: fin.saldo_devedor_informado
          ? parseBRLInput(fin.saldo_devedor_informado)
          : null,
        saldo_devedor_data: fin.saldo_devedor_data || null,
        status: "ativo",
      });
      setFinanciamentos((prev) => [criado, ...prev]);
      setFin({ ...fin, instituicao: "", valor_financiado: "" });
      toast.success("Financiamento cadastrado.");
    } catch (e) {
      toastFromError(e);
    } finally {
      setBusy(false);
    }
  }

  async function encerrar(f: Financiamento, status: StatusFinanciamento) {
    try {
      await atualizarFinanciamento(f.id, { status, encerrado_em: todayISO() });
      setFinanciamentos((prev) =>
        prev.map((x) => (x.id === f.id ? { ...x, status, encerrado_em: todayISO() } : x)),
      );
      toast.success("Financiamento atualizado. O histórico permanece no bem.");
    } catch (e) {
      toastFromError(e);
    }
  }

  async function novoPagamento() {
    if (!user?.id) return;
    setBusy(true);
    try {
      const criado = await criarPagamento(user.id, id, {
        financiamento_id: ativo?.id ?? null,
        data_pagamento: pag.data_pagamento,
        valor_pago: parseBRLInput(pag.valor_pago || "0"),
        valor_juros: pag.valor_juros ? parseBRLInput(pag.valor_juros) : null,
        valor_amortizacao: pag.valor_amortizacao ? parseBRLInput(pag.valor_amortizacao) : null,
        numero_parcela: pag.numero_parcela ? Number(pag.numero_parcela) : null,
      });
      setPagamentos((prev) => [criado, ...prev]);
      setPag({ ...pag, valor_pago: "", valor_juros: "", valor_amortizacao: "" });
    } catch (e) {
      toastFromError(e);
    } finally {
      setBusy(false);
    }
  }

  async function novaAmortizacao() {
    if (!user?.id) return;
    setBusy(true);
    try {
      const criado = await criarAmortizacao(user.id, id, {
        financiamento_id: ativo?.id ?? null,
        data: amo.data,
        valor: parseBRLInput(amo.valor || "0"),
        efeito: amo.efeito as "reduz_prazo" | "reduz_parcela",
        origem_recurso: amo.origem_recurso as "proprio" | "fgts" | "terceiros" | "outros",
      });
      setAmortizacoes((prev) => [criado, ...prev]);
      setAmo({ ...amo, valor: "" });
    } catch (e) {
      toastFromError(e);
    } finally {
      setBusy(false);
    }
  }

  async function novoCusto() {
    if (!user?.id) return;
    setBusy(true);
    try {
      const criado = await criarCustoAquisicao(user.id, id, {
        tipo: cus.tipo,
        valor: parseBRLInput(cus.valor || "0"),
        data: cus.data || null,
      });
      setCustos((prev) => [criado, ...prev]);
      setCus({ ...cus, valor: "" });
    } catch (e) {
      toastFromError(e);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <MobileShell>
        <div className="space-y-3 pt-6">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </MobileShell>
    );
  }

  if (!bem) {
    return (
      <MobileShell>
        <div className="pt-8 text-center text-sm text-muted-foreground">Bem não encontrado.</div>
      </MobileShell>
    );
  }

  return (
    <MobileShell>
      <header className="pt-4">
        <Link
          to="/bens"
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Meus Bens
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <Landmark className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-semibold">{bem.nome}</h1>
              <p className="mt-1 text-sm text-muted-foreground capitalize">
                {bem.tipo === "imovel" ? "Imóvel" : "Veículo"}
                {bem.status !== "ativo" ? ` · ${bem.status}` : ""}
              </p>
            </div>
          </div>
          {bem.status === "ativo" && (
            <Button
              variant="outline"
              className="shrink-0 gap-2"
              onClick={async () => {
                await arquivarBem(bem.id);
                setBem({ ...bem, status: "arquivado" });
                toast.success("Bem arquivado. Pagamentos, custos e gastos foram preservados.");
              }}
            >
              <Archive className="h-4 w-4" />
              <span className="hidden sm:inline">Arquivar</span>
            </Button>
          )}
        </div>
      </header>

      {resumo && (
        <section className="mt-4 grid grid-cols-2 gap-3">
          <Card titulo="Entrada" valor={formatBRL(resumo.entradaTotal)} />
          <Card titulo="Custos adicionais" valor={formatBRL(resumo.totalCustosAquisicao)} />
          <Card
            titulo={`Parcelas pagas (${resumo.qtdParcelasPagas})`}
            valor={formatBRL(resumo.totalParcelasPagas)}
          />
          <Card titulo="Amortizações" valor={formatBRL(resumo.totalAmortizacoes)} />
          <Card titulo="Total desembolsado" valor={formatBRL(resumo.totalDesembolsado)} destaque />
          <Card
            titulo="Saldo devedor"
            valor={
              resumo.saldoDevedorEstimado == null
                ? "Não informado"
                : formatBRL(resumo.saldoDevedorEstimado)
            }
          />
        </section>
      )}

      <p className="mt-3 flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Quando um pagamento, amortização ou custo está ligado a um gasto, o desembolso é contado uma
        única vez — usamos o valor do gasto e mantemos o valor original do lançamento como
        histórico.
      </p>

      <Tabs defaultValue="financiamento" className="mt-4 pb-12">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="financiamento">Financiamento</TabsTrigger>
          <TabsTrigger value="parcelas">Parcelas</TabsTrigger>
          <TabsTrigger value="amortizacoes">Amortizações</TabsTrigger>
          <TabsTrigger value="custos">Custos</TabsTrigger>
        </TabsList>

        <TabsContent value="financiamento" className="space-y-3">
          {financiamentos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum financiamento cadastrado.</p>
          ) : (
            financiamentos.map((f) => (
              <div key={f.id} className="rounded-xl border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{f.instituicao || "Financiamento"}</span>
                  <Badge variant={f.status === "ativo" ? "default" : "secondary"}>
                    {STATUS_FINANCIAMENTO.find((s) => s.id === f.status)?.label ?? f.status}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Financiado: {formatBRL(Number(f.valor_financiado))} ·{" "}
                  {f.prazo_meses ? `${f.prazo_meses} meses` : "Prazo não informado"} ·{" "}
                  {f.taxa_juros_anual ? `${f.taxa_juros_anual}% a.a.` : "Taxa não informada"}
                </p>
                {f.status === "ativo" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void encerrar(f, "liquidado")}>
                      Liquidar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void encerrar(f, "portado")}>
                      Portabilidade
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void encerrar(f, "refinanciado")}
                    >
                      Refinanciado
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}

          {!ativo && (
            <div className="rounded-xl border p-4">
              <p className="mb-3 text-sm font-medium">Novo financiamento</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Instituição</Label>
                  <Input
                    value={fin.instituicao}
                    onChange={(e) => setFin({ ...fin, instituicao: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Valor financiado</Label>
                  <Input
                    inputMode="decimal"
                    value={fin.valor_financiado}
                    onChange={(e) => setFin({ ...fin, valor_financiado: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Prazo (meses)</Label>
                  <Input
                    inputMode="numeric"
                    value={fin.prazo_meses}
                    onChange={(e) => setFin({ ...fin, prazo_meses: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Taxa anual (%)</Label>
                  <Input
                    inputMode="decimal"
                    value={fin.taxa_juros_anual}
                    onChange={(e) => setFin({ ...fin, taxa_juros_anual: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Sistema</Label>
                  <Select
                    value={fin.sistema_amortizacao}
                    onValueChange={(v) => setFin({ ...fin, sistema_amortizacao: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sac">SAC</SelectItem>
                      <SelectItem value="price">Price</SelectItem>
                      <SelectItem value="outro">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>1º vencimento</Label>
                  <Input
                    type="date"
                    value={fin.primeiro_vencimento}
                    onChange={(e) => setFin({ ...fin, primeiro_vencimento: e.target.value })}
                  />
                </div>
              </div>
              <Button className="mt-3 gap-2" disabled={busy} onClick={() => void novoFinanciamento()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Cadastrar
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="parcelas" className="space-y-3">
          <div className="rounded-xl border p-4">
            <p className="mb-3 text-sm font-medium">Registrar parcela paga</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Data</Label>
                <Input
                  type="date"
                  value={pag.data_pagamento}
                  onChange={(e) => setPag({ ...pag, data_pagamento: e.target.value })}
                />
              </div>
              <div>
                <Label>Valor pago</Label>
                <Input
                  inputMode="decimal"
                  value={pag.valor_pago}
                  onChange={(e) => setPag({ ...pag, valor_pago: e.target.value })}
                />
              </div>
              <div>
                <Label>Juros</Label>
                <Input
                  inputMode="decimal"
                  value={pag.valor_juros}
                  onChange={(e) => setPag({ ...pag, valor_juros: e.target.value })}
                />
              </div>
              <div>
                <Label>Amortização (principal)</Label>
                <Input
                  inputMode="decimal"
                  value={pag.valor_amortizacao}
                  onChange={(e) => setPag({ ...pag, valor_amortizacao: e.target.value })}
                />
              </div>
            </div>
            <Button className="mt-3 gap-2" disabled={busy} onClick={() => void novoPagamento()}>
              <Plus className="h-4 w-4" />
              Adicionar
            </Button>
          </div>

          {pagamentos.map((p) => {
            const divergente = snapshotDivergente(
              { valor: Number(p.valor_pago), gastoId: p.gasto_id },
              valoresGastos,
            );
            return (
              <Linha
                key={p.id}
                titulo={`${p.data_pagamento}${p.numero_parcela ? ` · parcela ${p.numero_parcela}` : ""}`}
                valor={formatBRL(Number(p.valor_pago))}
                aviso={divergente ? "Gasto vinculado foi editado — o caixa segue o gasto." : null}
                onRemover={async () => {
                  await excluirPagamento(p.id);
                  setPagamentos((prev) => prev.filter((x) => x.id !== p.id));
                }}
              />
            );
          })}
        </TabsContent>

        <TabsContent value="amortizacoes" className="space-y-3">
          <div className="rounded-xl border p-4">
            <p className="mb-3 text-sm font-medium">Amortização extraordinária</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Data</Label>
                <Input
                  type="date"
                  value={amo.data}
                  onChange={(e) => setAmo({ ...amo, data: e.target.value })}
                />
              </div>
              <div>
                <Label>Valor</Label>
                <Input
                  inputMode="decimal"
                  value={amo.valor}
                  onChange={(e) => setAmo({ ...amo, valor: e.target.value })}
                />
              </div>
              <div>
                <Label>Efeito</Label>
                <Select value={amo.efeito} onValueChange={(v) => setAmo({ ...amo, efeito: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="reduz_prazo">Reduz prazo</SelectItem>
                    <SelectItem value="reduz_parcela">Reduz parcela</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button className="mt-3 gap-2" disabled={busy} onClick={() => void novaAmortizacao()}>
              <Plus className="h-4 w-4" />
              Adicionar
            </Button>
          </div>

          {amortizacoes.map((a) => (
            <Linha
              key={a.id}
              titulo={a.data}
              valor={formatBRL(Number(a.valor))}
              aviso={
                snapshotDivergente({ valor: Number(a.valor), gastoId: a.gasto_id }, valoresGastos)
                  ? "Gasto vinculado foi editado — o caixa segue o gasto."
                  : null
              }
              onRemover={async () => {
                await excluirAmortizacao(a.id);
                setAmortizacoes((prev) => prev.filter((x) => x.id !== a.id));
              }}
            />
          ))}
        </TabsContent>

        <TabsContent value="custos" className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Somente custos adicionais (ITBI, registro, escritura, avaliação, corretagem…). A entrada
            fica no cadastro do bem e não deve ser repetida aqui.
          </p>
          <div className="rounded-xl border p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Tipo</Label>
                <Select
                  value={cus.tipo}
                  onValueChange={(v) => setCus({ ...cus, tipo: v as TipoCustoAquisicao })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_CUSTO_AQUISICAO.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Valor</Label>
                <Input
                  inputMode="decimal"
                  value={cus.valor}
                  onChange={(e) => setCus({ ...cus, valor: e.target.value })}
                />
              </div>
              <div>
                <Label>Data</Label>
                <Input
                  type="date"
                  value={cus.data}
                  onChange={(e) => setCus({ ...cus, data: e.target.value })}
                />
              </div>
            </div>
            <Button className="mt-3 gap-2" disabled={busy} onClick={() => void novoCusto()}>
              <Plus className="h-4 w-4" />
              Adicionar
            </Button>
          </div>

          {custos.map((c) => (
            <Linha
              key={c.id}
              titulo={TIPOS_CUSTO_AQUISICAO.find((t) => t.id === c.tipo)?.label ?? c.tipo}
              valor={formatBRL(Number(c.valor))}
              aviso={
                snapshotDivergente({ valor: Number(c.valor), gastoId: c.gasto_id }, valoresGastos)
                  ? "Gasto vinculado foi editado — o caixa segue o gasto."
                  : null
              }
              onRemover={async () => {
                await excluirCustoAquisicao(c.id);
                setCustos((prev) => prev.filter((x) => x.id !== c.id));
              }}
            />
          ))}
        </TabsContent>
      </Tabs>
    </MobileShell>
  );
}

function Card({
  titulo,
  valor,
  destaque,
}: {
  titulo: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <div className={`rounded-xl border bg-card p-3 ${destaque ? "border-primary/40" : ""}`}>
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-lg font-semibold">{valor}</p>
    </div>
  );
}

function Linha({
  titulo,
  valor,
  aviso,
  onRemover,
}: {
  titulo: string;
  valor: string;
  aviso?: string | null;
  onRemover: () => Promise<void>;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3">
      <div className="min-w-0">
        <p className="truncate text-sm">{titulo}</p>
        {aviso && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-600">
            <AlertTriangle className="h-3 w-3" />
            {aviso}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-sm font-medium">{valor}</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={async () => {
            try {
              await onRemover();
            } catch (e) {
              toastFromError(e);
            }
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
