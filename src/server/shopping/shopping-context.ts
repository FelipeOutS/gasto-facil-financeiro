/**
 * Contexto de compras (namespace próprio, usuário + hash do telefone, TTL 20 min).
 * Persistência real: RPCs do SQL candidato (não aplicado). Memória: SÓ para testes.
 */
import type { RpcFn } from "./shopping-quota-db";
import type { Offer } from "./serpapi-shopping";
import { safeUrl } from "./serpapi-shopping";
import type { ShoppingContext } from "./shopping-followup";

export const CONTEXT_TTL_MS = 20 * 60 * 1000;

export interface ShoppingContextStore {
  get(userId: string, phoneHash: string): Promise<ShoppingContext | null>;
  save(userId: string, phoneHash: string, query: string, offers: Offer[], collectedAt: string): Promise<void>;
}

/** Revalida o JSON vindo do banco: contexto inválido é descartado. */
export function parseOffersJson(v: unknown): Offer[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 3) return null;
  const out: Offer[] = [];
  for (const o of v) {
    if (!o || typeof o !== "object") return null;
    const r = o as Record<string, unknown>;
    const url = safeUrl(r.url);
    if (typeof r.title !== "string" || typeof r.store !== "string" || !Number.isSafeInteger(r.priceCents) || (r.priceCents as number) <= 0 || !url) return null;
    out.push({ title: r.title.slice(0, 120), store: r.store.slice(0, 60), priceCents: r.priceCents as number, url });
  }
  return out;
}

export function createDbContextStore(rpc: RpcFn): ShoppingContextStore {
  return {
    async get(userId, phoneHash) {
      const { data, error } = await rpc("whatsapp_shopping_context_get", { p_user_id: userId, p_phone_hash: phoneHash });
      if (error) throw new Error("shopping_context_unavailable");
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      if (!row) return null;
      if (row.expired === true) return { query: String(row.query ?? ""), offers: [], collectedAt: String(row.collected_at ?? ""), expired: true };
      const offers = parseOffersJson(row.offers);
      if (!offers || typeof row.query !== "string" || typeof row.collected_at !== "string") return null;
      return { query: row.query, offers, collectedAt: row.collected_at, expired: false };
    },
    async save(userId, phoneHash, query, offers, collectedAt) {
      const { error } = await rpc("whatsapp_shopping_context_save", {
        p_user_id: userId, p_phone_hash: phoneHash, p_query: query.slice(0, 120),
        p_offers: offers.slice(0, 3).map((o) => ({ title: o.title, store: o.store, priceCents: o.priceCents, url: o.url })),
        p_collected_at: collectedAt,
      });
      if (error) throw new Error("shopping_context_unavailable");
    },
  };
}

export function createMemoryContextStore(now: () => Date = () => new Date()) {
  const m = new Map<string, { query: string; offers: Offer[]; collectedAt: string; savedAt: number }>();
  const store: ShoppingContextStore & { raw: typeof m } = {
    raw: m,
    async get(u, p) {
      const e = m.get(`${u}|${p}`);
      if (!e) return null;
      if (now().getTime() - e.savedAt > CONTEXT_TTL_MS) return { query: e.query, offers: [], collectedAt: e.collectedAt, expired: true };
      return { query: e.query, offers: e.offers, collectedAt: e.collectedAt, expired: false };
    },
    async save(u, p, query, offers, collectedAt) {
      m.set(`${u}|${p}`, { query, offers: offers.slice(0, 3), collectedAt, savedAt: now().getTime() });
    },
  };
  return store;
}
