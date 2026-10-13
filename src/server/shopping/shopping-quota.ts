/**
 * Cota do Assistente de Compras: 10 buscas/usuário/mês e 200 chamadas globais/mês
 * à API. Conta CHAMADAS REAIS (apiCalls), não mensagens. Reserva antes da API;
 * libera se a API não foi chamada; idempotente por externalId.
 *
 * ATENÇÃO: a RPC existente `whatsapp_claim_research` conta LINHAS (mensagens,
 * inclusive falhas e follow-ups) e não chamadas — não serve para esta regra.
 * A implementação persistente exige migration futura (com aprovação). Aqui há
 * a interface + implementação EM MEMÓRIA, só para testes/desenvolvimento.
 */
export const USER_MONTHLY_LIMIT = 10;
export const GLOBAL_MONTHLY_LIMIT = 200;
export const MAX_CALLS_PER_SEARCH = 2;

export type ReserveResult =
  | { state: "reserved" }
  | { state: "duplicate"; previousReply: string | null }
  | { state: "user_quota" }
  | { state: "global_quota" };

export interface ShoppingQuotaStore {
  reserve(userId: string, externalId: string, month: string): Promise<ReserveResult>;
  /** apiCalls = 0 libera a reserva (não desconta). */
  finish(userId: string, externalId: string, month: string, apiCalls: number, reply: string): Promise<{ userRemaining: number }>;
  userRemaining(userId: string, month: string): Promise<number>;
}

export function monthKeySaoPaulo(d: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(d);
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}`;
}

type Entry = { userId: string; month: string; state: "pending" | "done"; apiCalls: number; reply: string | null };

export function createMemoryQuotaStore(): ShoppingQuotaStore & { entries: Map<string, Entry> } {
  const entries = new Map<string, Entry>();
  const userUsed = (u: string, m: string) =>
    [...entries.values()].filter((e) => e.userId === u && e.month === m && (e.state === "pending" || e.apiCalls > 0)).length;
  const globalUsed = (m: string) =>
    [...entries.values()].filter((e) => e.month === m).reduce((s, e) => s + (e.state === "pending" ? MAX_CALLS_PER_SEARCH : e.apiCalls), 0);
  return {
    entries,
    async reserve(userId, externalId, month) {
      const k = `${userId}|${externalId}`;
      const ex = entries.get(k);
      if (ex) return { state: "duplicate", previousReply: ex.reply };
      if (globalUsed(month) + MAX_CALLS_PER_SEARCH > GLOBAL_MONTHLY_LIMIT) return { state: "global_quota" };
      if (userUsed(userId, month) >= USER_MONTHLY_LIMIT) return { state: "user_quota" };
      entries.set(k, { userId, month, state: "pending", apiCalls: 0, reply: null });
      return { state: "reserved" };
    },
    async finish(userId, externalId, month, apiCalls, reply) {
      const e = entries.get(`${userId}|${externalId}`);
      if (e && e.state === "pending") { e.state = "done"; e.apiCalls = Math.max(0, apiCalls); e.reply = reply; }
      return { userRemaining: Math.max(0, USER_MONTHLY_LIMIT - userUsed(userId, month)) };
    },
    async userRemaining(userId, month) {
      return Math.max(0, USER_MONTHLY_LIMIT - userUsed(userId, month));
    },
  };
}
