import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AccountBaselineDisplay = { id: string; bancoId: string; bankName: string; amountCents: number; effectiveDate: string };
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
    if (result.error || !Array.isArray(result.data)) return { status: "unavailable", balances: [] };
    const balances: AccountBaselineDisplay[] = [];
    for (const row of result.data) {
      const bank = banks?.find(b => b.id === row.banco_id);
      const amount = Number(row.amount_cents);
      if (!bank || !Number.isSafeInteger(amount) || amount<0 || typeof row.id !== "string" || typeof row.effective_date !== "string") continue;
      balances.push({id:row.id,bancoId:bank.id,bankName:bank.nome,amountCents:amount,effectiveDate:row.effective_date});
    }
    return { status:"ready", balances };
  });