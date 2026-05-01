// Central de Alertas Inteligentes — tipos e enums.

export type AlertPriority = "baixa" | "media" | "alta" | "critica";
export type AlertStatus = "unread" | "read" | "resolved" | "ignored";

export type AlertCategory =
  | "cartoes"
  | "contas"
  | "contas_receber"
  | "assinaturas"
  | "gastos"
  | "orcamento"
  | "investimentos"
  | "sistema";

export type UserAlert = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  description: string | null;
  priority: AlertPriority;
  status: AlertStatus;
  related_entity_type: string | null;
  related_entity_id: string | null;
  action_label: string | null;
  action_url: string | null;
  metadata: Record<string, unknown>;
  dedupe_key: string;
  period_key: string;
  read_at: string | null;
  resolved_at: string | null;
  ignored_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Categorização do tipo do alerta para os filtros da tela. */
export function categoryOf(type: string): AlertCategory {
  if (type.startsWith("cartao_") || type.startsWith("fatura_")) return "cartoes";
  if (type.startsWith("conta_pagar_")) return "contas";
  if (type.startsWith("conta_receber_")) return "contas_receber";
  if (type.startsWith("assinatura_") || type.startsWith("recorrencia_")) return "assinaturas";
  if (type.startsWith("orcamento_")) return "orcamento";
  if (type.startsWith("investimento_")) return "investimentos";
  if (type.startsWith("plano_") || type.startsWith("sistema_")) return "sistema";
  return "gastos";
}

export const PRIORITY_RANK: Record<AlertPriority, number> = {
  critica: 0,
  alta: 1,
  media: 2,
  baixa: 3,
};

export const PRIORITY_LABEL: Record<AlertPriority, string> = {
  critica: "Crítico",
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

export const CATEGORY_LABEL: Record<AlertCategory, string> = {
  cartoes: "Cartões",
  contas: "Contas a pagar",
  contas_receber: "Contas a receber",
  assinaturas: "Assinaturas",
  gastos: "Gastos",
  orcamento: "Orçamento",
  investimentos: "Investimentos",
  sistema: "Sistema",
};

export type DraftAlert = {
  type: string;
  title: string;
  description?: string;
  priority: AlertPriority;
  related_entity_type?: string;
  related_entity_id?: string;
  action_label?: string;
  action_url?: string;
  metadata?: Record<string, unknown>;
  /** Chave estável para deduplicação por item. Ex.: "fatura_vencendo:cartao-123" */
  dedupe_key: string;
  /** Período de validade da deduplicação. Ex.: "2026-05" ou data ISO. Se vazio, dedup global. */
  period_key?: string;
};
