/** Separate deployment gate; no environment variable or browser input enables it. */
export const PLUGGY_CONTINUOUS_AUTHORIZED = false as const;
export const CONTINUOUS_KINDS = ["purchase", "interest", "salary", "card_purchase"] as const;
export const CONTINUOUS_LABELS: Record<string, string> = {
  purchase: "Compras no débito identificadas pelo banco",
  interest: "Rendimentos identificados pelo banco",
  salary: "Salário identificado pelo banco",
  card_purchase: "Compras em cartão vinculado com fatura identificada",
};
export const CONTINUOUS_REASONS: Record<string, string> = {
  eligible: "Elegível",
  classification_review: "Revisar classificação",
  manual_classification_review: "Classificação manual: revisar",
  safety_limit: "Limite de segurança",
  card_link_required: "Vínculo de cartão necessário",
  duplicate_review: "Possível duplicação",
  writer_revalidation_review: "Dados precisam de nova revisão",
  policy_authorized: "Importada pela política",
};
