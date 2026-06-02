/**
 * Helper para enviar uma compra finalizada (Carrinho/Lista/Cupom) à base
 * pública `community_market_prices`.
 *
 * - Filtra itens sem preço válido — eles continuam apenas no histórico local.
 * - Se nenhum item válido sobrar, não chama o servidor.
 * - Se o usuário não estiver autenticado, ignora silenciosamente
 *   (a compra local já foi salva).
 * - Toasts e mensagens ficam por conta do caller para manter o controle
 *   da UX de cada fluxo.
 */

import { submitPurchaseToCommunityPrices, type SubmitPurchaseResult } from "@/lib/mercado/community-prices-from-purchase.functions";
import type { ListaItem, MercadoCompraHistorico } from "@/lib/mercado/listas-store";

export type CommunitySubmitInput = {
  marketName: string;
  source: "store" | "receipt";
  /** Data da compra (default: hoje, local TZ). */
  date?: Date;
  notes?: string;
  items: ListaItem[];
};

function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultNote(source: "store" | "receipt"): string {
  return source === "receipt"
    ? "Preço registrado a partir de compra finalizada importada do cupom fiscal."
    : "Preço registrado a partir de compra finalizada no carrinho.";
}

/**
 * Converte os itens de uma compra finalizada em payload e envia ao servidor.
 * Retorna o resultado ou `null` quando nada foi enviado.
 */
export async function submitFinalizedPurchase(
  input: CommunitySubmitInput,
): Promise<SubmitPurchaseResult | null> {
  const market = (input.marketName || "").trim();
  if (!market) return null;

  const valid = (input.items || []).filter(
    (it) =>
      typeof it.precoEstimado === "number" &&
      Number.isFinite(it.precoEstimado) &&
      it.precoEstimado > 0 &&
      typeof it.nome === "string" &&
      it.nome.trim().length > 0,
  );
  if (valid.length === 0) return null;

  const seenAt = toLocalISODate(input.date ?? new Date());

  const payload = {
    marketName: market,
    source: input.source,
    seenAt,
    notes: (input.notes || "").trim() || defaultNote(input.source),
    items: valid.map((it) => ({
      productName: it.nome.trim(),
      price: it.precoEstimado as number,
      unit: it.unidade?.trim() || null,
      category: it.categoria?.trim() || null,
      barcode: it.codigoBarras?.trim() || null,
      brand: null,
      imageUrl: null,
      imageSource: null,
      imageConfidence: null,
    })),
  };

  try {
    return await submitPurchaseToCommunityPrices({ data: payload });
  } catch (err) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("[mercado] community submit failed", err);
    }
    return null;
  }
}

/** Conveniência: extrai data + itens de uma entrada de histórico. */
export function submitHistoricoToCommunity(
  entry: MercadoCompraHistorico,
  source: "store" | "receipt",
): Promise<SubmitPurchaseResult | null> {
  const market = (entry.mercadoNome || "").trim();
  if (!market) return Promise.resolve(null);
  const date = entry.concluidaEm ? new Date(entry.concluidaEm) : new Date();
  return submitFinalizedPurchase({
    marketName: market,
    source,
    date,
    items: entry.itensSnapshot ?? [],
  });
}
