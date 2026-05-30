import { supabase } from "@/integrations/supabase/client";

export type TipoInvestimento =
  | "acoes"
  | "fii"
  | "etf"
  | "bdr"
  | "tesouro"
  | "cdb"
  | "lci"
  | "lca"
  | "lc"
  | "fundo"
  | "previdencia"
  | "cripto"
  | "outros";

export const TIPOS_INVESTIMENTO: Array<{ id: TipoInvestimento; label: string; classe: string }> = [
  { id: "acoes", label: "Ações", classe: "Renda variável" },
  { id: "fii", label: "FIIs", classe: "Renda variável" },
  { id: "etf", label: "ETFs", classe: "Renda variável" },
  { id: "bdr", label: "BDRs", classe: "Renda variável" },
  { id: "tesouro", label: "Tesouro Direto", classe: "Renda fixa" },
  { id: "cdb", label: "CDB", classe: "Renda fixa" },
  { id: "lci", label: "LCI", classe: "Renda fixa" },
  { id: "lca", label: "LCA", classe: "Renda fixa" },
  { id: "lc", label: "LC", classe: "Renda fixa" },
  { id: "fundo", label: "Fundo de investimento", classe: "Fundos" },
  { id: "previdencia", label: "Previdência", classe: "Fundos" },
  { id: "cripto", label: "Cripto", classe: "Cripto" },
  { id: "outros", label: "Outros", classe: "Outros" },
];

export type RentabilidadeTipo = "cdi" | "ipca" | "prefixado" | "selic" | "outro";

export type TipoMovimentacao =
  | "compra"
  | "venda"
  | "aplicacao"
  | "resgate"
  | "transferencia"
  | "rendimento"
  | "dividendo"
  | "jcp"
  | "amortizacao"
  | "bonificacao"
  | "desdobramento"
  | "grupamento";

export const TIPOS_MOVIMENTACAO: Array<{ id: TipoMovimentacao; label: string }> = [
  { id: "compra", label: "Compra" },
  { id: "venda", label: "Venda" },
  { id: "aplicacao", label: "Aplicação" },
  { id: "resgate", label: "Resgate" },
  { id: "transferencia", label: "Transferência" },
  { id: "rendimento", label: "Rendimento" },
  { id: "dividendo", label: "Dividendo" },
  { id: "jcp", label: "JCP" },
  { id: "amortizacao", label: "Amortização" },
  { id: "bonificacao", label: "Bonificação" },
  { id: "desdobramento", label: "Desdobramento" },
  { id: "grupamento", label: "Grupamento" },
];

export type TipoRendimento = "dividendo" | "jcp" | "rendimento_fii" | "renda_fixa" | "cupom" | "amortizacao" | "outro";

export const TIPOS_RENDIMENTO: Array<{ id: TipoRendimento; label: string }> = [
  { id: "dividendo", label: "Dividendo" },
  { id: "jcp", label: "JCP" },
  { id: "rendimento_fii", label: "Rendimento FII" },
  { id: "renda_fixa", label: "Renda fixa" },
  { id: "cupom", label: "Cupom" },
  { id: "amortizacao", label: "Amortização" },
  { id: "outro", label: "Outro" },
];

export type Importacao = {
  id: string;
  user_id: string;
  tipo: string; // 'b3' | 'corretora' | 'csv' | 'pdf' | 'manual'
  arquivo_nome: string | null;
  status: string; // 'pendente' | 'concluida' | 'erro' | 'parcial' | 'excluida'
  dados_extraidos: unknown;
  erros: string | null;
  resumo: { ativos?: number; movimentacoes?: number; rendimentos?: number } | null;
  created_at: string;
};

export type Ativo = {
  id: string;
  nome: string;
  ticker: string | null;
  tipo: TipoInvestimento;
  instituicao: string | null;
  quantidade: number | null;
  preco_medio: number | null;
  importacao_id?: string | null;
  preco_atual: number | null;
  valor_aplicado: number;
  valor_atual: number;
  rentabilidade_tipo: string | null;
  rentabilidade_percentual: string | null;
  data_inicio: string | null;
  data_vencimento: string | null;
  liquidez: string | null;
  observacao: string | null;
  origem: string | null;
  ultima_atualizacao: string | null;
  created_at: string;
  updated_at: string;
};

export type AtualizacaoValor = {
  id: string;
  ativo_id: string;
  valor_anterior: number | null;
  valor_novo: number | null;
  preco_anterior: number | null;
  preco_novo: number | null;
  data_atualizacao: string;
  observacao: string | null;
  origem: string;
  created_at: string;
};

export type Movimentacao = {
  id: string;
  ativo_id: string | null;
  tipo: TipoMovimentacao;
  data: string;
  quantidade: number | null;
  valor_unitario: number | null;
  valor_total: number;
  instituicao: string | null;
  observacao: string | null;
  origem: string | null;
  created_at: string;
  importacao_id?: string | null;
};

export type Rendimento = {
  id: string;
  ativo_id: string | null;
  tipo: TipoRendimento;
  data_pagamento: string;
  valor: number;
  status: "recebido" | "previsto";
  observacao: string | null;
  origem: string | null;
  created_at: string;
  importacao_id?: string | null;
};

export function tipoLabel(t: string): string {
  return TIPOS_INVESTIMENTO.find((x) => x.id === t)?.label ?? t;
}

export function classeAtivo(t: string): string {
  return TIPOS_INVESTIMENTO.find((x) => x.id === t)?.classe ?? "Outros";
}

// ---------- i18n helpers (Etapa 36) ----------
// Visual-only helpers. IDs internos, values e regras de negócio permanecem inalterados.
// O parâmetro `t` é a função do react-i18next vinda do componente (não usar hook aqui).
type TFunc = (key: string, options?: Record<string, unknown>) => string;

const CLASSE_TO_KEY: Record<string, string> = {
  "Renda variável": "rendaVariavel",
  "Renda fixa": "rendaFixa",
  Fundos: "fundos",
  Cripto: "cripto",
  Outros: "outros",
};

export function getTipoInvestimentoLabel(id: string, t?: TFunc): string {
  const fallback = TIPOS_INVESTIMENTO.find((x) => x.id === id)?.label ?? id;
  if (!t) return fallback;
  const key = `investimentos:types.investment.${id}`;
  const translated = t(key);
  return translated && translated !== key ? translated : fallback;
}

export function getTipoInvestimentoClasseLabel(id: string, t?: TFunc): string {
  const classeRaw = TIPOS_INVESTIMENTO.find((x) => x.id === id)?.classe ?? "Outros";
  if (!t) return classeRaw;
  const classeKey = CLASSE_TO_KEY[classeRaw] ?? "outros";
  const key = `investimentos:types.investmentClass.${classeKey}`;
  const translated = t(key);
  return translated && translated !== key ? translated : classeRaw;
}

export function getTipoMovimentacaoLabel(id: string, t?: TFunc): string {
  const fallback = TIPOS_MOVIMENTACAO.find((x) => x.id === id)?.label ?? id;
  if (!t) return fallback;
  const key = `investimentos:types.movement.${id}`;
  const translated = t(key);
  return translated && translated !== key ? translated : fallback;
}

export function getTipoRendimentoLabel(id: string, t?: TFunc): string {
  const fallback = TIPOS_RENDIMENTO.find((x) => x.id === id)?.label ?? id;
  if (!t) return fallback;
  const key = `investimentos:types.income.${id}`;
  const translated = t(key);
  return translated && translated !== key ? translated : fallback;
}

export async function listarAtivos(userId: string): Promise<Ativo[]> {
  const { data, error } = await supabase
    .from("investimentos_ativos" as never)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Ativo[];
}

export async function listarMovimentacoes(userId: string): Promise<Movimentacao[]> {
  const { data, error } = await supabase
    .from("investimentos_movimentacoes" as never)
    .select("*")
    .eq("user_id", userId)
    .order("data", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Movimentacao[];
}

export async function listarRendimentos(userId: string): Promise<Rendimento[]> {
  const { data, error } = await supabase
    .from("investimentos_rendimentos" as never)
    .select("*")
    .eq("user_id", userId)
    .order("data_pagamento", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Rendimento[];
}

export async function criarAtivo(userId: string, payload: Partial<Ativo>): Promise<Ativo> {
  const { data, error } = await supabase
    .from("investimentos_ativos" as never)
    .insert({ ...payload, user_id: userId } as never)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as Ativo;
}

export async function atualizarAtivo(id: string, patch: Partial<Ativo>): Promise<void> {
  const { error } = await supabase
    .from("investimentos_ativos" as never)
    .update(patch as never)
    .eq("id", id);
  if (error) throw error;
}

export async function excluirAtivo(id: string): Promise<void> {
  const { error } = await supabase.from("investimentos_ativos" as never).delete().eq("id", id);
  if (error) throw error;
}

export async function criarMovimentacao(userId: string, payload: Partial<Movimentacao>): Promise<Movimentacao> {
  const { data, error } = await supabase
    .from("investimentos_movimentacoes" as never)
    .insert({ ...payload, user_id: userId } as never)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as Movimentacao;
}

export async function atualizarMovimentacao(id: string, patch: Partial<Movimentacao>): Promise<void> {
  const { error } = await supabase
    .from("investimentos_movimentacoes" as never)
    .update(patch as never)
    .eq("id", id);
  if (error) throw error;
}

export async function excluirMovimentacao(id: string): Promise<void> {
  const { error } = await supabase.from("investimentos_movimentacoes" as never).delete().eq("id", id);
  if (error) throw error;
}

export async function criarRendimento(userId: string, payload: Partial<Rendimento>): Promise<Rendimento> {
  const { data, error } = await supabase
    .from("investimentos_rendimentos" as never)
    .insert({ ...payload, user_id: userId } as never)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as Rendimento;
}

export async function atualizarRendimento(id: string, patch: Partial<Rendimento>): Promise<void> {
  const { error } = await supabase
    .from("investimentos_rendimentos" as never)
    .update(patch as never)
    .eq("id", id);
  if (error) throw error;
}

export async function excluirRendimento(id: string): Promise<void> {
  const { error } = await supabase.from("investimentos_rendimentos" as never).delete().eq("id", id);
  if (error) throw error;
}

export const TIPOS_RENDA_VARIAVEL: TipoInvestimento[] = ["acoes", "fii", "etf", "bdr", "cripto"];

export function isRendaVariavel(tipo: string): boolean {
  return (TIPOS_RENDA_VARIAVEL as string[]).includes(tipo);
}

/**
 * Recalcula valor_aplicado, quantidade, preço médio e valor_atual de um ativo
 * a partir de TODAS as suas movimentações. É a maneira mais segura — funciona
 * tanto após criar quanto após editar/excluir movimentações.
 */
export async function recalcularAtivoPorMovimentacoes(
  userId: string,
  ativoId: string,
): Promise<void> {
  const { data: ativoData, error: aErr } = await supabase
    .from("investimentos_ativos" as never)
    .select("*")
    .eq("id", ativoId)
    .eq("user_id", userId)
    .maybeSingle();
  if (aErr) throw aErr;
  if (!ativoData) return;
  const ativo = ativoData as unknown as Ativo;

  const { data: movs, error: mErr } = await supabase
    .from("investimentos_movimentacoes" as never)
    .select("*")
    .eq("ativo_id", ativoId)
    .eq("user_id", userId)
    .order("data", { ascending: true });
  if (mErr) throw mErr;
  const movimentacoes = (movs ?? []) as unknown as Movimentacao[];

  const variavel = isRendaVariavel(ativo.tipo);

  let qtd = 0;
  let aplicadoCompras = 0; // soma dos valores de compras (para preço médio)
  let qtdComprada = 0;
  let aplicadoLiquido = 0; // entradas - saídas (renda fixa)

  const ENTRADAS: TipoMovimentacao[] = ["compra", "aplicacao"];
  const SAIDAS: TipoMovimentacao[] = ["venda", "resgate"];

  for (const m of movimentacoes) {
    const v = Number(m.valor_total || 0);
    const q = Number(m.quantidade || 0);
    if (ENTRADAS.includes(m.tipo)) {
      aplicadoLiquido += v;
      if (variavel && q > 0) {
        qtd += q;
        qtdComprada += q;
        aplicadoCompras += v;
      }
    } else if (SAIDAS.includes(m.tipo)) {
      aplicadoLiquido -= v;
      if (variavel && q > 0) qtd -= q;
    }
    // Outros tipos (rendimento/dividendo/jcp/transferencia/bonificacao/desdobramento/grupamento/amortizacao)
    // não alteram valor aplicado nem preço médio.
  }

  const patch: Partial<Ativo> = {};
  if (variavel) {
    patch.quantidade = qtd > 0 ? qtd : 0;
    if (qtdComprada > 0) {
      patch.preco_medio = aplicadoCompras / qtdComprada;
    }
    // valor aplicado = preço médio × quantidade restante (segura)
    if (patch.preco_medio != null && qtd > 0) {
      patch.valor_aplicado = patch.preco_medio * qtd;
    } else {
      patch.valor_aplicado = Math.max(0, aplicadoLiquido);
    }
    // Se houver preço atual conhecido, atualizar valor_atual = preço atual × qtd
    if (ativo.preco_atual != null && qtd > 0) {
      patch.valor_atual = Number(ativo.preco_atual) * qtd;
    } else if (qtd === 0) {
      patch.valor_atual = 0;
    }
  } else {
    patch.valor_aplicado = Math.max(0, aplicadoLiquido);
    // Em renda fixa, se nunca houve atualização manual de valor_atual,
    // assume valor_atual = aplicado líquido. Se o usuário já atualizou
    // manualmente, mantemos (ultima_atualizacao indica intervenção).
    if (!ativo.ultima_atualizacao) {
      patch.valor_atual = Math.max(0, aplicadoLiquido);
    }
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase
      .from("investimentos_ativos" as never)
      .update(patch as never)
      .eq("id", ativoId);
    if (error) throw error;
  }
}

export type TotaisCarteira = {
  patrimonio: number;
  aplicado: number;
  lucro: number;
  rentabilidade: number;
  rendimentosAno: number;
  rendimentosMes: number;
};

export function calcularTotais(ativos: Ativo[], rendimentos: Rendimento[]): TotaisCarteira {
  const aplicado = ativos.reduce((s, a) => s + Number(a.valor_aplicado || 0), 0);
  const patrimonio = ativos.reduce((s, a) => s + Number(a.valor_atual || a.valor_aplicado || 0), 0);
  const lucro = patrimonio - aplicado;
  const rentabilidade = aplicado > 0 ? (lucro / aplicado) * 100 : 0;
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth() + 1;
  let rendimentosAno = 0;
  let rendimentosMes = 0;
  for (const r of rendimentos) {
    if (r.status !== "recebido") continue;
    const d = new Date(r.data_pagamento + "T00:00:00");
    if (d.getFullYear() === ano) rendimentosAno += Number(r.valor || 0);
    if (d.getFullYear() === ano && d.getMonth() + 1 === mes) rendimentosMes += Number(r.valor || 0);
  }
  return { patrimonio, aplicado, lucro, rentabilidade, rendimentosAno, rendimentosMes };
}

export function distribuicaoPorTipo(ativos: Ativo[]): Array<{ tipo: string; label: string; valor: number; pct: number }> {
  const total = ativos.reduce((s, a) => s + Number(a.valor_atual || a.valor_aplicado || 0), 0);
  const map = new Map<string, number>();
  for (const a of ativos) {
    const v = Number(a.valor_atual || a.valor_aplicado || 0);
    map.set(a.tipo, (map.get(a.tipo) ?? 0) + v);
  }
  return Array.from(map.entries())
    .map(([tipo, valor]) => ({
      tipo,
      label: tipoLabel(tipo),
      valor,
      pct: total > 0 ? (valor / total) * 100 : 0,
    }))
}

// ===== Importações =====

export async function listarImportacoes(userId: string): Promise<Importacao[]> {
  const { data, error } = await supabase
    .from("investimentos_importacoes" as never)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Importacao[];
}

export async function criarImportacao(
  userId: string,
  payload: { tipo: string; arquivo_nome?: string | null; status?: string; dados_extraidos?: unknown },
): Promise<Importacao> {
  const { data, error } = await supabase
    .from("investimentos_importacoes" as never)
    .insert({
      user_id: userId,
      tipo: payload.tipo,
      arquivo_nome: payload.arquivo_nome ?? null,
      status: payload.status ?? "concluida",
      dados_extraidos: payload.dados_extraidos ?? null,
      resumo: { ativos: 0, movimentacoes: 0, rendimentos: 0 },
    } as never)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as Importacao;
}

export async function atualizarResumoImportacao(
  importacaoId: string,
  resumo: { ativos: number; movimentacoes: number; rendimentos: number },
): Promise<void> {
  const { error } = await supabase
    .from("investimentos_importacoes" as never)
    .update({ resumo, status: "concluida" } as never)
    .eq("id", importacaoId);
  if (error) throw error;
}

export type ItensImportacao = {
  ativos: Ativo[];
  movimentacoes: Movimentacao[];
  rendimentos: Rendimento[];
};

export async function listarItensImportacao(
  userId: string,
  importacaoId: string,
): Promise<ItensImportacao> {
  const [ativosRes, movsRes, rendsRes] = await Promise.all([
    supabase
      .from("investimentos_ativos" as never)
      .select("*")
      .eq("user_id", userId)
      .eq("importacao_id", importacaoId),
    supabase
      .from("investimentos_movimentacoes" as never)
      .select("*")
      .eq("user_id", userId)
      .eq("importacao_id", importacaoId),
    supabase
      .from("investimentos_rendimentos" as never)
      .select("*")
      .eq("user_id", userId)
      .eq("importacao_id", importacaoId),
  ]);
  if (ativosRes.error) throw ativosRes.error;
  if (movsRes.error) throw movsRes.error;
  if (rendsRes.error) throw rendsRes.error;
  return {
    ativos: (ativosRes.data ?? []) as unknown as Ativo[],
    movimentacoes: (movsRes.data ?? []) as unknown as Movimentacao[],
    rendimentos: (rendsRes.data ?? []) as unknown as Rendimento[],
  };
}

/** Exclui apenas o registro de histórico (mantém ativos/movs/rends). */
export async function excluirImportacaoSomenteHistorico(importacaoId: string): Promise<void> {
  const { error } = await supabase
    .from("investimentos_importacoes" as never)
    .delete()
    .eq("id", importacaoId);
  if (error) throw error;
}

/** Exclui o histórico e todos os ativos/movs/rends vinculados. */
export async function excluirImportacaoComDados(
  userId: string,
  importacaoId: string,
): Promise<void> {
  // movimentações e rendimentos primeiro (referenciam ativos)
  const m = await supabase
    .from("investimentos_movimentacoes" as never)
    .delete()
    .eq("user_id", userId)
    .eq("importacao_id", importacaoId);
  if (m.error) throw m.error;
  const r = await supabase
    .from("investimentos_rendimentos" as never)
    .delete()
    .eq("user_id", userId)
    .eq("importacao_id", importacaoId);
  if (r.error) throw r.error;
  const a = await supabase
    .from("investimentos_ativos" as never)
    .delete()
    .eq("user_id", userId)
    .eq("importacao_id", importacaoId);
  if (a.error) throw a.error;
  const i = await supabase
    .from("investimentos_importacoes" as never)
    .delete()
    .eq("id", importacaoId);
  if (i.error) throw i.error;
}

export const TIPO_IMPORTACAO_LABEL: Record<string, string> = {
  b3: "B3",
  corretora: "Corretora",
  csv: "CSV",
  pdf: "PDF",
  manual: "Manual",
};

export function getTipoImportacaoLabel(tipo: string, t?: TFunc): string {
  const fallback = TIPO_IMPORTACAO_LABEL[tipo] ?? tipo;
  if (!t) return fallback;
  const key = `investimentos:types.importSource.${tipo}`;
  const translated = t(key);
  return translated && translated !== key ? translated : fallback;
}

const RENT_TIPOS_FALLBACK: Record<string, string> = {
  cdi: "% do CDI",
  ipca: "IPCA +",
  prefixado: "Prefixado",
  selic: "Selic",
  outro: "Outro",
};

export function getRentabilidadeTipoLabel(id: string, t?: TFunc): string {
  const fallback = RENT_TIPOS_FALLBACK[id] ?? id;
  if (!t) return fallback;
  const key = `investimentos:types.rentability.${id}`;
  const translated = t(key);
  return translated && translated !== key ? translated : fallback;
}

// ===== Atualização de valores =====

export type AtualizarValorPayload = {
  valor_novo: number;
  preco_novo?: number | null;
  quantidade?: number | null;
  observacao?: string | null;
  data_atualizacao?: string; // ISO
  origem?: string;
};

export async function atualizarValorAtivo(
  userId: string,
  ativo: Ativo,
  payload: AtualizarValorPayload,
): Promise<void> {
  const dataIso = payload.data_atualizacao ?? new Date().toISOString();
  const valor_anterior = Number(ativo.valor_atual ?? 0);
  const preco_anterior = ativo.preco_atual != null ? Number(ativo.preco_atual) : null;

  const patch: Partial<Ativo> = {
    valor_atual: payload.valor_novo,
    ultima_atualizacao: dataIso,
  };
  if (payload.preco_novo != null) patch.preco_atual = payload.preco_novo;
  if (payload.quantidade != null) patch.quantidade = payload.quantidade;

  const { error: upErr } = await supabase
    .from("investimentos_ativos" as never)
    .update(patch as never)
    .eq("id", ativo.id);
  if (upErr) throw upErr;

  const { error: histErr } = await supabase
    .from("investimentos_atualizacoes" as never)
    .insert({
      user_id: userId,
      ativo_id: ativo.id,
      valor_anterior,
      valor_novo: payload.valor_novo,
      preco_anterior,
      preco_novo: payload.preco_novo ?? null,
      data_atualizacao: dataIso,
      observacao: payload.observacao ?? null,
      origem: payload.origem ?? "manual",
    } as never);
  if (histErr) throw histErr;
}

export async function listarAtualizacoesAtivo(
  userId: string,
  ativoId: string,
): Promise<AtualizacaoValor[]> {
  const { data, error } = await supabase
    .from("investimentos_atualizacoes" as never)
    .select("*")
    .eq("user_id", userId)
    .eq("ativo_id", ativoId)
    .order("data_atualizacao", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as AtualizacaoValor[];
}

/** Retorna texto relativo: "Atualizado hoje", "há 7 dias", etc. */
export function descreverUltimaAtualizacao(iso: string | null): {
  label: string;
  diasDesde: number | null;
  desatualizado: boolean;
} {
  if (!iso) return { label: "Sem atualização recente", diasDesde: null, desatualizado: true };
  const data = new Date(iso);
  if (isNaN(data.getTime())) return { label: "Sem atualização recente", diasDesde: null, desatualizado: true };
  const agora = new Date();
  const diffMs = agora.getTime() - data.getTime();
  const dias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  let label: string;
  if (dias <= 0) label = "Atualizado hoje";
  else if (dias === 1) label = "Atualizado ontem";
  else if (dias < 30) label = `Atualizado há ${dias} dias`;
  else if (dias < 60) label = "Atualizado há mais de 1 mês";
  else label = `Atualizado há ${Math.floor(dias / 30)} meses`;
  return { label, diasDesde: dias, desatualizado: dias >= 30 };
}

export function formatarDataHora(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} às ${hh}:${mi}`;
}
