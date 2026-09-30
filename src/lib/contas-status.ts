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

export type AbaContas =
  | "todas"
  | "pendentes"
  | "proximas"
  | "atrasadas"
  | "pagas"
  | "recorrentes"
  | "canceladas";

/**
 * Monta a lista da aba. `ativas` NUNCA contém canceladas (já filtradas no
 * carregamento), então totais/pendentes/próximas seguem sem elas.
 * Canceladas entram só em "canceladas" e "todas" (identificadas no card).
 */
export function listaDaAba<T>(
  aba: AbaContas,
  ativas: T[],
  canceladas: T[],
  passaFiltroAtivo: (c: T) => boolean,
): T[] {
  if (aba === "canceladas") return canceladas;
  const base = ativas.filter(passaFiltroAtivo);
  return aba === "todas" ? [...base, ...canceladas] : base;
}

/** Conta cancelada é só histórico: nenhuma ação (pagar/editar/desfazer). */
export function acoesDisponiveisConta(c: { cancelada?: boolean }, pago: boolean): string[] {
  if (c.cancelada) return [];
  return [pago ? "desmarcar" : "pagar", "editar", "excluir"];
}
