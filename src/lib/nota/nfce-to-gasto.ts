/**
 * Converte o resultado da consulta pública da NFC-e no MESMO contrato que o
 * site já consome do OCR (`OcrResult`), para reaproveitar integralmente a tela
 * de revisão, a categorização e a deduplicação avançada.
 *
 * Regras desta versão:
 *  - UMA compra = UM gasto. Itens são apenas informação auxiliar na revisão.
 *  - Forma de pagamento NUNCA é inventada (a página pública raramente informa).
 *  - Não guarda CNPJ/chave fiscal no gasto; ficam só na tela, em memória.
 */
import type { NfceFetchResult } from "@/lib/mercado/nfce-fetch.functions";

export type NotaItemAuxiliar = { nome: string; valor?: number; quantidade?: number };

export type NotaExtracao = {
  valor: number | null;
  valoresEncontrados: number[];
  data: string | null;
  descricao: string | null;
  categoriaSugerida: string | null;
  formaPagamento: null;
  confianca: "alta" | "media" | "baixa";
  observacao: string | null;
  itens: NotaItemAuxiliar[];
  fonte: "nfce_qr";
};

function somaItens(result: NfceFetchResult): number | undefined {
  if (!result.items.length) return undefined;
  let total = 0;
  let contou = 0;
  for (const it of result.items) {
    const v =
      typeof it.valorTotal === "number"
        ? it.valorTotal
        : typeof it.valorUnitario === "number"
          ? it.valorUnitario * (it.quantidade || 1)
          : undefined;
    if (typeof v === "number" && Number.isFinite(v)) {
      total += v;
      contou += 1;
    }
  }
  return contou > 0 ? Math.round(total * 100) / 100 : undefined;
}

/** `true` quando a consulta trouxe dados suficientes para pré-preencher a revisão. */
export function nfceResultIsUsable(result: NfceFetchResult): boolean {
  if (result.status === "items_found" || result.status === "total_only") {
    return typeof result.totalDeclared === "number" || result.items.length > 0;
  }
  return false;
}

export function mapNfceResultToExtracao(result: NfceFetchResult): NotaExtracao | null {
  if (!nfceResultIsUsable(result)) return null;

  const soma = somaItens(result);
  const total = typeof result.totalDeclared === "number" ? result.totalDeclared : soma;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return null;

  const valores = [total, ...(soma && Math.abs(soma - total) > 0.01 ? [soma] : [])];

  const itens: NotaItemAuxiliar[] = result.items.slice(0, 60).map((it) => ({
    nome: it.nome,
    valor:
      typeof it.valorTotal === "number"
        ? it.valorTotal
        : typeof it.valorUnitario === "number"
          ? it.valorUnitario
          : undefined,
    quantidade: typeof it.quantidade === "number" ? it.quantidade : undefined,
  }));

  return {
    valor: total,
    valoresEncontrados: valores,
    data: result.dateISO ?? null,
    descricao: result.marketName?.trim() || null,
    categoriaSugerida: itens.length > 0 ? "mercado" : null,
    formaPagamento: null,
    confianca: result.status === "items_found" ? "alta" : "media",
    observacao: null,
    itens,
    fonte: "nfce_qr",
  };
}
