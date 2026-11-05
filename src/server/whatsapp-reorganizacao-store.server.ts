import type { ReorganizationInput, ReorganizationResult, ReorganizationStore } from "./whatsapp-reorganizacao.server";

/** Candidate adapter: not instantiated by the production pipeline. No direct table writers. */
export interface ReorganizationRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}
/** partialScope: linked rows stay out of the batch and are reported (candidate whatsapp-reorganizacao-partial-scope.sql). */
/** fullReset: "zerar tudo" com blocos vinculados (candidate whatsapp-reorganizacao-full-reset.sql); off by default. */
export function createReorganizationStore(db: ReorganizationRpcClient, opts: { partialScope?: boolean; fullReset?: boolean } = {}): ReorganizationStore {
  const v2 = opts.partialScope !== false ? "_v2" : "";
  const call = async (name: string, args: Record<string, unknown>): Promise<ReorganizationResult> => {
    const result = await db.rpc(name, args);
    if (result.error) throw new Error(result.error.message);
    if (!result.data || typeof result.data !== "object" || !("status" in result.data) || typeof result.data.status !== "string") throw new Error("invalid_reorganization_result");
    if (["preview", "applied", "restored", "partial"].includes(result.data.status)) {
      const leftOut = Reflect.get(result.data, "leftOut");
      if (leftOut !== undefined && !Array.isArray(leftOut)) throw new Error("invalid_reorganization_left_out");
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
    prepare: (input, scope, income, code, balance) => opts.fullReset && isFullScope(scope) && !income && !balance
      ? call("wa_full_reset_prepare", { ...identity(input), p_request: input.externalId, p_code: code })
      : call(`wa_reorganization_prepare${v2}`, { ...identity(input), p_request: input.externalId, p_scope: scope, p_income: income, p_code: code, ...(balance ? { p_balance: balance } : {}) }),
    confirm: async (input, code, operationId) => {
      if (opts.fullReset) {
        const r = await call("wa_full_reset_confirm", { ...identity(input), p_code: code, p_operation: operationId ?? null });
        if (r.status !== "not_found") return r;
      }
      return call(`wa_reorganization_confirm${v2}`, { ...identity(input), p_code: code, p_operation: operationId ?? null });
    },
    cancel: (input) => call("wa_reorganization_control", { ...identity(input), p_action: "cancel" }),
    status: (input) => call("wa_reorganization_control", { ...identity(input), p_action: "status" }),
    // No implicit latest-operation reversal; own operation selection + separate confirmation pending.
    restore: async () => ({ status: "blocked" }),
    prepareRestore: async (input, operationId, code) => {
      if (opts.fullReset) {
        const r = await call("wa_full_reset_restore_prepare", { ...identity(input), p_operation: operationId, p_code: code });
        if (r.status !== "not_found") return r;
      }
      return call("wa_reorganization_restore_prepare", { ...identity(input), p_operation: operationId, p_code: code });
    },
    confirmRestore: async (input, operationId, code) => {
      if (opts.fullReset) {
        const r = await call("wa_full_reset_restore_confirm", { ...identity(input), p_operation: operationId || null, p_code: code });
        if (r.status !== "not_found") return r;
        if (!operationId) return { status: "wrong_code" };
      }
      if (!operationId) return { status: "wrong_code" };
      return call("wa_reorganization_control", { ...identity(input), p_action: `restore:${operationId}:${code}` });
    },
    // Voz: resolve o ID do lote aplicado mais recente; a restauração em si
    // continua exigindo prévia + código exclusivo (prepareRestore/confirmRestore).
    // RPC candidata wa_reorganization_last_applied; ausente → null (falha fechada).
    resolveLastApplied: async (input) => {
      if (opts.fullReset) {
        const full = await db.rpc("wa_full_reset_last_applied", identity(input));
        if (!full.error && typeof full.data === "string") return full.data;
      }
      const result = await db.rpc("wa_reorganization_last_applied", identity(input));
      if (result.error || typeof result.data !== "string") return null;
      return result.data;
    },
  };
}
function isFullScope(scope: { tables: string[]; start: string | null; end: string | null }): boolean {
  return scope.start == null && scope.end == null && scope.tables.includes("gastos") && scope.tables.includes("receitas");
}
