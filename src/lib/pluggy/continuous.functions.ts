import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PLUGGY_CONTINUOUS_AUTHORIZED, CONTINUOUS_KINDS } from "./continuous-policy";
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }),
  z.object({ action: z.literal("undo"), batchId: z.string().uuid(), confirmed: z.literal(true) }),
  z.object({ action: z.literal("preview"), accountId: z.string().min(1).max(200) }),
  z.object({
    action: z.literal("set"),
    accountId: z.string().min(1).max(200),
    enabled: z.boolean(),
    confirmed: z.literal(true),
    kinds: z.array(z.enum(CONTINUOUS_KINDS)).min(1).max(4),
    categoryId: z.string().uuid().nullable(),
    maxTransaction: z.number().positive().max(5000),
    maxDailyAmount: z.number().positive().max(20000),
    maxDailyCount: z.number().int().min(1).max(100),
  }),
]);
export type ContinuousPolicy = {
  account_id: string;
  enabled: boolean;
  kinds: string[];
  categoria_id: string | null;
  max_transaction: number;
  max_daily_amount: number;
  max_daily_count: number;
  revision: number;
  expires_at: string;
};
export type ContinuousItem = {
  transaction_id: string;
  amount: number;
  date: string;
  kind: string | null;
  reason: string;
  batch_id: string | null;
};
export type ContinuousState = {
  released: boolean;
  schemaReady: boolean;
  policies: ContinuousPolicy[];
  accounts: { account_id: string; name: string; type: string }[];
  categories: { id: string; nome: string }[];
  history: {
    transaction_id: string;
    amount: number;
    outcome: string;
    reason: string;
    batch_id: string | null;
    processed_at: string;
  }[];
  preview?: ContinuousItem[];
};
export const pluggyContinuous = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: z.input<typeof Input>) => Input.parse(v))
  .handler(async ({ data, context }): Promise<ContinuousState> => {
    const { canUseRealPreview } = await import("./real-preview");
    const roles = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (
      roles.error ||
      !canUseRealPreview(
        context.userId,
        (roles.data ?? []).map((x) => x.role),
      )
    )
      throw Error("pluggy_nao_autorizado");
    // Untyped only for candidate tables not yet present in generated schema.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    const base: ContinuousState = {
      released: PLUGGY_CONTINUOUS_AUTHORIZED,
      schemaReady: false,
      policies: [],
      accounts: [],
      categories: [],
      history: [],
    };
    const policies = await db
      .from("pluggy_continuous_policies")
      .select("*")
      .eq("user_id", context.userId)
      .order("account_id");
    if (policies.error) {
      if (policies.error.code === "42P01" || policies.error.code === "PGRST205") return base;
      throw Error("pluggy_leitura_indisponivel");
    }
    const items = await db
      .from("pluggy_items")
      .select("item_id")
      .eq("user_id", context.userId)
      .eq("connector_id", 606)
      .eq("is_sandbox", false)
      .is("deleted_at", null);
    if (items.error) throw Error("pluggy_leitura_indisponivel");
    const accounts = items.data.length
      ? await db
          .from("pluggy_accounts")
          .select("account_id,name,type")
          .eq("user_id", context.userId)
          .eq("is_sandbox", false)
          .in(
            "item_id",
            items.data.map((x: { item_id: string }) => x.item_id),
          )
      : { data: [], error: null };
    const categories = await db
      .from("categorias")
      .select("id,nome")
      .eq("user_id", context.userId)
      .order("nome");
    const history = await db
      .from("pluggy_continuous_audit")
      .select("transaction_id,amount,outcome,reason,batch_id,processed_at")
      .eq("user_id", context.userId)
      .order("processed_at", { ascending: false })
      .limit(100);
    if (accounts.error || categories.error || history.error)
      throw Error("pluggy_leitura_indisponivel");
    const state = {
      ...base,
      schemaReady: true,
      policies: policies.data,
      accounts: accounts.data,
      categories: categories.data,
      history: history.data,
    } as ContinuousState;
    if (data.action === "status") return state;
    if (data.action === "undo") {
      const recorded = await db
        .from("pluggy_continuous_audit")
        .select("batch_id")
        .eq("user_id", context.userId)
        .eq("batch_id", data.batchId)
        .eq("outcome", "imported")
        .single();
      if (recorded.error || !recorded.data) throw Error("pluggy_lote_inexistente");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reverted = await (supabaseAdmin as any).rpc("pluggy_import_revert_real_batch", {
        p_user_id: context.userId,
        p_batch_id: data.batchId,
      });
      if (reverted.error) throw Error("pluggy_reversao_indisponivel");
      return state;
    }
    // Disabling a previously saved policy remains possible after disconnect/release withdrawal.
    if (data.action === "set" && data.enabled && !PLUGGY_CONTINUOUS_AUTHORIZED)
      throw Error("pluggy_politica_bloqueada");
    if (
      !state.accounts.some((a) => a.account_id === data.accountId) &&
      !(
        data.action === "set" &&
        !data.enabled &&
        state.policies.some((p) => p.account_id === data.accountId)
      )
    )
      throw Error("pluggy_conta_invalida");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;
    if (data.action === "preview") {
      const r = await admin.rpc("pluggy_continuous_process", {
        p_user_id: context.userId,
        p_account_id: data.accountId,
        p_preview: true,
      });
      if (r.error) throw Error("pluggy_previa_indisponivel");
      return { ...state, preview: r.data?.items ?? [] };
    }
    const r = await admin.rpc("pluggy_continuous_set", {
      p_user_id: context.userId,
      p_account_id: data.accountId,
      p_enabled: data.enabled,
      p_kinds: data.kinds,
      p_categoria_id: data.categoryId,
      p_max_transaction: data.maxTransaction,
      p_max_daily_amount: data.maxDailyAmount,
      p_max_daily_count: data.maxDailyCount,
      p_confirmed: data.confirmed,
    });
    if (r.error) throw Error("pluggy_politica_nao_confirmada");
    return {
      ...state,
      policies: [...state.policies.filter((p) => p.account_id !== data.accountId), r.data],
    };
  });
