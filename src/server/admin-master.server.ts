import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * src/server/admin-master.server.ts
 *
 * Sistema de autorização de Admin Master baseado em ROLES PERSISTIDAS no banco.
 *
 * Política (WA-SEC-ADMIN-01):
 *  - A fonte primária de verdade é a tabela `public.user_roles` (role 'owner').
 *  - O Admin Master DEVE possuir a role 'owner' para ações críticas.
 *  - O e-mail (env ADMIN_MASTER_EMAILS) NÃO é mais a fonte decisiva de autorização.
 *  - Mantemos isAdminMasterEmail apenas para diagnóstico e logs complementares.

 */

/**
 * Verifica se um usuário possui a role de 'owner' no banco de dados.
 * Esta é a verificação decisiva para autorização administrativa.
 */
export async function hasAdminMasterRole(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;

  try {
    const { data, error } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "owner")
      .maybeSingle();

    if (error) {
      console.error("[hasAdminMasterRole] erro ao verificar role:", error);
      return false;
    }

    return !!data;
  } catch (err) {
    console.error("[hasAdminMasterRole] exceção ao verificar role:", err);
    return false;
  }
}

/**
 * Legado/Defesa em profundidade: verifica por e-mail via ENV.
 * Deve ser usado apenas como verificação secundária ou em logs.
 */
export function isAdminMasterEmail(email?: string | null): boolean {
  if (!email) return false;
  const envEmails = (process.env.ADMIN_MASTER_EMAILS ?? "").split(",").map(e => e.trim().toLowerCase());
  return envEmails.includes(email.trim().toLowerCase());
}

/**
 * Helper unificado para autorização server-side.
 */
export async function assertAdminMaster(user: { id: string; email?: string | null } | null | undefined): Promise<void> {
  if (!user) throw new Error("Unauthorized: No session");
  
  const hasRole = await hasAdminMasterRole(user.id);
  if (!hasRole) {
    // Log de tentativa de acesso negado
    console.warn(`[AUTH_DENIED] Tentativa de acesso admin negada para user=${user.id}`);
    throw new Error("Forbidden: Admin Master role required");
  }
}
