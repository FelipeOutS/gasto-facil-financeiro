/**
 * FREE_ADS_LIMITS — Limites planejados para o plano `free_ads`.
 *
 * STATUS: Fase 1E-A — APENAS CONSTANTES E TIPOS.
 *
 * Este arquivo NÃO está conectado a nenhum gate, store, server function
 * ou validação SQL. Importar daqui hoje não tem efeito em produção.
 *
 * Antes de aplicar qualquer limite:
 *   1) validar server-side (RPC/server fn + RLS),
 *   2) nunca confiar apenas no client,
 *   3) decidir reset mensal (provável coluna em user_plans ou contagem por
 *      período em gastos/receitas — definir na Fase 1E-B).
 *
 * Recursos PAGOS (cartoes, orcamento, relatorios_avancados, investimentos,
 * gasto_ai, whatsapp, empresa_inteligente, mercado_avancado, importações,
 * OCR/IA) continuam BLOQUEADOS para free_ads. Estes limites se aplicam
 * apenas a futuros recursos "_basico" separados.
 */

export const FREE_ADS_LIMITS = {
  /** Lançamentos manuais de gasto por mês corrido. */
  gastosManuaisPorMes: 30,
  /** Lançamentos manuais de receita por mês corrido. */
  receitasManuaisPorMes: 10,
  /** Listas de mercado ativas (não arquivadas) simultâneas. */
  mercadoListasAtivas: 2,
  /** Itens por lista de mercado. */
  mercadoItensPorLista: 30,
  /** Janela de histórico de mercado visível, em dias. */
  mercadoHistoricoDias: 30,
  /** Metas financeiras ativas simultâneas. */
  metasAtivas: 2,
  /** Cartões cadastrados (manuais). */
  cartoesManuais: 1,
  /** Orçamentos ativos. */
  orcamentosAtivos: 1,
  /** OCR / IA / importações automáticas — bloqueadas no free_ads. */
  ocrIaImportacoes: 0,
} as const;

export type FreeAdsLimitKey = keyof typeof FREE_ADS_LIMITS;
export type FreeAdsLimits = typeof FREE_ADS_LIMITS;
