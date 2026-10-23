import { PLUGGY_CONTINUOUS_AUTHORIZED } from "@/lib/pluggy/continuous-policy";
export async function runContinuousAfterSync(userId: string) {
  if (!PLUGGY_CONTINUOUS_AUTHORIZED) return { blocked: true };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;
  const p = await db
    .from("pluggy_continuous_policies")
    .select("account_id")
    .eq("user_id", userId)
    .eq("enabled", true);
  if (p.error) throw Error("pluggy_politica_indisponivel");
  for (const row of p.data ?? []) {
    const r = await db.rpc("pluggy_continuous_process", {
      p_user_id: userId,
      p_account_id: row.account_id,
      p_preview: false,
    });
    if (r.error) throw Error("pluggy_politica_processamento_falhou");
  }
  return { accounts: p.data?.length ?? 0 };
}
