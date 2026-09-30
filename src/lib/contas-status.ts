/**
 * Regras puras de status de `contas_a_pagar` compartilhadas pelo site.
 *
 * O banco aceita `status = 'cancelado'` (usado pelo WhatsApp ao cancelar
 * ocorrências). O tipo de UI `StatusConta` só conhece pendente/pago/atrasado,
 * então uma linha cancelada nunca pode entrar nas listas ativas — senão
 * `statusContaEfetivo` a trataria como pendente. Os registros NÃO são
 * apagados do banco; apenas ficam fora das listas/totais ativos.
 */
export function isStatusContaCancelado(status: unknown): boolean {
  const s = String(status ?? "")
    .trim()
    .toLowerCase();
  return s === "cancelado" || s === "cancelada" || s === "cancelled" || s === "canceled";
}

export function filtrarContasAtivas<T extends { status?: unknown }>(rows: T[]): T[] {
  return rows.filter((r) => !isStatusContaCancelado(r.status));
}
