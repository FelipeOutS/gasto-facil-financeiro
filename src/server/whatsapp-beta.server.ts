/**
 * Gate único de elegibilidade do WhatsApp.
 *
 * Regra:
 *   - Admin Master sempre pode.
 *   - Demais usuários só podem se possuem registro ativo em
 *     `whatsapp_beta_access` (não revogado, não expirado).
 *
 * Esta função é a única fonte de verdade para "esse usuário pode usar
 * o WhatsApp?". Deve ser usada em:
 *   - acesso à página /whatsapp (server fns: list/upsert/confirm/etc.);
 *   - webhook (após resolver o user pelo telefone);
 *   - reprocessamento e operações administrativas.
 *
 * NÃO retorna detalhes do plano nem motivos sensíveis ao caller —
 * apenas `true | false`. O caller decide a mensagem amigável.
 */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = _supabaseAdmin as any;

export type WhatsAppBetaStatus =
  | "admin"
  | "ativo"
  | "expirado"
  | "revogado"
  | "sem_acesso";

export async function canUseWhatsApp(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data, error } = await sb.rpc("can_use_whatsapp", { _user_id: userId });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

/**
 * Status detalhado seguro (sem PII) para o painel admin e para o próprio
 * usuário. Não retorna telefone, e-mail, IDs internos sensíveis.
 */
export async function getWhatsAppBetaStatus(
  userId: string | null | undefined,
): Promise<WhatsAppBetaStatus> {
  if (!userId) return "sem_acesso";
  try {
    // Admin Master tem acesso integral.
    const { data: adminCheck } = await sb.rpc("is_full_access", { _user_id: userId });
    if (adminCheck === true) return "admin";
  } catch {
    // ignora — segue avaliação normal
  }
  try {
    const { data } = await sb
      .from("whatsapp_beta_access")
      .select("ativo, revoked_at, expires_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return "sem_acesso";
    if (data.revoked_at) return "revogado";
    if (!data.ativo) return "revogado";
    if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
      return "expirado";
    }
    return "ativo";
  } catch {
    return "sem_acesso";
  }
}
