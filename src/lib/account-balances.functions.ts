import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { accountBalanceDisplay } from "./account-balance-display";
export type { AccountBaselineDisplay } from "./account-balance-display";
import type { AccountBaselineDisplay } from "./account-balance-display";

/** Own balances only; missing candidate schema is not presented as a zero balance. */
export const readAccountBaselines = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ status: "ready" | "unavailable"; balances: AccountBaselineDisplay[] }> => {
    const { supabase, userId } = context;
    const { data: banks, error: bankError } = await supabase.from("bancos").select("id,nome").eq("user_id",userId);
    if (bankError) return { status: "unavailable", balances: [] };
    // Candidate schema has deliberately not been applied; do not modify generated types.
    const db = supabase as unknown as { from(name: string): { select(columns: string): { eq(column: string,value: string): { is(column: string,value: null): PromiseLike<{ data: unknown; error: unknown }> } } } };
    const result = await db.from("account_opening_balances").select("id,banco_id,amount_cents,effective_date").eq("user_id",userId).is("revoked_at",null);
    if(result.error || !Array.isArray(result.data)) return {status:"unavailable",balances:[]};
    // An unbounded PostgREST SELECT silently truncates at the server limit. Read all pages.
    const ledger = supabase as unknown as { from(name: string): {select(columns: string): {eq(column: string,value: string): {order(column: string): {range(start: number,end: number): PromiseLike<{data: unknown;error: unknown}>}}}}};
    const raw: unknown[] = [];
    for (let offset = 0; offset < 100000; offset += 500) {
      const page = await ledger.from("financial_cash_facts").select("id,user_id,banco_id,kind,amount_cents,effective_at,source_id").eq("user_id",userId).order("id").range(offset,offset+499);
      if (page.error || !Array.isArray(page.data)) return {status:"unavailable",balances:[]};
      raw.push(...page.data);
      if (page.data.length < 500) {
        // Baselines not represented by an opening fact are not a complete ledger.
        if(result.data.some(b=>!raw.some(f=>f && typeof f==="object" && Reflect.get(f,"source_id")===b.id && Reflect.get(f,"kind")==="opening"))) return {status:"unavailable",balances:[]};
        try { return {status:"ready",balances:accountBalanceDisplay(userId,banks ?? [],raw,new Date().toISOString())}; }
        catch { return {status:"unavailable",balances:[]}; }
      }
    }
    // Missing/incomplete facts must not fall back to an apparently current baseline.
    return {status:"unavailable",balances:[]};
  });