/**
 * Mercado Inteligente — Sugestões de Preço Comunitário (V2.3.3).
 *
 * Faz uma única busca por sessão de preços comunitários ativos (status=active,
 * price > 0, valid_until não expirado) e expõe um matcher por nome de produto
 * para sugerir preços em listas/carrinho. Não altera dados nem substitui o
 * preço do usuário automaticamente.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CommunitySuggestion = {
  id: string;
  productName: string;
  normalizedName: string;
  price: number;
  unit: string | null;
  marketId: string | null;
  marketName: string;
  source: string;
  seenAt: string;
  validUntil: string | null;
};

const GENERIC_WORDS = new Set([
  "kg", "g", "gr", "grama", "gramas",
  "ml", "l", "lt", "litro", "litros",
  "und", "un", "unid", "unidade", "unidades",
  "pacote", "pct", "cx", "caixa", "saco", "pack",
  "de", "do", "da", "dos", "das",
  "com", "sem", "para", "por",
  "tipo", "linha",
  "the", "of", "and", "with",
]);

/** Normaliza nome para comparação: sem acento, minúsculo, sem pontuação. */
export function normalizeProductName(name: string): string {
  return (name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens significativos (sem palavras genéricas, mínimo 3 caracteres). */
function tokensFor(name: string): string[] {
  const tokens = normalizeProductName(name)
    .split(" ")
    .filter((t) => t && t.length >= 3 && !GENERIC_WORDS.has(t));
  // Se sobrou nada (nome só com unidades), volta para todos os tokens.
  if (!tokens.length) {
    return normalizeProductName(name)
      .split(" ")
      .filter((t) => t && t.length >= 3);
  }
  return tokens;
}

function matchScore(itemTokens: string[], normalized: string): number {
  if (!itemTokens.length || !normalized) return 0;
  let hits = 0;
  for (const tok of itemTokens) {
    if (normalized.includes(tok)) hits++;
  }
  return hits / itemTokens.length;
}

// ----- Cache singleton para evitar N requests em listas com muitos itens -----
let cache: CommunitySuggestion[] | null = null;
let inflight: Promise<CommunitySuggestion[]> | null = null;
let cachedAt = 0;
const TTL_MS = 60_000;

async function fetchActivePrices(): Promise<CommunitySuggestion[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await (supabase.from("community_market_prices" as never) as any)
    .select(
      "id,product_name,normalized_product_name,price,unit,market_id,market_name,source,seen_at,valid_until",
    )
    .eq("status", "active")
    .gt("price", 0)
    .or(`valid_until.is.null,valid_until.gte.${today}`)
    .order("seen_at", { ascending: false })
    .limit(500);
  if (error || !Array.isArray(data)) return [];
  return (data as any[]).map((r) => ({
    id: String(r.id),
    productName: String(r.product_name ?? ""),
    normalizedName:
      (typeof r.normalized_product_name === "string" && r.normalized_product_name) ||
      normalizeProductName(String(r.product_name ?? "")),
    price: Number(r.price) || 0,
    unit: r.unit ?? null,
    marketId: r.market_id ?? null,
    marketName: String(r.market_name ?? ""),
    source: String(r.source ?? "manual"),
    seenAt: String(r.seen_at ?? ""),
    validUntil: r.valid_until ?? null,
  }));
}

/** Hook: retorna o pool de preços comunitários ativos (cacheado por TTL). */
export function useActiveCommunityPrices(): {
  pool: CommunitySuggestion[];
  loading: boolean;
} {
  const [pool, setPool] = useState<CommunitySuggestion[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    let cancel = false;
    const fresh = cache && Date.now() - cachedAt < TTL_MS;
    if (fresh && cache) {
      setPool(cache);
      setLoading(false);
      return;
    }
    if (!inflight) {
      inflight = fetchActivePrices()
        .then((r) => {
          cache = r;
          cachedAt = Date.now();
          inflight = null;
          return r;
        })
        .catch(() => {
          inflight = null;
          return [] as CommunitySuggestion[];
        });
    }
    setLoading(true);
    inflight.then((r) => {
      if (cancel) return;
      setPool(r);
      setLoading(false);
    });
    return () => {
      cancel = true;
    };
  }, []);

  return { pool, loading };
}

/**
 * Retorna até `limit` sugestões para um item, ordenadas:
 * 1) mesmo mercado primeiro (quando preferredMarket informado);
 * 2) menor preço;
 * 3) mais recente.
 */
export function getSuggestionsFor(
  itemName: string,
  pool: CommunitySuggestion[],
  preferredMarketId?: string | null,
  preferredMarketName?: string | null,
  limit = 5,
): CommunitySuggestion[] {
  const tokens = tokensFor(itemName);
  if (!tokens.length || !pool.length) return [];
  const prefName = preferredMarketName ? normalizeProductName(preferredMarketName) : "";
  const scored = pool
    .map((s) => ({ s, score: matchScore(tokens, s.normalizedName) }))
    .filter(({ score }) => score >= 0.6);
  scored.sort((a, b) => {
    const aSame =
      (!!preferredMarketId && a.s.marketId === preferredMarketId) ||
      (!!prefName && normalizeProductName(a.s.marketName).includes(prefName))
        ? 1
        : 0;
    const bSame =
      (!!preferredMarketId && b.s.marketId === preferredMarketId) ||
      (!!prefName && normalizeProductName(b.s.marketName).includes(prefName))
        ? 1
        : 0;
    if (aSame !== bSame) return bSame - aSame;
    if (a.s.price !== b.s.price) return a.s.price - b.s.price;
    return b.s.seenAt.localeCompare(a.s.seenAt);
  });
  return scored.slice(0, limit).map(({ s }) => s);
}
