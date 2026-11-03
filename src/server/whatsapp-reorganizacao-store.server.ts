import type { ReorganizationInput, ReorganizationResult, ReorganizationStore } from "./whatsapp-reorganizacao.server";

/** Candidate adapter: not instantiated by the production pipeline. No direct table writers. */
export interface ReorganizationRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}
export function createReorganizationStore(db: ReorganizationRpcClient): ReorganizationStore {
  const call = async (name: string, args: Record<string, unknown>): Promise<ReorganizationResult> => {
    const result = await db.rpc(name, args);
    if (result.error) throw new Error(result.error.message);
    if (!result.data || typeof result.data !== "object" || !("status" in result.data) || typeof result.data.status !== "string") throw new Error("invalid_reorganization_result");
    if (["preview", "applied", "restored", "partial"].includes(result.data.status)) {
      for (const field of ["expenses", "incomes"]) {
        const value = Reflect.get(result.data, field);
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("invalid_reorganization_counts");
      }
    }
    return result.data as ReorganizationResult;
  };
  const identity = (input: ReorganizationInput) => ({ p_user: input.userId, p_phone: input.phone });
  return {
    async authorize(userId, phone) {
      const result = await db.rpc("wa_reorganization_authorized", { p_user: userId, p_phone: phone });
      return !result.error && result.data === true;
    },
    prepare: (input, scope, income, code) => call("wa_reorganization_prepare", { ...identity(input), p_request: input.externalId, p_scope: scope, p_income: income, p_code: code }),
    confirm: (input, code) => call("wa_reorganization_confirm", { ...identity(input), p_code: code }),
    cancel: (input) => call("wa_reorganization_control", { ...identity(input), p_action: "cancel" }),
    status: (input) => call("wa_reorganization_control", { ...identity(input), p_action: "status" }),
    // No implicit latest-operation reversal; own operation selection + separate confirmation pending.
    restore: async () => ({ status: "blocked" }),
  };
}