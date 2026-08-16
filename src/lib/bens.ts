import { supabase } from "@/integrations/supabase/client";

/**
 * MEUS BENS & FINANCIAMENTOS — V1
 *
 * Regras de contabilização (documentadas e cobertas por testes):
 *
 * 1. ENTRADA — vive exclusivamente em `bens.entrada_total` (com a composição
 *    em recursos próprios / FGTS / outros). A entrada NUNCA é lançada em
 *    `bens_custos_aquisicao`; aquela tabela guarda apenas custos ADICIONAIS
 *    (ITBI, registro, escritura, avaliação, corretagem, documentação…).
 *    Isso elimina a dupla contabilização da entrada.
 *
 * 2. CONTAGEM ÚNICA — pagamentos, amortizações e custos guardam um snapshot
 *    do valor do evento. Quando o registro possui `gastoId`, o desembolso
 *    financeiro é contabilizado UMA única vez: usamos o valor do gasto
 *    vinculado (fonte de caixa) e o snapshot serve como histórico. Nunca
 *    somamos `valor do evento + valor do gasto`.
 *
 * 3. GASTO EDITADO DEPOIS — se o gasto vinculado for editado, o total
 *    desembolsado passa a refletir o novo valor do gasto (fonte de caixa),
 *    enquanto o snapshot do evento permanece intacto para auditoria. A UI
 *    sinaliza a divergência entre snapshot e gasto.
 *
 * 4. GASTO EXCLUÍDO — a FK usa ON DELETE SET NULL: o evento sobrevive e
 *    volta a ser contabilizado pelo snapshot.
 *
 * 5. INTEGRIDADE DE CONTA — todos os vínculos (bem_id, financiamento_id,
 *    gasto_id) usam FK composta com `user_id`, então o banco recusa
 *    qualquer tentativa de apontar para registro de outra conta.
 */

export type TipoBem = "imovel" | "veiculo";
export type StatusBem = "ativo" | "arquivado" | "vendido";

export const TIPOS_BEM: Array<{ id: TipoBem; label: string }> = [
  { id: "imovel", label: "Imóvel" },
  { id: "veiculo", label: "Veículo" },
];

export type StatusFinanciamento = "ativo" | "liquidado" | "portado" | "refinanciado" | "cancelado";

export const STATUS_FINANCIAMENTO: Array<{ id: StatusFinanciamento; label: string }> = [
  { id: "ativo", label: "Ativo" },
  { id: "liquidado", label: "Liquidado" },
  { id: "portado", label: "Portado" },
  { id: "refinanciado", label: "Refinanciado" },
  { id: "cancelado", label: "Cancelado" },
];

export type TipoCustoAquisicao =
  | "itbi"
  | "registro"
  | "escritura"
  | "avaliacao"
  | "corretagem"
  | "documentacao"
  | "vistoria"
  | "transferencia"
  | "outros";

export const TIPOS_CUSTO_AQUISICAO: Array<{ id: TipoCustoAquisicao; label: string }> = [
  { id: "itbi", label: "ITBI" },
  { id: "registro", label: "Registro" },
  { id: "escritura", label: "Escritura" },
  { id: "avaliacao", label: "Avaliação" },
  { id: "corretagem", label: "Corretagem" },
  { id: "documentacao", label: "Documentação" },
  { id: "vistoria", label: "Vistoria" },
  { id: "transferencia", label: "Transferência" },
  { id: "outros", label: "Outros" },
];

export type Bem = {
  id: string;
  user_id: string;
  tipo: TipoBem;
  nome: string;
  descricao?: string | null;
  status: StatusBem;
  data_aquisicao?: string | null;
  valor_aquisicao?: number | null;
  valor_mercado?: number | null;
  entrada_total: number;
  entrada_recursos_proprios: number;
  entrada_fgts: number;
  entrada_outros: number;
  endereco?: string | null;
  area_m2?: number | null;
  matricula?: string | null;
  marca?: string | null;
  modelo?: string | null;
  ano_modelo?: number | null;
  placa?: string | null;
  observacao?: string | null;
  arquivado_em?: string | null;
  created_at: string;
  updated_at: string;
};

export type Financiamento = {
  id: string;
  user_id: string;
  bem_id: string;
  instituicao?: string | null;
  modalidade?: string | null;
  sistema_amortizacao?: "sac" | "price" | "outro" | null;
  valor_financiado: number;
  taxa_juros_anual?: number | null;
  taxa_juros_periodicidade?: "mensal" | "anual" | null;
  taxa_juros_tipo?: "nominal" | "efetiva" | "nao_definido" | null;
  prazo_meses?: number | null;
  primeiro_vencimento?: string | null;
  dia_vencimento?: number | null;
  saldo_devedor_informado?: number | null;
  saldo_devedor_data?: string | null;
  status: StatusFinanciamento;
  motivo_encerramento?: string | null;
  encerrado_em?: string | null;
  substituido_por_id?: string | null;
  observacao?: string | null;
  created_at: string;
  updated_at: string;
};

export type PagamentoBem = {
  id: string;
  user_id: string;
  bem_id: string;
  financiamento_id?: string | null;
  numero_parcela?: number | null;
  competencia?: string | null;
  data_pagamento: string;
  valor_pago: number;
  valor_juros?: number | null;
  valor_amortizacao?: number | null;
  valor_seguro?: number | null;
  valor_taxas?: number | null;
  gasto_id?: string | null;
  observacao?: string | null;
  created_at: string;
  updated_at: string;
};

export type AmortizacaoBem = {
  id: string;
  user_id: string;
  bem_id: string;
  financiamento_id?: string | null;
  data: string;
  valor: number;
  origem_recurso?: "proprio" | "fgts" | "terceiros" | "outros" | null;
  efeito?: "reduz_prazo" | "reduz_parcela" | null;
  gasto_id?: string | null;
  observacao?: string | null;
  created_at: string;
  updated_at: string;
};

export type CustoAquisicaoBem = {
  id: string;
  user_id: string;
  bem_id: string;
  tipo: TipoCustoAquisicao;
  descricao?: string | null;
  valor: number;
  data?: string | null;
  gasto_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type ResumoBem = {
  entradaTotal: number;
  entradaComposicaoConfere: boolean;
  totalCustosAquisicao: number;
  totalParcelasPagas: number;
  qtdParcelasPagas: number;
  totalAmortizacoes: number;
  /** gastos vinculados ao bem que NÃO são fonte de caixa de outro evento */
  totalGastosRelacionados: number;
  /** custo do mês de referência somando apenas gastos relacionados */
  custoMensalGastos: number;
  /** entrada + custos adicionais + parcelas + amortizações + gastos (cada evento uma única vez) */
  totalDesembolsado: number;
  /** null = não informado (sem dados suficientes) */
  saldoDevedorEstimado: number | null;
  parcelasRestantes: number | null;
  percentualPago: number | null;
  // --- V2 Patrimônio ---
  valorAtualEstimado: number | null;
  patrimonioLiquidoEstimado: number | null;
  variacaoValorNominal: number | null;
  variacaoValorPercentual: number | null;
  reducaoSaldoDevedorNominal: number | null;
  totalAmortizadoFGTS: number;
  totalAmortizadoProprio: number;
  totalAmortizadoOutros: number;
};

export type HistoricoValorBem = {
  id: string;
  bem_id: string;
  valor_estimado: number;
  data_referencia: string;
  observacao?: string | null;
};

export type HistoricoSaldoBem = {
  id: string;
  financiamento_id: string;
  saldo_devedor: number;
  data_referencia: string;
  observacao?: string | null;
};

// ---------------------------------------------------------------------------
// Cálculos puros (sem I/O) — testáveis
// ---------------------------------------------------------------------------

export type EventoFinanceiro = { valor: number; gastoId?: string | null };

/** Mapa `gastoId -> valor atual do gasto`. */
export type ValoresGastos = Record<string, number>;

/**
 * Valor efetivo de desembolso de um evento. Contagem única:
 * com gasto vinculado, o caixa vem do gasto; sem vínculo, do snapshot.
 */
export function valorEfetivoDesembolso(ev: EventoFinanceiro, gastos: ValoresGastos = {}): number {
  if (ev.gastoId && Object.prototype.hasOwnProperty.call(gastos, ev.gastoId)) {
    return gastos[ev.gastoId] ?? 0;
  }
  return ev.valor ?? 0;
}

/** true quando o gasto vinculado foi editado e divergiu do snapshot do evento. */
export function snapshotDivergente(ev: EventoFinanceiro, gastos: ValoresGastos = {}): boolean {
  if (!ev.gastoId || !Object.prototype.hasOwnProperty.call(gastos, ev.gastoId)) return false;
  return Math.abs((gastos[ev.gastoId] ?? 0) - (ev.valor ?? 0)) > 0.005;
}

export type GastoDoBem = {
  id: string;
  descricao: string;
  valor: number;
  data: string;
  categoria?: string | null;
  recorrencia_id?: string | null;
};


export function calcularResumoBem(args: {
  bem: Pick<
    Bem,
    "entrada_total" | "entrada_recursos_proprios" | "entrada_fgts" | "entrada_outros" | "valor_aquisicao"
  >;
  financiamento?: Financiamento | null;
  pagamentos: PagamentoBem[];
  amortizacoes: AmortizacaoBem[];
  custos: CustoAquisicaoBem[];
  valoresGastos?: ValoresGastos;
  /** gastos com `bem_id` apontando para este bem */
  gastos?: GastoDoBem[];
  /** mês de referência do custo mensal, formato YYYY-MM */
  mesReferencia?: string;
  /** V2: histórico de valor para determinar o valor atual */
  historicoValor?: HistoricoValorBem[];
  /** V2: histórico de saldo para determinar o saldo informado mais recente */
  historicoSaldo?: HistoricoSaldoBem[];
}): ResumoBem {
  const { bem, financiamento, pagamentos, amortizacoes, custos, historicoValor = [], historicoSaldo = [] } = args;
  const g = args.valoresGastos ?? {};
  const gastos = args.gastos ?? [];

  const entradaTotal = Number(bem.entrada_total ?? 0);
  const composicao =
    Number(bem.entrada_recursos_proprios ?? 0) +
    Number(bem.entrada_fgts ?? 0) +
    Number(bem.entrada_outros ?? 0);
  const entradaComposicaoConfere =
    composicao === 0 || Math.abs(composicao - entradaTotal) <= 0.005;

  const totalCustosAquisicao = custos.reduce(
    (s, c) => s + valorEfetivoDesembolso({ valor: Number(c.valor), gastoId: c.gasto_id }, g),
    0,
  );
  const totalParcelasPagas = pagamentos.reduce(
    (s, p) => s + valorEfetivoDesembolso({ valor: Number(p.valor_pago), gastoId: p.gasto_id }, g),
    0,
  );
  const totalAmortizacoes = amortizacoes.reduce(
    (s, a) => s + valorEfetivoDesembolso({ valor: Number(a.valor), gastoId: a.gasto_id }, g),
    0,
  );

  const totalAmortizadoFGTS = amortizacoes
    .filter((a) => a.origem_recurso === "fgts")
    .reduce((s, a) => s + valorEfetivoDesembolso({ valor: Number(a.valor), gastoId: a.gasto_id }, g), 0);
  const totalAmortizadoProprio = amortizacoes
    .filter((a) => a.origem_recurso === "proprio")
    .reduce((s, a) => s + valorEfetivoDesembolso({ valor: Number(a.valor), gastoId: a.gasto_id }, g), 0);
  const totalAmortizadoOutros = amortizacoes
    .filter((a) => a.origem_recurso !== "fgts" && a.origem_recurso !== "proprio")
    .reduce((s, a) => s + valorEfetivoDesembolso({ valor: Number(a.valor), gastoId: a.gasto_id }, g), 0);

  // Gastos que já são fonte de caixa de um pagamento/amortização/custo não podem
  // ser somados de novo: eles já entraram acima via `valorEfetivoDesembolso`.
  const idsJaContabilizados = new Set(
    [
      ...pagamentos.map((p) => p.gasto_id),
      ...amortizacoes.map((a) => a.gasto_id),
      ...custos.map((c) => c.gasto_id),
    ].filter((x): x is string => !!x),
  );
  const gastosAvulsos = gastos.filter((x) => !idsJaContabilizados.has(x.id));
  const totalGastosRelacionados = gastosAvulsos.reduce((s2, x) => s2 + Number(x.valor ?? 0), 0);
  const custoMensalGastos = args.mesReferencia
    ? gastosAvulsos
        .filter((x) => (x.data ?? "").slice(0, 7) === args.mesReferencia)
        .reduce((s2, x) => s2 + Number(x.valor ?? 0), 0)
    : 0;

  const totalDesembolsado =
    entradaTotal +
    totalCustosAquisicao +
    totalParcelasPagas +
    totalAmortizacoes +
    totalGastosRelacionados;

  // --- V2: Patrimônio e Evolução ---

  // 1. Valor Atual Estimado
  const ultimoValorInformado = [...historicoValor].sort(
    (a, b) => new Date(b.data_referencia).getTime() - new Date(a.data_referencia).getTime(),
  )[0];
  const valorAtualEstimado = ultimoValorInformado ? Number(ultimoValorInformado.valor_estimado) : null;

  // 2. Saldo Devedor
  let saldoDevedorEstimado: number | null = null;
  let reducaoSaldoDevedorNominal: number | null = null;

  if (financiamento) {
    const saldoNoFinanciamento = financiamento.saldo_devedor_informado != null 
      ? { valor: Number(financiamento.saldo_devedor_informado), data: financiamento.saldo_devedor_data }
      : null;
    const saldoNoHist = [...historicoSaldo].sort(
      (a, b) => new Date(b.data_referencia).getTime() - new Date(a.data_referencia).getTime(),
    )[0];
    
    let saldoReferencia = saldoNoFinanciamento;
    if (saldoNoHist && (!saldoNoFinanciamento || new Date(saldoNoHist.data_referencia) >= new Date(saldoNoFinanciamento.data || ""))) {
      saldoReferencia = { valor: Number(saldoNoHist.saldo_devedor), data: saldoNoHist.data_referencia };
    }

    if (saldoReferencia) {
      const corte = saldoReferencia.data ?? null;
      const depois = (d: string | null | undefined) => (corte ? (d ?? "") > corte : true);
      const principalPosSaldo = pagamentos
        .filter((p) => depois(p.data_pagamento))
        .reduce((s, p) => s + Number(p.valor_amortizacao ?? 0), 0);
      const amortPosSaldo = amortizacoes
        .filter((a) => depois(a.data))
        .reduce((s, a) => s + Number(a.valor ?? 0), 0);
      saldoDevedorEstimado = Math.max(0, Number((saldoReferencia.valor - principalPosSaldo - amortPosSaldo).toFixed(2)));
    } else {
      const principalPago = pagamentos.reduce((s, p) => s + Number(p.valor_amortizacao ?? 0), 0);
      saldoDevedorEstimado = Math.max(0, Number((Number(financiamento.valor_financiado ?? 0) - principalPago - totalAmortizacoes).toFixed(2)));
    }
    
    reducaoSaldoDevedorNominal = Number(financiamento.valor_financiado) - (saldoDevedorEstimado ?? 0);
  } else {
    saldoDevedorEstimado = null;
    reducaoSaldoDevedorNominal = null;
  }

  // 3. Patrimônio Líquido Estimado
  const patrimonioLiquidoEstimado = valorAtualEstimado !== null 
    ? Math.max(0, valorAtualEstimado - (saldoDevedorEstimado || 0))
    : null;

  // 4. Variação de Valor (Compra vs Atual)
  const valorCompra = Number(bem.valor_aquisicao ?? 0);
  const variacaoValorNominal = (valorAtualEstimado !== null && valorCompra > 0)
    ? valorAtualEstimado - valorCompra
    : null;
  const variacaoValorPercentual = (variacaoValorNominal !== null && valorCompra > 0)
    ? (variacaoValorNominal / valorCompra) * 100
    : null;

  const prazo = financiamento?.prazo_meses ?? null;
  const parcelasRestantes = prazo != null ? Math.max(0, prazo - pagamentos.length) : null;
  const percentualPago =
    financiamento && Number(financiamento.valor_financiado ?? 0) > 0 && saldoDevedorEstimado != null
      ? Math.min(
          100,
          Math.max(
            0,
            ((Number(financiamento.valor_financiado) - saldoDevedorEstimado) /
              Number(financiamento.valor_financiado)) *
              100,
          ),
        )
      : null;

  return {
    entradaTotal,
    entradaComposicaoConfere,
    totalCustosAquisicao,
    totalParcelasPagas,
    qtdParcelasPagas: pagamentos.length,
    totalAmortizacoes,
    totalGastosRelacionados,
    custoMensalGastos,
    totalDesembolsado,
    saldoDevedorEstimado,
    parcelasRestantes,
    percentualPago,
    valorAtualEstimado,
    patrimonioLiquidoEstimado,
    variacaoValorNominal,
    variacaoValorPercentual,
    reducaoSaldoDevedorNominal,
    totalAmortizadoFGTS,
    totalAmortizadoProprio,
    totalAmortizadoOutros,
  };
}

/** Apenas um financiamento ativo por bem — histórico preservado. */
export function financiamentoAtivo(lista: Financiamento[]): Financiamento | null {
  return lista.find((f) => f.status === "ativo") ?? null;
}

/** Bem com histórico não pode ser excluído: o caminho é arquivar. */
export function podeExcluirBem(args: {
  pagamentos: number;
  amortizacoes: number;
  custos: number;
  gastos: number;
  recorrencias: number;
}): boolean {
  return (
    args.pagamentos === 0 &&
    args.amortizacoes === 0 &&
    args.custos === 0 &&
    args.gastos === 0 &&
    args.recorrencias === 0
  );
}

// ---------------------------------------------------------------------------
// Acesso a dados (RLS por auth.uid(); FK composta garante mesma conta)
// ---------------------------------------------------------------------------

export async function listarBens(userId: string): Promise<Bem[]> {
  const { data, error } = await supabase
    .from("bens" as never)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Bem[];
}

export async function obterBem(id: string): Promise<Bem | null> {
  const { data, error } = await supabase
    .from("bens" as never)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as Bem | null;
}

export async function criarBem(userId: string, payload: Partial<Bem>): Promise<Bem> {
  const { data, error } = await supabase
    .from("bens" as never)
    .insert({ ...payload, user_id: userId } as never)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as Bem;
}

export async function atualizarBem(id: string, patch: Partial<Bem>): Promise<void> {
  const { error } = await supabase
    .from("bens" as never)
    .update(patch as never)
    .eq("id", id);
  if (error) throw error;
}

/** V1: remover = arquivar. Preserva pagamentos, amortizações, custos e gastos. */
export async function arquivarBem(id: string): Promise<void> {
  await atualizarBem(id, {
    status: "arquivado",
    arquivado_em: new Date().toISOString(),
  } as Partial<Bem>);
}

export async function reativarBem(id: string): Promise<void> {
  await atualizarBem(id, { status: "ativo", arquivado_em: null } as Partial<Bem>);
}

/**
 * Exclusão definitiva. O banco recusa (trigger) quando existe histórico —
 * nesse caso o usuário deve arquivar.
 */
export async function excluirBemSemHistorico(id: string): Promise<void> {
  const { error } = await supabase
    .from("bens" as never)
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function listarFinanciamentos(bemId: string): Promise<Financiamento[]> {
  const { data, error } = await supabase
    .from("bens_financiamentos" as never)
    .select("*")
    .eq("bem_id", bemId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Financiamento[];
}

export async function criarFinanciamento(
  userId: string,
  bemId: string,
  payload: Partial<Financiamento>,
): Promise<Financiamento> {
  const { data, error } = await supabase
    .from("bens_financiamentos" as never)
    .insert({ ...payload, user_id: userId, bem_id: bemId } as never)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as Financiamento;
}

export async function atualizarFinanciamento(
  id: string,
  patch: Partial<Financiamento>,
): Promise<void> {
  const { error } = await supabase
    .from("bens_financiamentos" as never)
    .update(patch as never)
    .eq("id", id);
  if (error) throw error;
}

export async function listarPagamentos(bemId: string): Promise<PagamentoBem[]> {
  const { data, error } = await supabase
    .from("bens_pagamentos" as never)
    .select("*")
    .eq("bem_id", bemId)
    .order("data_pagamento", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PagamentoBem[];
}

export async function criarPagamento(
  userId: string,
  bemId: string,
  payload: Partial<PagamentoBem>,
): Promise<PagamentoBem> {
  // Deduplicação básica: não permitir mesma parcela para o mesmo financiamento no mesmo dia
  if (payload.financiamento_id && payload.numero_parcela) {
    const { data: existente } = await supabase
      .from("bens_pagamentos" as never)
      .select("id")
      .eq("financiamento_id", payload.financiamento_id)
      .eq("numero_parcela", payload.numero_parcela)
      .eq("data_pagamento", payload.data_pagamento || "")
      .maybeSingle();
    
    if (existente) {
      throw new Error(`A parcela ${payload.numero_parcela} já foi registrada nesta data.`);
    }
  }

  const { data, error } = await supabase
    .from("bens_pagamentos" as never)
    .insert({ ...payload, user_id: userId, bem_id: bemId } as never)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as PagamentoBem;
}

export async function excluirPagamento(id: string): Promise<void> {
  const { error } = await supabase
    .from("bens_pagamentos" as never)
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function listarAmortizacoes(bemId: string): Promise<AmortizacaoBem[]> {
  const { data, error } = await supabase
    .from("bens_amortizacoes" as never)
    .select("*")
    .eq("bem_id", bemId)
    .order("data", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as AmortizacaoBem[];
}

export async function criarAmortizacao(
  userId: string,
  bemId: string,
  payload: Partial<AmortizacaoBem>,
): Promise<AmortizacaoBem> {
  // Deduplicação: evitar mesmo valor na mesma data para o mesmo financiamento
  if (payload.financiamento_id && payload.valor && payload.data) {
    const { data: existente } = await supabase
      .from("bens_amortizacoes" as never)
      .select("id")
      .eq("financiamento_id", payload.financiamento_id)
      .eq("valor", payload.valor)
      .eq("data", payload.data || "")
      .maybeSingle();
    
    if (existente) {
      throw new Error(`Uma amortização de ${payload.valor} já foi registrada nesta data.`);
    }
  }

  const { data, error } = await supabase
    .from("bens_amortizacoes" as never)
    .insert({ ...payload, user_id: userId, bem_id: bemId } as never)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as AmortizacaoBem;
}

export async function excluirAmortizacao(id: string): Promise<void> {
  const { error } = await supabase
    .from("bens_amortizacoes" as never)
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function listarCustosAquisicao(bemId: string): Promise<CustoAquisicaoBem[]> {
  const { data, error } = await supabase
    .from("bens_custos_aquisicao" as never)
    .select("*")
    .eq("bem_id", bemId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as CustoAquisicaoBem[];
}

export async function criarCustoAquisicao(
  userId: string,
  bemId: string,
  payload: Partial<CustoAquisicaoBem>,
): Promise<CustoAquisicaoBem> {
  const { data, error } = await supabase
    .from("bens_custos_aquisicao" as never)
    .insert({ ...payload, user_id: userId, bem_id: bemId } as never)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as CustoAquisicaoBem;
}

export async function excluirCustoAquisicao(id: string): Promise<void> {
  const { error } = await supabase
    .from("bens_custos_aquisicao" as never)
    .delete()
    .eq("id", id);
  if (error) throw error;
}

/** Gastos vinculados ao bem (fonte de caixa + rastreabilidade). */
export async function listarGastosDoBem(bemId: string): Promise<GastoDoBem[]> {
  const { data, error } = await supabase
    .from("gastos" as never)
    .select("id, descricao, valor, data, recorrencia_id")
    .eq("bem_id", bemId)
    .order("data", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as GastoDoBem[];
}

/** Gastos do usuário ainda sem bem vinculado — usados no seletor de vínculo. */
export async function listarGastosSemBem(userId: string, limite = 60): Promise<GastoDoBem[]> {
  const { data, error } = await supabase
    .from("gastos" as never)
    .select("id, descricao, valor, data, recorrencia_id")
    .eq("user_id", userId)
    .is("bem_id", null)
    .order("data", { ascending: false })
    .limit(limite);
  if (error) throw error;
  return (data ?? []) as unknown as GastoDoBem[];
}

/**
 * Vincula (ou desvincula) um gasto já existente a um bem. Não cria gasto novo:
 * apenas atualiza `bem_id`, então o valor continua contado uma única vez.
 * Quando o gasto pertence a uma recorrência, o vínculo é propagado para a
 * recorrência e suas demais ocorrências — o motor de recorrência segue sendo o
 * do app, sem motor paralelo dentro de Meus Bens.
 */
export async function vincularGastoAoBem(
  gasto: Pick<GastoDoBem, "id" | "recorrencia_id">,
  bemId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("gastos" as never)
    .update({ bem_id: bemId } as never)
    .eq("id", gasto.id);
  if (error) throw error;

  if (gasto.recorrencia_id) {
    const { error: e2 } = await supabase
      .from("recorrencias" as never)
      .update({ bem_id: bemId } as never)
      .eq("id", gasto.recorrencia_id);
    if (e2) throw e2;
    const { error: e3 } = await supabase
      .from("gastos" as never)
      .update({ bem_id: bemId } as never)
      .eq("recorrencia_id", gasto.recorrencia_id);
    if (e3) throw e3;
  }
}

// ---------------------------------------------------------------------------
// V2: Acesso ao Histórico de Valor e Saldo
// ---------------------------------------------------------------------------

export async function listarHistoricoValor(bemId: string): Promise<HistoricoValorBem[]> {
  const { data, error } = await supabase
    .from("bens_historico_valor" as never)
    .select("*")
    .eq("bem_id", bemId)
    .order("data_referencia", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as HistoricoValorBem[];
}

export async function criarHistoricoValor(
  userId: string,
  bemId: string,
  payload: Partial<HistoricoValorBem>
): Promise<HistoricoValorBem> {
  const { data, error } = await supabase
    .from("bens_historico_valor" as never)
    .insert({ ...payload, user_id: userId, bem_id: bemId } as never)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as HistoricoValorBem;
}

export async function listarHistoricoSaldo(financiamentoId: string): Promise<HistoricoSaldoBem[]> {
  const { data, error } = await supabase
    .from("bens_historico_saldo" as never)
    .select("*")
    .eq("financiamento_id", financiamentoId)
    .order("data_referencia", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as HistoricoSaldoBem[];
}

export async function criarHistoricoSaldo(
  userId: string,
  financiamentoId: string,
  payload: Partial<HistoricoSaldoBem>
): Promise<HistoricoSaldoBem> {
  const { data, error } = await supabase
    .from("bens_historico_saldo" as never)
    .insert({ ...payload, user_id: userId, financiamento_id: financiamentoId } as never)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as HistoricoSaldoBem;
}
