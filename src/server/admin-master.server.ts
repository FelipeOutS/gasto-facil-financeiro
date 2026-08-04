import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin = _supabaseAdmin as any;

/**
 * src/server/admin-master.server.ts
 *
 * Sistema de autorização de Admin Master baseado em ROLES PERSISTIDAS no banco.
 */

// Cache privado para testes (WA-B4)
let _cachedEmails: string[] | null = null;

function getParsedEmails(): string[] {
  if (_cachedEmails) return _cachedEmails;
  const raw = process.env.ADMIN_MASTER_EMAILS ?? "";
  if (!raw.trim()) {
    _cachedEmails = [];
    console.warn("[admin_master_config_missing] Nenhuma env ADMIN_MASTER_EMAILS configurada ou válida.");
    return [];
  }
  _cachedEmails = Array.from(new Set(
    raw.split(",")
      .map(e => e.trim().toLowerCase())
      .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
  ));
  if (_cachedEmails.length === 0) {
    console.warn("[admin_master_config_missing] Nenhuma env ADMIN_MASTER_EMAILS configurada ou válida.");
  }
  return _cachedEmails;
}

export function getAdminMasterEmails(): string[] {
  return getParsedEmails();
}

export function isAdminMasterConfigured(): boolean {
  return getParsedEmails().length > 0;
}

export function getAdminMasterSource(): "env" | "none" {
  return isAdminMasterConfigured() ? "env" : "none";
}

export async function hasAdminMasterRole(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
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

export function isAdminMasterEmail(email?: string | null): boolean {
  if (!email) return false;
  return getParsedEmails().includes(email.trim().toLowerCase());
}

export async function assertAdminMaster(user: { id: string; email?: string | null } | null | undefined): Promise<void> {
  if (!user) throw new Error("Unauthorized: No session");
  const hasRole = await hasAdminMasterRole(user.id);
  if (!hasRole) {
    console.warn(`[AUTH_DENIED] Tentativa de acesso admin negada para user=${user.id}`);
    throw new Error("Forbidden: Admin Master role required");
  }
}

export function __resetAdminMasterCacheForTests() {
  _cachedEmails = null;
}
