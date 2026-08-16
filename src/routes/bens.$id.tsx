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
  TrendingUp,
  Wallet,
  History,
  Calendar,
  PieChart,
  Calculator,
  FileText,
  Sparkles,
} from "lucide-react";
import { SimuladorFinanciamento } from "@/components/bens/SimuladorFinanciamento";
import { Card as UICard, CardContent as UICardContent } from "@/components/ui/card";
import { ImportFinanciamentoDialog } from "@/components/bens/ImportFinanciamentoDialog";



import { MobileShell } from "@/components/MobileShell";
import { cn } from "@/lib/utils";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toastFromError } from "@/lib/premium-error";
import { formatBRL, parseBRLInput, formatBRLInput, todayISO } from "@/lib/format";
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
  listarHistoricoValor,
  criarHistoricoValor,
  listarHistoricoSaldo,
  criarHistoricoSaldo,
  type AmortizacaoBem,
  type Bem,
  type CustoAquisicaoBem,
  type Financiamento,
  type GastoDoBem,
  type PagamentoBem,
  type StatusFinanciamento,
  type TipoCustoAquisicao,
  type HistoricoValorBem,
  type HistoricoSaldoBem,
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
  const [historicoValor, setHistoricoValor] = useState<HistoricoValorBem[]>([]);
  const [historicoSaldo, setHistoricoSaldo] = useState<HistoricoSaldoBem[]>([]);
  const [gastosDisponiveis, setGastosDisponiveis] = useState<GastoDoBem[]>([]);
  const [gastoParaVincular, setGastoParaVincular] = useState<string>("");
  const [busy, setBusy] = useState(false);
  
  // V2 UI State
  const [dialogValorOpen, setDialogValorOpen] = useState(false);
  const [dialogSaldoOpen, setDialogSaldoOpen] = useState(false);
  const [formValor, setFormValor] = useState({ valor: "", data: todayISO(), obs: "" });
  const [formSaldo, setFormSaldo] = useState({ valor: "", data: todayISO(), obs: "" });
  const [importDocOpen, setImportDocOpen] = useState(false);


  const carregar = useCallback(async () => {
    try {
      const [b, f, p, a, c, g, hv] = await Promise.all([
        obterBem(id),
        listarFinanciamentos(id),
        listarPagamentos(id),
        listarAmortizacoes(id),
        listarCustosAquisicao(id),
        listarGastosDoBem(id),
        listarHistoricoValor(id),
      ]);
      setBem(b);
      setFinanciamentos(f);
      setPagamentos(p);
      setAmortizacoes(a);
      setCustos(c);
      setGastos(g);
      setHistoricoValor(hv);
      
      const ativo = f.find(x => x.status === "ativo");
      if (ativo) {
        setHistoricoSaldo(await listarHistoricoSaldo(ativo.id));
      }

      if (b?.user_id) setGastosDisponiveis(await listarGastosSemBem(b.user_id));
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
            historicoValor,
            historicoSaldo,
          })
        : null,
    [bem, ativo, pagamentos, amortizacoes, custos, valoresGastos, gastos, historicoValor, historicoSaldo],
  );


  // ---- formulários simples -------------------------------------------------
  const [fin, setFin] = useState({
    instituicao: "",
    valor_financiado: "",
    prazo_meses: "",
    taxa_juros_anual: "",
    taxa_juros_periodicidade: "anual",
    taxa_juros_tipo: "nominal",
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


  async function atualizarValorBem() {
    if (!user?.id) return;
    if (!formValor.valor) {
      toast.error("Informe o valor estimado.");
      return;
    }
    setBusy(true);
    try {
      const novo = await criarHistoricoValor(user.id, id, {
        valor_estimado: parseBRLInput(formValor.valor),
        data_referencia: formValor.data,
        observacao: formValor.obs || null,
      });
      setHistoricoValor((prev) => [novo, ...prev]);
      setDialogValorOpen(false);
      setFormValor({ valor: "", data: todayISO(), obs: "" });
      toast.success("Valor atualizado.");
    } catch (e) {
      toastFromError(e);
    } finally {
      setBusy(false);
    }
  }

  async function atualizarSaldoManual() {
    if (!user?.id || !ativo) return;
    if (!formSaldo.valor) {
      toast.error("Informe o saldo devedor.");
      return;
    }
    setBusy(true);
    try {
      const novo = await criarHistoricoSaldo(user.id, ativo.id, {
        saldo_devedor: parseBRLInput(formSaldo.valor),
        data_referencia: formSaldo.data,
        observacao: formSaldo.obs || null,
      });
      setHistoricoSaldo((prev) => [novo, ...prev]);
      setDialogSaldoOpen(false);
      setFormSaldo({ valor: "", data: todayISO(), obs: "" });
      toast.success("Saldo devedor atualizado.");
    } catch (e) {
      toastFromError(e);
    } finally {
      setBusy(false);
    }
  }

  async function novoCusto() {
    if (!user?.id || !id) return;
    if (!cus.valor) {
      toast.error("Informe o valor do custo.");
      return;
    }
    setBusy(true);
    try {
      const criado = await criarCustoAquisicao(user.id, id, {
        tipo: cus.tipo,
        valor: parseBRLInput(cus.valor),
        data: cus.data || null,
      });
      setCustos((prev) => [...prev, criado]);
      setCus({ tipo: "itbi", valor: "", data: todayISO() });
      toast.success("Custo adicionado.");
    } catch (e) {

      toastFromError(e);
    } finally {
      setBusy(false);
    }
  }


  const timelineCronologica = useMemo(() => {
    if (!bem) return [];
    const eventos: Array<{
      data: string;
      tipo: string;
      label: string;
      valor?: number;
      obs?: string;
    }> = [];

    if (bem.data_aquisicao) {
      eventos.push({
        data: bem.data_aquisicao,
        tipo: "compra",
        label: "Aquisição do bem",
        valor: Number(bem.valor_aquisicao),
      });
    }

    pagamentos.forEach((p) =>
      eventos.push({
        data: p.data_pagamento,
        tipo: "pagamento",
        label: `Parcela ${p.numero_parcela || ""}`,
        valor: Number(p.valor_pago),
      }),
    );
    amortizacoes.forEach((a) =>
      eventos.push({
        data: a.data,
        tipo: "amortizacao",
        label: "Amortização extraordinária",
        valor: Number(a.valor),
        obs: a.origem_recurso || "",
      }),
    );
    custos.forEach((c) =>
      eventos.push({
        data: c.data || "",
        tipo: "custo",
        label: TIPOS_CUSTO_AQUISICAO.find((t) => t.id === c.tipo)?.label || "Custo",
        valor: Number(c.valor),
      }),
    );

    const idsJaContabilizados = new Set(
      [
        ...pagamentos.map((p) => p.gasto_id),
        ...amortizacoes.map((a) => a.gasto_id),
        ...custos.map((c) => c.gasto_id),
      ].filter((x): x is string => !!x),
    );

    gastos
      .filter((g) => !idsJaContabilizados.has(g.id))
      .forEach((g) =>
        eventos.push({ data: g.data, tipo: "gasto", label: g.descricao, valor: Number(g.valor) }),
      );

    historicoValor.forEach((h) =>
      eventos.push({
        data: h.data_referencia,
        tipo: "valor",
        label: "Valor estimado atualizado",
        valor: Number(h.valor_estimado),
        obs: h.observacao || "",
      }),
    );
    historicoSaldo.forEach((h) =>
      eventos.push({
        data: h.data_referencia,
        tipo: "saldo",
        label: "Saldo devedor atualizado",
        valor: Number(h.saldo_devedor),
        obs: h.observacao || "",
      }),
    );

    return eventos.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
  }, [bem, pagamentos, amortizacoes, custos, gastos, historicoValor, historicoSaldo]);



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
        <>
          <section className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
                <TrendingUp className="h-3.5 w-3.5" />
                Patrimônio Líquido
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-primary">
                  {resumo.patrimonioLiquidoEstimado !== null ? formatBRL(resumo.patrimonioLiquidoEstimado) : "—"}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Com base nos valores informados por você.
              </p>
            </div>

            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
                  <PieChart className="h-3.5 w-3.5" />
                  Valor Atual
                </div>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setDialogValorOpen(true)}>
                  Atualizar
                </Button>
              </div>
              <div className="mt-1 text-2xl font-bold">
                {resumo.valorAtualEstimado !== null ? formatBRL(resumo.valorAtualEstimado) : "Não informado"}
              </div>
              {resumo.variacaoValorPercentual !== null && (
                <p className={cn("mt-1 text-[10px] font-medium", resumo.variacaoValorPercentual >= 0 ? "text-emerald-600" : "text-rose-600")}>
                  {resumo.variacaoValorPercentual >= 0 ? "+" : ""}
                  {resumo.variacaoValorPercentual.toFixed(1)}% vs compra
                </p>
              )}
            </div>

            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
                  <Wallet className="h-3.5 w-3.5" />
                  Saldo Devedor
                </div>
                {ativo && (
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setDialogSaldoOpen(true)}>
                    Atualizar
                  </Button>
                )}
              </div>
              <div className="mt-1 text-2xl font-bold text-rose-600/90">
                {resumo.saldoDevedorEstimado !== null ? formatBRL(resumo.saldoDevedorEstimado) : "0,00"}
              </div>
              {resumo.percentualPago !== null && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${resumo.percentualPago}%` }} />
                </div>
              )}
            </div>
          </section>

          <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card titulo="Entrada" valor={formatBRL(resumo.entradaTotal)} />
            <Card titulo="Custos iniciais" valor={formatBRL(resumo.totalCustosAquisicao)} />
            <Card
              titulo={`Parcelas pagas (${resumo.qtdParcelasPagas})`}
              valor={formatBRL(resumo.totalParcelasPagas)}
            />
            <Card titulo="Amortizações" valor={formatBRL(resumo.totalAmortizacoes)} />
            <Card
              titulo="Quanto já custou"
              valor={formatBRL(resumo.totalDesembolsado)}
              destaque
            />
            <Card titulo="Custo do mês" valor={formatBRL(resumo.custoMensalGastos)} />
            <Card titulo="Diferença nominal" valor={formatBRL(resumo.variacaoValorNominal || 0)} />
            <Card titulo="Redução do saldo" valor={formatBRL(resumo.reducaoSaldoDevedorNominal || 0)} />
            <Card titulo="Amortizado (FGTS)" valor={formatBRL(resumo.totalAmortizadoFGTS)} />

          </section>

          {resumo.totalAmortizacoes > 0 && (
            <section className="mt-6">
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3 px-1">
                <Landmark className="h-4 w-4" />
                Amortizações Realizadas
              </h3>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <div className="rounded-xl border p-3 bg-muted/30">
                  <div className="text-[10px] text-muted-foreground uppercase">Total Amortizado</div>
                  <div className="text-sm font-bold">{formatBRL(resumo.totalAmortizacoes)}</div>
                </div>
                {resumo.totalAmortizadoFGTS > 0 && (
                  <div className="rounded-xl border p-3 bg-muted/30">
                    <div className="text-[10px] text-muted-foreground uppercase">FGTS</div>
                    <div className="text-sm font-bold">{formatBRL(resumo.totalAmortizadoFGTS)}</div>
                  </div>
                )}
                {resumo.totalAmortizadoProprio > 0 && (
                  <div className="rounded-xl border p-3 bg-muted/30">
                    <div className="text-[10px] text-muted-foreground uppercase">Recursos Próprios</div>
                    <div className="text-sm font-bold">{formatBRL(resumo.totalAmortizadoProprio)}</div>
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}



      <p className="mt-3 flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Quando um pagamento, amortização ou custo está ligado a um gasto, o desembolso é contado uma
        única vez — usamos o valor do gasto e mantemos o valor original do lançamento como
        histórico.
      </p>

      <Tabs defaultValue="detalhes" className="mt-4 pb-12">
        <TabsList className="grid w-full grid-cols-7 h-10">
          <TabsTrigger value="detalhes" className="text-[10px] px-1">Resumo</TabsTrigger>
          <TabsTrigger value="simulacao" className="text-[10px] px-1 font-semibold text-primary">Simular</TabsTrigger>
          <TabsTrigger value="parcelas" className="text-[10px] px-1">Parcelas</TabsTrigger>
          <TabsTrigger value="amortizacoes" className="text-[10px] px-1">Amortizar</TabsTrigger>
          <TabsTrigger value="custos" className="text-[10px] px-1">Custos</TabsTrigger>
          <TabsTrigger value="gastos" className="text-[10px] px-1">Gastos</TabsTrigger>
          <TabsTrigger value="timeline" className="text-[10px] px-1">Histórico</TabsTrigger>
        </TabsList>



        <TabsContent value="simulacao" className="space-y-4 pt-2">
          {!ativo ? (
            <UICard className="border-dashed">
              <UICardContent className="pt-6">
                <div className="flex flex-col items-center text-center space-y-3">
                  <Info className="h-8 w-8 text-muted-foreground" />
                  <h3 className="font-medium text-sm">Sem financiamento ativo</h3>
                  <p className="text-xs text-muted-foreground max-w-[280px]">
                    Para simular amortizações, você precisa cadastrar um financiamento ativo para este bem na aba <strong>Resumo</strong>.
                  </p>
                </div>
              </UICardContent>
            </UICard>
          ) : (
            <SimuladorFinanciamento
              financiamento={ativo}
              saldoAtual={resumo?.saldoDevedorEstimado || 0}
            />
          )}
        </TabsContent>



        <TabsContent value="detalhes" className="space-y-3">

          {financiamentos.length === 0 ? (
            <div className="rounded-xl border p-4 text-center">
              <p className="text-sm text-muted-foreground">Nenhum financiamento cadastrado.</p>
            </div>
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

          <div className="flex justify-center pt-2">
            <Button 
              variant="outline" 
              className="w-full gap-2 border-dashed h-12 text-muted-foreground hover:text-primary hover:border-primary transition-colors"
              onClick={() => setImportDocOpen(true)}
            >
              <FileText className="h-4 w-4" />
              Atualizar por documento (PDF/Imagem)
              <Sparkles className="h-3 w-3 text-primary animate-pulse ml-1" />
            </Button>
          </div>


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
                    onChange={(e) => setFin({ ...fin, valor_financiado: formatBRLInput(e.target.value) })}

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
                <div className="space-y-3 sm:col-span-2">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <Label>Taxa de juros (%)</Label>
                      <Input
                        inputMode="decimal"
                        value={fin.taxa_juros_anual}
                        onChange={(e) => setFin({ ...fin, taxa_juros_anual: e.target.value })}
                        placeholder="Ex: 10,50"
                      />
                    </div>
                    <div>
                      <Label>Periodicidade</Label>
                      <Select
                        value={fin.taxa_juros_periodicidade}
                        onValueChange={(v) => setFin({ ...fin, taxa_juros_periodicidade: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="anual">ao ano</SelectItem>
                          <SelectItem value="mensal">ao mês</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Tipo da Taxa</Label>
                      <Select
                        value={fin.taxa_juros_tipo}
                        onValueChange={(v) => setFin({ ...fin, taxa_juros_tipo: v })}
                        disabled={fin.taxa_juros_periodicidade === 'mensal'}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="nominal">Nominal</SelectItem>
                          <SelectItem value="efetiva">Efetiva</SelectItem>
                          <SelectItem value="nao_definido">Não sei / Legada</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {fin.taxa_juros_periodicidade === 'anual' && fin.taxa_juros_tipo === 'efetiva' && (
                    <p className="text-[10px] text-muted-foreground italic">
                      Taxas efetivas anuais são convertidas para a taxa mensal equivalente via capitalização composta.
                    </p>
                  )}
                  {fin.taxa_juros_periodicidade === 'anual' && fin.taxa_juros_tipo === 'nominal' && (
                    <p className="text-[10px] text-muted-foreground italic">
                      Taxas nominais anuais são divididas por 12 (capitalização simples mensal).
                    </p>
                  )}
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
                      <SelectItem value="sac">SAC (parcela cai com o tempo)</SelectItem>
                      <SelectItem value="price">Price (parcela fixa)</SelectItem>
                      <SelectItem value="outro">Não sei</SelectItem>
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
                <div>
                  <Label>Dia de vencimento</Label>
                  <Input
                    inputMode="numeric"
                    value={fin.dia_vencimento}
                    onChange={(e) => setFin({ ...fin, dia_vencimento: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Saldo devedor atual</Label>
                  <Input
                    inputMode="decimal"
                    value={fin.saldo_devedor_informado}
                    onChange={(e) =>
                      setFin({ ...fin, saldo_devedor_informado: formatBRLInput(e.target.value) })
                    }

                  />
                </div>
                <div>
                  <Label>Data do saldo</Label>
                  <Input
                    type="date"
                    value={fin.saldo_devedor_data}
                    onChange={(e) => setFin({ ...fin, saldo_devedor_data: e.target.value })}
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Não sabe a taxa, o sistema ou o saldo? Deixe em branco — nada é inventado, e você
                pode preencher depois.
              </p>
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
                <Label>Nº da parcela</Label>
                <Input
                  inputMode="numeric"
                  value={pag.numero_parcela}
                  onChange={(e) => setPag({ ...pag, numero_parcela: e.target.value })}
                />
              </div>
              <div>
                <Label>Valor pago</Label>
                <Input
                  inputMode="decimal"
                  value={pag.valor_pago}
                  onChange={(e) => setPag({ ...pag, valor_pago: formatBRLInput(e.target.value) })}

                />
              </div>
              <div>
                <Label>Juros</Label>
                <Input
                  inputMode="decimal"
                  value={pag.valor_juros}
                  onChange={(e) => setPag({ ...pag, valor_juros: formatBRLInput(e.target.value) })}

                />
              </div>
              <div>
                <Label>Amortização (principal)</Label>
                <Input
                  inputMode="decimal"
                  value={pag.valor_amortizacao}
                  onChange={(e) => setPag({ ...pag, valor_amortizacao: formatBRLInput(e.target.value) })}

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
            <div className="grid gap-3 sm:grid-cols-2">
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
                  onChange={(e) => setAmo({ ...amo, valor: formatBRLInput(e.target.value) })}

                />
              </div>
              <div>
                <Label>Origem</Label>
                <Select
                  value={amo.origem_recurso}
                  onValueChange={(v) => setAmo({ ...amo, origem_recurso: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="proprio">Recursos próprios</SelectItem>
                    <SelectItem value="fgts">FGTS</SelectItem>
                    <SelectItem value="terceiros">Terceiros</SelectItem>
                    <SelectItem value="outros">Outros</SelectItem>
                  </SelectContent>
                </Select>
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
                  onChange={(e) => setCus({ ...cus, valor: formatBRLInput(e.target.value) })}

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
                  onChange={(e) => setCus({ ...cus, valor: formatBRLInput(e.target.value) })}
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

        <TabsContent value="gastos" className="space-y-3">


          <p className="text-xs text-muted-foreground">
            Vincule gastos que você já lançou (condomínio, IPTU, seguro, combustível, manutenção…).
            O gasto continua aparecendo em Gastos e é contado uma única vez.
          </p>
          <div className="rounded-xl border p-4">
            <Label>Vincular gasto existente</Label>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <Select value={gastoParaVincular} onValueChange={setGastoParaVincular}>
                <SelectTrigger className="min-w-0 flex-1">
                  <SelectValue placeholder="Escolha um gasto" />
                </SelectTrigger>
                <SelectContent>
                  {gastosDisponiveis.length === 0 ? (
                    <SelectItem value="__vazio" disabled>
                      Nenhum gasto disponível
                    </SelectItem>
                  ) : (
                    gastosDisponiveis.map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.data} · {x.descricao} · {formatBRL(Number(x.valor))}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button
                className="gap-2"
                disabled={busy || !gastoParaVincular || gastoParaVincular === "__vazio"}
                onClick={async () => {
                  const alvo = gastosDisponiveis.find((x) => x.id === gastoParaVincular);
                  if (!alvo) return;
                  setBusy(true);
                  try {
                    await vincularGastoAoBem(alvo, id);
                    setGastoParaVincular("");
                    await carregar();
                    toast.success("Gasto vinculado ao bem.");
                  } catch (e) {
                    toastFromError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Plus className="h-4 w-4" />
                Vincular
              </Button>
            </div>
          </div>

          {gastos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum gasto vinculado a este bem.</p>
          ) : (
            gastos.map((x) => (
              <div
                key={x.id}
                className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{x.descricao}</p>
                  <p className="text-xs text-muted-foreground">
                    {x.data}
                    {x.recorrencia_id ? " · recorrente" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-medium">{formatBRL(Number(x.valor))}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      try {
                        await vincularGastoAoBem(x, null);
                        await carregar();
                      } catch (e) {
                        toastFromError(e);
                      }
                    }}
                  >
                    Desvincular
                  </Button>
                </div>
              </div>
            ))
          )}
        </TabsContent>
        <TabsContent value="timeline" className="space-y-3">
          {timelineCronologica.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum evento registrado ainda.</p>
          ) : (
            timelineCronologica.map((ev, idx) => (
              <div key={idx} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className={cn(
                    "h-6 w-6 rounded-full flex items-center justify-center text-[10px] text-white",
                    ev.tipo === "compra" ? "bg-primary" :
                    ev.tipo === "pagamento" ? "bg-emerald-500" :
                    ev.tipo === "amortizacao" ? "bg-amber-500" :
                    ev.tipo === "valor" ? "bg-blue-500" :
                    ev.tipo === "saldo" ? "bg-rose-500" :
                    "bg-slate-500"
                  )}>
                    {ev.tipo.charAt(0).toUpperCase()}
                  </div>
                  {idx < timelineCronologica.length - 1 && <div className="w-0.5 grow bg-border mt-1" />}
                </div>
                <div className="pb-4 min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium truncate">{ev.label}</p>
                    {ev.valor !== undefined && <span className="text-sm font-bold shrink-0">{formatBRL(ev.valor)}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">{ev.data} {ev.obs ? `· ${ev.obs}` : ""}</p>
                </div>
              </div>
            ))
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogValorOpen} onOpenChange={setDialogValorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atualizar valor do bem</DialogTitle>
            <DialogDescription>Informe quanto você estima que este bem vale atualmente.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Valor estimado</Label>
              <Input
                placeholder="R$ 0,00"
                value={formValor.valor}
                onChange={(e) => setFormValor({ ...formValor, valor: formatBRLInput(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>Data de referência</Label>
              <Input
                type="date"
                value={formValor.data}
                onChange={(e) => setFormValor({ ...formValor, data: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Observação (opcional)</Label>
              <Input
                placeholder="Ex: Avaliação pessoal, valor anunciado..."
                value={formValor.obs}
                onChange={(e) => setFormValor({ ...formValor, obs: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogValorOpen(false)}>Cancelar</Button>
            <Button onClick={() => void atualizarValorBem()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogSaldoOpen} onOpenChange={setDialogSaldoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atualizar saldo devedor</DialogTitle>
            <DialogDescription>Informe o saldo devedor atual consultado na fonte oficial.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Novo saldo</Label>
              <Input
                placeholder="R$ 0,00"
                value={formSaldo.valor}
                onChange={(e) => setFormSaldo({ ...formSaldo, valor: formatBRLInput(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>Data de referência</Label>
              <Input
                type="date"
                value={formSaldo.data}
                onChange={(e) => setFormSaldo({ ...formSaldo, data: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Observação (opcional)</Label>
              <Input
                placeholder="Ex: Saldo no app do banco..."
                value={formSaldo.obs}
                onChange={(e) => setFormSaldo({ ...formSaldo, obs: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogSaldoOpen(false)}>Cancelar</Button>
            <Button onClick={() => void atualizarSaldoManual()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ImportFinanciamentoDialog
        open={importDocOpen}
        onOpenChange={setImportDocOpen}
        bemId={id}
        financiamentoId={ativo?.id}
        onSuccess={carregar}
      />
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
