/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Núcleo do vínculo conta a pagar ↔ gasto e do estorno de pagamento.
 * Recebe o cliente Supabase do chamador (RLS como o usuário) para ser
 * testável sem rede. Usado por `contas.functions.ts`.
 *
 * Exclusão reversível (F2/F3): um gasto vinculado com `deleted_at`
 * preenchido NUNCA é apagado nem recriado pelo estorno; o ato inteiro é
 * bloqueado. Depende da coluna `gastos.deleted_at` (F2) — sem ela a leitura
 * falha e o estorno falha fechado (não há fallback).
 */

export const CONTA_GASTO_ORIGEM = "contas_a_pagar";

export const MSG_ESTORNO_GASTO_EXCLUIDO =
  "Este pagamento tem um gasto vinculado excluído. Restaure o gasto antes de estornar ou solicite desvinculação sem apagar.";
export const MSG_PAGAR_GASTO_EXCLUIDO =
  "Este pagamento tem um gasto vinculado excluído. Restaure o gasto antes de pagar novamente.";
export const MSG_ESTORNO_CONCORRENTE =
  "O gasto vinculado mudou durante o estorno. Nada foi alterado na conta; confira os gastos e tente novamente.";

export class ContaGastoExcluidoError extends Error {
  readonly code = "gasto_vinculado_excluido";
}

export function opId(contaId: string) {
  return `conta_a_pagar:${contaId}`;
}

export function normalizedText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function daysBetween(a: string, b: string) {
  const ta = new Date(`${a}T00:00:00`).getTime();
  const tb = new Date(`${b}T00:00:00`).getTime();
  return Math.abs(Math.round((ta - tb) / 86_400_000));
}

export async function findLinkedGastos(
  sb: any,
  userId: string,
  conta: any,
  nome: string,
  valor: number,
  dataPagamento: string,
) {
  const directIds = [conta.gasto_id].filter(Boolean);
  // soft-delete-exceção: vínculo conta↔gasto precisa ver excluídos (filtrar criaria duplicata após restaurar; estorno bloqueia).
  const { data, error } = await sb
    .from("gastos")
    .select("id, descricao, estabelecimento, valor, data, origem, id_operacao_banco, deleted_at")
    .eq("user_id", userId)
    .or(`id_operacao_banco.eq.${opId(conta.id)},origem.eq.${CONTA_GASTO_ORIGEM}`);
  if (error) throw new Error(error.message);

  const targetName = normalizedText(nome);
  return ((data ?? []) as any[]).filter((g) => {
    if (directIds.includes(g.id)) return true;
    if (g.id_operacao_banco === opId(conta.id)) return true;
    if (g.origem !== CONTA_GASTO_ORIGEM) return false;
    if (Math.abs(Number(g.valor ?? 0) - valor) > 0.01) return false;
    if (normalizedText(g.descricao || g.estabelecimento) !== targetName) return false;
    return (
      daysBetween(g.data, dataPagamento) <= 3 || daysBetween(g.data, conta.data_vencimento) <= 3
    );
  });
}

/**
 * Detecta gasto vinculado soft-excluído: entre os candidatos encontrados OU
 * pelo `gasto_id` direto da conta (que pode ter origem diferente, ex. WhatsApp).
 * Erro de leitura NUNCA vira "sem vínculo": lança.
 */
export async function hasDeletedLinkedGasto(
  sb: any,
  userId: string,
  conta: any,
  linked: Array<{ id: string; deleted_at?: string | null }>,
): Promise<boolean> {
  if (linked.some((g) => g.deleted_at != null)) return true;
  if (!conta.gasto_id || linked.some((g) => g.id === conta.gasto_id)) return false;
  // soft-delete-exceção: checagem do gasto_id direto precisa ver excluídos.
  const { data, error } = await sb
    .from("gastos")
    .select("id, deleted_at")
    .eq("id", conta.gasto_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data && data.deleted_at != null;
}

/** Estorno do pagamento (ex-handler de `unmarkContaAPagarPaid`). */
export async function estornarPagamentoConta(
  sb: any,
  userId: string,
  input: { id: string; removerGastoVinculado?: boolean },
): Promise<{ ok: true }> {
  const { data: conta, error: contaErr } = await sb
    .from("contas_a_pagar")
    .select("*")
    .eq("id", input.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (contaErr) throw new Error(contaErr.message);
  if (!conta) throw new Error("Conta não encontrada.");

  const linked = await findLinkedGastos(
    sb,
    userId,
    conta,
    conta.nome,
    Number(conta.valor),
    conta.data_pagamento ?? conta.data_vencimento,
  );
  // Bloqueio integral (com ou sem remoção do gasto): nada é apagado,
  // a conta não muda, gasto_id/data_pagamento preservados.
  if (await hasDeletedLinkedGasto(sb, userId, conta, linked)) {
    throw new ContaGastoExcluidoError(MSG_ESTORNO_GASTO_EXCLUIDO);
  }

  if (input.removerGastoVinculado ?? true) {
    const ids = linked.map((g) => g.id);
    if (ids.length > 0) {
      // Condição atômica por linha: nunca apaga linha já soft-excluída,
      // mesmo se marcada entre a leitura e o DELETE.
      const { data: removed, error } = await sb
        .from("gastos")
        .delete()
        .eq("user_id", userId)
        .in("id", ids)
        .is("deleted_at", null)
        .select("id");
      if (error) throw new Error(error.message);
      if (!Array.isArray(removed) || removed.length !== ids.length) {
        // Corrida: parte pode ter sido apagada (ativa) e parte preservada
        // (excluída). Sem RPC transacional não há como desfazer — pendência F4.
        throw new ContaGastoExcluidoError(MSG_ESTORNO_CONCORRENTE);
      }
    }
  }

  const now = new Date().toISOString();
  const { error } = await sb
    .from("contas_a_pagar")
    .update({ status: "pendente", data_pagamento: null, gasto_id: null, updated_at: now })
    .eq("id", conta.id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}
