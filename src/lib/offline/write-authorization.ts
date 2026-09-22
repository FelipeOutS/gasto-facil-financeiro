import { supabase } from "@/integrations/supabase/client";
/** Ordinary session JWT only. RLS remains the final authority at INSERT time. */
export async function authorizeOfflineWrite(
  ownerId: string,
  actorId: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (!ownerId || !actorId || signal.aborted) return "Sessão indisponível para este lançamento.";
  const { data, error } = await supabase.auth.getUser();
  if (error || data.user?.id !== actorId || signal.aborted)
    return "Entre novamente com o usuário que criou este lançamento.";
  const permission = await supabase
    .rpc("can_create_in_account", { _owner: ownerId })
    .abortSignal(signal);
  if (signal.aborted || permission.error || permission.data !== true)
    return permission.error?.message ?? "Sem permissão para criar nesta conta.";
}

export async function validateOwnerReferences(
  ownerId: string,
  refs: { cartaoId?: string | null; clienteId?: string | null; fornecedorId?: string | null },
  signal: AbortSignal,
): Promise<string | undefined> {
  for (const [table, id] of [
    ["cartoes", refs.cartaoId],
    ["clientes", refs.clienteId],
    ["fornecedores", refs.fornecedorId],
  ] as const) {
    if (!id) continue;
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .eq("id", id)
      .eq("user_id", ownerId)
      .abortSignal(signal);
    if (signal.aborted || error || data?.length !== 1)
      return "Um vínculo do lançamento não pertence à conta de destino ou não está acessível.";
  }
}
