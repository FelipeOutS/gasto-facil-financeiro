/**
 * WA-C10.b.1 — Cache em memória do worker para OCR de boleto.
 *
 * Princípios:
 *  - Key SEMPRE contém o userId — cache nunca cruza usuários.
 *  - TTL curto (10 min) — apenas evita reprocessar a MESMA mídia que o
 *    usuário acabou de reenviar.
 *  - Guarda apenas o resultado já normalizado (candidatos + sugestoes);
 *    NUNCA guarda base64, OCR bruto, URL ou mediaId.
 *  - LRU manual com cap de 200 entradas por worker para não vazar memória.
 *  - Em ambiente serverless o cache vive enquanto o isolate estiver vivo.
 */

import type { BoletoParsed } from "./whatsapp-boleto-parser";
import type { BoletoOcrSugestoes } from "./whatsapp-boleto-ocr.server";

export type CachedOcrResult = {
  candidatos: BoletoParsed[];
  sugestoes: BoletoOcrSugestoes;
};

type Entry = { expires: number; value: CachedOcrResult };

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 200;

const store = new Map<string, Entry>();

function makeKey(userId: string, sha: string, kind: "image" | "pdf"): string | null {
  if (!userId || !sha || sha.length < 8) return null;
  return `${userId}|${kind}|${sha}`;
}

export function getCachedOcr(
  userId: string,
  mediaSha: string | null | undefined,
  kind: "image" | "pdf",
): CachedOcrResult | null {
  if (!mediaSha) return null;
  const key = makeKey(userId, mediaSha, kind);
  if (!key) return null;
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    store.delete(key);
    return null;
  }
  // Toca a entrada (LRU).
  store.delete(key);
  store.set(key, entry);
  return entry.value;
}

export function setCachedOcr(
  userId: string,
  mediaSha: string | null | undefined,
  kind: "image" | "pdf",
  value: CachedOcrResult,
): void {
  if (!mediaSha) return;
  const key = makeKey(userId, mediaSha, kind);
  if (!key) return;
  if (store.size >= MAX_ENTRIES) {
    // Evict mais antigo (primeira chave inserida).
    const first = store.keys().next().value;
    if (first) store.delete(first);
  }
  store.set(key, { expires: Date.now() + TTL_MS, value });
}

/** Apenas para testes. */
export function __resetBoletoOcrCacheForTests(): void {
  store.clear();
}
