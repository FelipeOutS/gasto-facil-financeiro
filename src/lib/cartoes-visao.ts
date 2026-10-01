/**
 * Visão da página Cartões: "geral" (agregado de todos os cartões) ou um
 * cartão específico. Funções puras — apenas FILTRAM/AGREGAM resumos já
 * calculados pela store; não recalculam fatura, competência, fechamento
 * nem vencimento. Logo/identidade visual nunca participa daqui.
 */
import type { Cartao, Gasto } from "@/lib/types";

export const VISAO_GERAL = "geral" as const;
export type VisaoCartoes = typeof VISAO_GERAL | string;

export type ResumoCartao = { usadoMes: number; limite: number; disponivel: number; pct: number };
export type FaturaCorrenteInfo = { status: string; pendente: number };

/** 1 cartão → seleciona ele; 0 ou 2+ → Visão geral. */
export function visaoInicial(cartoes: Pick<Cartao, "id">[]): VisaoCartoes {
  return cartoes.length === 1 ? cartoes[0].id : VISAO_GERAL;
}

/** Garante que a visão continua válida (ex.: cartão removido). */
export function normalizarVisao(visao: VisaoCartoes, cartoes: Pick<Cartao, "id">[]): VisaoCartoes {
  if (visao === VISAO_GERAL) return cartoes.length === 1 ? cartoes[0].id : VISAO_GERAL;
  return cartoes.some((c) => c.id === visao) ? visao : visaoInicial(cartoes);
}

/** Cartões que entram na visão atual. */
export function cartoesDaVisao<T extends Pick<Cartao, "id">>(cartoes: T[], visao: VisaoCartoes): T[] {
  if (visao === VISAO_GERAL) return cartoes;
  return cartoes.filter((c) => c.id === visao);
}

/** Totais da visão. Na visão de um cartão, usa só o resumo daquele cartão. */
export function totaisDaVisao(
  cartoes: Pick<Cartao, "id" | "limiteTotal">[],
  resumos: Map<string, ResumoCartao>,
  visao: VisaoCartoes,
): { limite: number; usado: number; disponivel: number } {
  const lista = cartoesDaVisao(cartoes, visao);
  if (visao !== VISAO_GERAL && lista.length === 1) {
    const c = lista[0];
    const r = resumos.get(c.id);
    const limite = c.limiteTotal || 0;
    const usado = r?.usadoMes ?? 0;
    return { limite, usado, disponivel: r ? r.disponivel : Math.max(0, limite - usado) };
  }
  const limite = lista.reduce((s, c) => s + (c.limiteTotal || 0), 0);
  const usado = lista.reduce((s, c) => s + (resumos.get(c.id)?.usadoMes ?? 0), 0);
  return { limite, usado, disponivel: Math.max(0, limite - usado) };
}

/** Compras no crédito da visão, mais recentes primeiro. */
export function comprasDaVisao<G extends Pick<Gasto, "formaPagamento" | "cartaoId" | "data">>(
  gastos: G[],
  visao: VisaoCartoes,
): G[] {
  return gastos
    .filter(
      (g) =>
        g.formaPagamento === "credito" &&
        !!g.cartaoId &&
        (visao === VISAO_GERAL || g.cartaoId === visao),
    )
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
}

/** Cartões com vencimento pendente na visão (sem faturas pagas/zeradas). */
export function vencimentosDaVisao<T extends Pick<Cartao, "id" | "diaVencimento">>(
  cartoes: T[],
  faturas: Map<string, FaturaCorrenteInfo>,
  visao: VisaoCartoes,
  diasAte: (dia: number) => number,
): Array<{ cartao: T; dias: number }> {
  return cartoesDaVisao(cartoes, visao)
    .filter((c) => {
      if (!c.diaVencimento) return false;
      const f = faturas.get(c.id);
      return !!f && f.status !== "paga" && f.pendente > 0;
    })
    .map((c) => ({ cartao: c, dias: diasAte(c.diaVencimento) }))
    .sort((a, b) => a.dias - b.dias)
    .slice(0, 4);
}
