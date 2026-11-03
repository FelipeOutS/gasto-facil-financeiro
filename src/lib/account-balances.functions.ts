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
    const balances: AccountBaselineDisplay[] = [];
    for (const row of Array.isArray(result.data)?result.data:[]) {
      const bank = banks?.find(b => b.id === row.banco_id);
      const amount = Number(row.amount_cents);
      if (!bank || !Number.isSafeInteger(amount) || amount<0 || typeof row.id !== "string" || typeof row.effective_date !== "string") continue;
      balances.push({id:row.id,bancoId:bank.id,bankName:bank.nome,amountCents:amount,effectiveDate:row.effective_date});
    }
    const factsClient = supabase as unknown as {from(name:string):{select(columns:string):{eq(column:string,value:string):PromiseLike<{data:unknown;error:unknown}>}}};
    // An unbounded PostgREST SELECT silently truncates at the server limit. Read all pages.
    const ledger = supabase as unknown as { from(name: string): {select(columns: string): {eq(column: string,value: string): {order(column: string): {range(start: number,end: number): PromiseLike<{data: unknown;error: unknown}>}}}}};
    const raw: unknown[] = [];
    for (let offset = 0; offset < 100000; offset += 500) {
      const page = await ledger.from("financial_cash_facts").select("id,user_id,banco_id,kind,amount_cents,effective_at").eq("user_id",userId).order("id").range(offset,offset+499);
      if (page.error || !Array.isArray(page.data)) return {status:"unavailable",balances:[]};
      raw.push(...page.data);
      if (page.data.length < 500) {
        try { return {status:"ready",balances:accountBalanceDisplay(userId,banks ?? [],raw,new Date().toISOString())}; }
        catch { return {status:"unavailable",balances:[]}; }
      }
    }
    // Missing/incomplete facts must not fall back to an apparently current baseline.
    return {status:"unavailable",balances:[]};
  });