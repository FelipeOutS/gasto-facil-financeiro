import { supabase } from "@/integrations/supabase/client";

export type AccessLevel = "view" | "view_create" | "admin";
export type ConnectedAccountStatus = "pending" | "accepted" | "refused" | "removed" | "expired";

export type ConnectedAccount = {
  id: string;
  viewer_user_id: string;
  invited_email: string;
  owner_user_id: string | null;
  nickname: string | null;
  access_level: AccessLevel;
  status: ConnectedAccountStatus;
  invite_token: string;
  invite_sent_at: string;
  invite_expires_at: string;
  accepted_at: string | null;
  refused_at: string | null;
  removed_at: string | null;
};

export const ACCESS_LEVEL_INFO: Record<AccessLevel, { title: string; description: string }> = {
  view: {
    title: "Somente visualizar",
    description:
      "Permite acompanhar dashboard, gastos, metas, guardado, cartões e relatórios, sem alterar dados.",
  },
  view_create: {
    title: "Visualizar e lançar",
    description: "Permite visualizar e também adicionar novos registros financeiros.",
  },
  admin: {
    title: "Administrador da conta",
    description:
      "Permite acesso mais completo à conta conectada. Recomendado para empresas e sócios.",
  },
};

export const STATUS_LABEL: Record<ConnectedAccountStatus, string> = {
  pending: "Convite pendente",
  accepted: "Ativa",
  refused: "Recusado",
  removed: "Removido",
  expired: "Expirado",
};

export function buildInviteUrl(token: string): string {
  if (typeof window === "undefined") return `/aceitar-convite/${token}`;
  return `${window.location.origin}/aceitar-convite/${token}`;
}

/* ============================== Queries ============================== */

/** Convites/conexões enviadas pelo usuário (contas que ELE acompanha). */
export async function listOutgoingConnections(viewerUserId: string) {
  const { data, error } = await supabase
    .from("connected_accounts")
    .select("*")
    .eq("viewer_user_id", viewerUserId)
    .neq("status", "removed")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ConnectedAccount[];
}

/** Pessoas que receberam acesso à conta do usuário (ele é o "owner"). */
export async function listIncomingConnections(ownerUserId: string, _ownerEmail: string) {
  // Owned rows (already-accepted invites where this user is the owner) are
  // visible directly via RLS.
  const ownedPromise = supabase
    .from("connected_accounts")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .neq("status", "removed")
    .order("created_at", { ascending: false });

  // Pending invitations addressed to this user's email — fetched via
  // SECURITY DEFINER RPC that intentionally omits the secret invite_token.
  const invitesPromise = supabase.rpc("list_my_pending_invites");

  const [owned, invites] = await Promise.all([ownedPromise, invitesPromise]);
  if (owned.error) throw owned.error;
  if (invites.error) throw invites.error;

  const seen = new Set<string>();
  const rows: ConnectedAccount[] = [];
  for (const r of [
    ...((owned.data ?? []) as ConnectedAccount[]),
    ...((invites.data ?? []) as Omit<ConnectedAccount, "invite_token">[]),
  ]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    rows.push({
      ...(r as ConnectedAccount),
      invite_token: (r as ConnectedAccount).invite_token ?? "",
    });
  }
  return rows;
}

/* ============================== Mutations ============================== */

export async function createInvite(params: {
  viewerUserId: string;
  invitedEmail: string;
  nickname: string | null;
  accessLevel: AccessLevel;
}) {
  const email = params.invitedEmail.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Informe um e-mail válido.");
  }
  const { data, error } = await supabase
    .from("connected_accounts")
    .insert({
      viewer_user_id: params.viewerUserId,
      invited_email: email,
      nickname: params.nickname?.trim() || null,
      access_level: params.accessLevel,
      status: "pending",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ConnectedAccount;
}

export async function updateAccessLevel(
  id: string,
  accessLevel: AccessLevel,
  nickname?: string | null,
) {
  const patch: { access_level: AccessLevel; nickname?: string | null } = {
    access_level: accessLevel,
  };
  if (typeof nickname !== "undefined") patch.nickname = nickname?.trim() || null;
  const { error } = await supabase.from("connected_accounts").update(patch).eq("id", id);
  if (error) throw error;
}

export async function removeConnection(id: string, byUserId: string) {
  const { error } = await supabase
    .from("connected_accounts")
    .update({
      status: "removed",
      removed_at: new Date().toISOString(),
      removed_by_user_id: byUserId,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function acceptInviteByToken(token: string, ownerUserId: string) {
  const { data, error } = await supabase
    .from("connected_accounts")
    .update({
      status: "accepted",
      accepted_at: new Date().toISOString(),
      owner_user_id: ownerUserId,
    })
    .eq("invite_token", token)
    .eq("status", "pending")
    .select("*")
    .single();
  if (error) throw error;
  return data as ConnectedAccount;
}

export async function refuseInviteByToken(token: string) {
  const { error } = await supabase
    .from("connected_accounts")
    .update({ status: "refused", refused_at: new Date().toISOString() })
    .eq("invite_token", token)
    .eq("status", "pending");
  if (error) throw error;
}

export async function fetchInviteByToken(token: string) {
  // SECURITY DEFINER RPC — returns invite details for any caller (the URL token
  // is the bearer secret) but intentionally does NOT return invite_token itself.
  const { data, error } = await supabase.rpc("fetch_invite_by_token", { _token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return { ...(row as ConnectedAccount), invite_token: "" } as ConnectedAccount;
}
