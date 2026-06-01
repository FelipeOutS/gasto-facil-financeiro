/**
 * Mercado Inteligente — cache LRU em memória (server-only)
 * ----------------------------------------------------------------------------
 * Cache simples por worker para evitar rebatimento em rajadas de lookup de
 * imagem de produto. NÃO PERSISTE — cada worker tem o seu, e some no restart.
 * Server-only por convenção (.server.ts) — não importar do client.
 */

type Entry<T> = { value: T; expiresAt: number };

const MAX_ENTRIES = 500;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const store = new Map<string, Entry<unknown>>();

export function cacheGet<T>(key: string): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  // bump recency (LRU)
  store.delete(key);
  store.set(key, hit);
  return hit.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
  if (store.size >= MAX_ENTRIES) {
    // remove o mais antigo (primeira chave inserida)
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Normaliza strings para chaves de cache (lower, sem acentos, sem espaços extras). */
export function normalizeForKey(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
