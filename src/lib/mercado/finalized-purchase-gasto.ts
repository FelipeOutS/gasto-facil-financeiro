/**
 * Cria automaticamente um gasto na aba Gastos a partir de uma compra
 * finalizada do Mercado Inteligente (Carrinho, Lista ou Cupom).
 *
 * Regras:
 *  - Total = soma de `precoEstimado * quantidade` dos itens com preço válido.
 *  - Itens sem preço são ignorados no cálculo, mas a compra ainda é registrada.
 *  - Se o total for 0, NÃO cria gasto (não polui a aba Gastos com R$ 0,00).
 *  - Categoria: "mercado".
 *  - Se `cartaoId` informado e formaPagamento for credito/debito, vincula.
 */

import { addGasto } from "@/lib/store";
import type { FormaPagamento } from "@/lib/types";
import type { ListaItem } from "@/lib/mercado/listas-store";

function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
};

export function createGastoFromFinalizedPurchase(
  input: FinalizedPurchaseGastoInput,
): FinalizedPurchaseGastoResult {
  const items = Array.isArray(input.items) ? input.items : [];
  const valid = items.filter(
    (it) =>
      typeof it?.precoEstimado === "number" &&
      Number.isFinite(it.precoEstimado as number) &&
      (it.precoEstimado as number) > 0 &&
      typeof it?.nome === "string" &&
      it.nome.trim().length > 0,
  );
  const total = Math.round(
    valid.reduce(
      (s, it) => s + (it.precoEstimado as number) * (it.quantidade || 1),
      0,
    ) * 100,
  ) / 100;

  if (total <= 0) {
    return {
      total: 0,
      itemsCounted: 0,
      itemsSkipped: items.length,
      created: false,
    };
  }

  const market = (input.marketName || "").trim() || "Mercado";
  const data = toLocalISODate(input.date ?? new Date());

  const lines = valid
    .slice(0, 30)
    .map((it) => {
      const qty = it.quantidade && it.quantidade > 1 ? ` x${it.quantidade}` : "";
      return `• ${it.nome}${qty}`;
    });
  if (valid.length > 30) lines.push(`… +${valid.length - 30}`);
  const baseNote = `Compra finalizada pelo Mercado Inteligente.`;
  const observacao = [baseNote, input.notes?.trim(), lines.join("\n")]
    .filter(Boolean)
    .join("\n\n");

  // Cartão só faz sentido quando pagamento é débito/crédito.
  const cartaoId =
    input.cartaoId && (input.formaPagamento === "credito" || input.formaPagamento === "debito")
      ? input.cartaoId
      : undefined;

  try {
    addGasto({
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
  } catch {
    return {
      total,
      itemsCounted: valid.length,
      itemsSkipped: items.length - valid.length,
      created: false,
    };
  }

  return {
    total,
    itemsCounted: valid.length,
    itemsSkipped: items.length - valid.length,
    created: true,
  };
}
