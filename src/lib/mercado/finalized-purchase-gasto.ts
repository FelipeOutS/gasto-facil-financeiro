/**
 * Cria automaticamente um gasto na aba Gastos a partir de uma compra
 * finalizada do Mercado Inteligente (Carrinho, Lista ou Cupom).
 *
 * Regras:
 *  - Total preferencial = soma de `precoPago * quantidade` quando o item
 *    tiver preço pago; senão usa `precoEstimado * quantidade`.
 *  - Itens sem nenhum preço válido são ignorados no cálculo.
 *  - Se o total for 0, NÃO cria gasto (não polui a aba Gastos com R$ 0,00).
 *  - Categoria: "mercado" (chave legada usada pelo sistema de gastos).
 *  - Se `cartaoId` informado e formaPagamento for credito/debito, vincula
 *    para que apareça em Cartões/fatura/limite usado.
 */

import { addGastoAuto } from "@/lib/store";
import type { FormaPagamento } from "@/lib/types";
import type { ListaItem } from "@/lib/mercado/listas-store";

function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function pricedOf(it: ListaItem): number | null {
  const pago =
    typeof it?.precoPago === "number" && Number.isFinite(it.precoPago) && it.precoPago > 0
      ? (it.precoPago as number)
      : null;
  if (pago !== null) return pago;
  const est =
    typeof it?.precoEstimado === "number" &&
    Number.isFinite(it.precoEstimado) &&
    it.precoEstimado > 0
      ? (it.precoEstimado as number)
      : null;
  return est;
}

export type FinalizedPurchaseGastoInput = {
  marketName: string;
  formaPagamento: FormaPagamento;
  cartaoId?: string;
  items: ListaItem[];
  date?: Date;
  /** Texto opcional anexado à observação do gasto. */
  notes?: string;
};

export type FinalizedPurchaseGastoResult = {
  total: number;
  itemsCounted: number;
  itemsSkipped: number;
  created: boolean;
  gastoId?: string;
  /** "empty" = nenhum item com preço; "blocked" = addGasto bloqueado/sem usuário; "error" = exception. */
  reason?: "empty" | "blocked" | "error";
  error?: string;
};

export function createGastoFromFinalizedPurchase(
  input: FinalizedPurchaseGastoInput,
): FinalizedPurchaseGastoResult {
  const items = Array.isArray(input.items) ? input.items : [];
  const valid = items.filter(
    (it) => typeof it?.nome === "string" && it.nome.trim().length > 0 && pricedOf(it) !== null,
  );
  const total =
    Math.round(
      valid.reduce((s, it) => s + (pricedOf(it) as number) * (it.quantidade || 1), 0) * 100,
    ) / 100;

  if (total <= 0) {
    return {
      total: 0,
      itemsCounted: 0,
      itemsSkipped: items.length,
      created: false,
      reason: "empty",
    };
  }

  const market = (input.marketName || "").trim() || "Mercado";
  const data = toLocalISODate(input.date ?? new Date());

  const lines = valid.slice(0, 30).map((it) => {
    const qty = it.quantidade && it.quantidade > 1 ? ` x${it.quantidade}` : "";
    return `• ${it.nome}${qty}`;
  });
  if (valid.length > 30) lines.push(`… +${valid.length - 30}`);
  const baseNote = `Compra finalizada pelo Mercado Inteligente.`;
  const observacao = [baseNote, input.notes?.trim(), lines.join("\n")].filter(Boolean).join("\n\n");

  // Cartão (de crédito) só faz sentido vinculado quando o pagamento é crédito.
  // A tabela `cartoes` modela APENAS cartões de crédito (com limite, fechamento
  // e vencimento de fatura). Vincular um débito ao cartão consumiria
  // incorretamente o limite e poluiria a fatura — por isso ignoramos.
  const cartaoId =
    input.cartaoId && input.formaPagamento === "credito" ? input.cartaoId : undefined;

  try {
    const created = addGastoAuto({
      descricao: `Compra em ${market}`,
      valor: total,
      data,
      estabelecimento: market,
      categoriaId: "mercado",
      formaPagamento: input.formaPagamento,
      cartaoId,
      observacao,
      origem: "mercado_inteligente",
    });

    if (!created || created.length === 0) {
      return {
        total,
        itemsCounted: valid.length,
        itemsSkipped: items.length - valid.length,
        created: false,
        reason: "blocked",
        error: "addGasto returned no rows (sem usuário ativo ou sem permissão de escrita)",
      };
    }

    return {
      total,
      itemsCounted: valid.length,
      itemsSkipped: items.length - valid.length,
      created: true,
      gastoId: created[0]?.id,
    };
  } catch (err) {
    return {
      total,
      itemsCounted: valid.length,
      itemsSkipped: items.length - valid.length,
      created: false,
      reason: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
