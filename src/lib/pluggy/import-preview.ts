import { planImport, summarizePlan, type PlanInput } from "./import-plan";

export type PreviewCard = { id: string; dia_fechamento: number; dia_vencimento: number };

/** Hypothetical links are owner-validated inputs for a pure plan, never stored or used by writers. */
export function simulateCardLinks(input: PlanInput, cards: readonly PreviewCard[], choices: readonly { accountId: string; cardId: string }[]) {
  const links = [...input.cardLinks];
  const seen = new Set<string>();
  for (const choice of choices) {
    const card = cards.find((c) => c.id === choice.cardId);
    if (!card || seen.has(choice.accountId) || !input.txs.some((t) => t.account_id === choice.accountId && t.account_type === "CREDIT")) throw new Error("pluggy_vinculo_simulado_invalido");
    seen.add(choice.accountId);
    const index = links.findIndex((l) => l.account_id === choice.accountId);
    if (index >= 0) links.splice(index, 1);
    links.push({ account_id: choice.accountId, cartao_id: card.id, dia_fechamento: card.dia_fechamento, dia_vencimento: card.dia_vencimento });
  }
  const actions = planImport({ ...input, cardLinks: links });
  return { actions, resumo: summarizePlan(actions) };
}

export const previewReason = (reason: string) => ({
  fatura_bancaria_nao_identificada: "Fatura bancária não identificada: revisar antes de importar",
  parcelamento_incompleto: "Dados de parcelas incompletos: revisão necessária",
  correspondencia_confirmada: "Já registrado pela mesma identificação bancária",
  gasto_com_estorno_no_periodo: "Gasto com estorno no período: fora do lote",
  fora_do_primeiro_lote: "Fora do primeiro lote",
  cartao_sem_vinculo_confirmado: "Compra de cartão aguardando vínculo",
  boleto_sem_identificacao: "Boleto sem identificação: revisão necessária",
  pagamento_de_fatura: "Pagamento de fatura: ignorado para evitar dupla contagem",
  possivel_duplicata_mercado_pago: "Possível duplicação com Mercado Pago",
  possivel_duplicata_lancamento_existente: "Possível duplicação com lançamento existente",
  compra_no_dia_do_fechamento: "Compra no fechamento: confirmar fatura",
  categoria_sem_correspondencia: "Categoria não encontrada nos seus gastos",
}[reason] ?? reason.replace(/_/g, " "));