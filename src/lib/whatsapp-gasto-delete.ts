/**
 * Exclusão física de gasto ligado a mensagem do WhatsApp (site), protegida
 * contra gastos já excluídos de forma reversível (deleted_at preenchido).
 * Nunca apaga linha marcada; erro de leitura falha fechado.
 */
export const MSG_GASTO_EXCLUIDO_REVERSIVEL =
  "Esse gasto está excluído e pode ser restaurado. Não é possível desfazer antes da restauração.";
export const MSG_GASTO_LEITURA_FALHOU =
  "Não consegui conferir esse gasto agora. Nada foi alterado. Tente novamente.";
export const MSG_GASTO_MUDOU = "Esse gasto mudou enquanto excluíamos. Nada foi alterado. Atualize a página.";

export class GastoExcluidoReversivelError extends Error {}

export type DeleteGastoResult = "deleted" | "not_found";

/**
 * Apaga um gasto ativo do usuário. Lança erro em pt-BR se ele estiver
 * soft-excluído, se a leitura falhar ou se o estado mudar no meio.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function deleteGastoAtivo(sb: any, userId: string, gastoId: string): Promise<DeleteGastoResult> {
  // soft-delete-exceção: lê sem filtro para recusar gasto marcado.
  const { data: g, error } = await sb
    .from("gastos")
    .select("id, deleted_at")
    .eq("id", gastoId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(MSG_GASTO_LEITURA_FALHOU);
  if (!g) return "not_found";
  if (g.deleted_at != null) throw new GastoExcluidoReversivelError(MSG_GASTO_EXCLUIDO_REVERSIVEL);
  const { data: del, error: delErr } = await sb
    .from("gastos")
    .delete()
    .eq("id", gastoId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("id");
  if (delErr) throw new Error(delErr.message);
  if (!Array.isArray(del) || del.length !== 1) throw new Error(MSG_GASTO_MUDOU);
  return "deleted";
}
