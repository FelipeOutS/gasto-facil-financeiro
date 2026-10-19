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

/** Webhook só para homologação (URL estável de preview), nunca produção na Fase 2. */
export function pluggyWebhookUrl(): string | null {
  const token = process.env.PLUGGY_WEBHOOK_TOKEN;
  if (!token) return null;
  return `https://project--5de62d63-2340-4175-8a16-26c2beff1e71-dev.lovable.app/api/public/pluggy/webhook?t=${encodeURIComponent(token)}`;
}
