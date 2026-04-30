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
  created_at: string;
  updated_at: string;
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

export async function criarMovimentacao(userId: string, payload: Partial<Movimentacao>): Promise<void> {
  const { error } = await supabase
    .from("investimentos_movimentacoes" as never)
    .insert({ ...payload, user_id: userId } as never);
  if (error) throw error;
}

export async function criarRendimento(userId: string, payload: Partial<Rendimento>): Promise<void> {
  const { error } = await supabase
    .from("investimentos_rendimentos" as never)
    .insert({ ...payload, user_id: userId } as never);
  if (error) throw error;
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
