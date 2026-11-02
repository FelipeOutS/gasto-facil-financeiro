/**
 * Cota PERSISTENTE do Assistente de Compras via RPCs do SQL candidato
 * docs/migrations-candidate/whatsapp-shopping-quota.sql (AINDA NÃO APLICADO).
 * Mês, limites e máximo de tentativas são decididos no banco, não aqui.
 * Erro de RPC lança exceção → orquestrador falha fechado SEM chamar a SerpApi.
 */
import type { ReserveResult, ShoppingQuotaStore } from "./shopping-quota";

export type RpcFn = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

function firstRow(data: unknown): Record<string, unknown> | null {
  const r = Array.isArray(data) ? data[0] : data;
  return r && typeof r === "object" ? (r as Record<string, unknown>) : null;
}

export function createDbQuotaStore(rpc: RpcFn): ShoppingQuotaStore {
  return {
    async reserve(userId, externalId): Promise<ReserveResult> {
      const { data, error } = await rpc("whatsapp_shopping_reserve", { p_user_id: userId, p_external_id: externalId });
      const row = firstRow(data);
      if (error || !row) throw new Error("shopping_quota_unavailable");
      switch (row.claim_state) {
        case "reserved": return { state: "reserved" };
        case "duplicate": return { state: "duplicate", previousReply: typeof row.previous_reply === "string" ? row.previous_reply : null };
        case "user_quota": return { state: "user_quota" };
        case "global_quota": return { state: "global_quota" };
        default: throw new Error("shopping_quota_unavailable");
      }
    },
    async finish(userId, externalId, _month, apiCalls, reply) {
      const calls = Math.min(Math.max(Math.trunc(apiCalls), 0), 2);
      const { data, error } = await rpc("whatsapp_shopping_finish", {
        p_user_id: userId, p_external_id: externalId, p_api_calls: calls, p_reply: reply.slice(0, 3500),
      });
      const row = firstRow(data);
      if (error || !row) throw new Error("shopping_quota_unavailable");
      return { userRemaining: Number(row.user_remaining ?? 0) };
    },
    async userRemaining() {
      throw new Error("not_supported");
    },
  };
}
