import { isPluggyAllowed } from "@/lib/pluggy/rules";

/** Exige UUID na allowlist E papel `owner` lido do banco (nunca do cliente). */
export async function assertPluggyAccess(userId: string | null | undefined): Promise<string> {
  if (!userId) throw new Error("unauthorized");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new Error("forbidden");
  const roles = (data ?? []).map((r) => String(r.role));
  if (!isPluggyAllowed(userId, roles)) throw new Error("forbidden");
  return userId;
}

