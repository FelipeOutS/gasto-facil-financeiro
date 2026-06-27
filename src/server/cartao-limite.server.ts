/**
 * WA-F5 — Helper server-side para LIMITE, UTILIZAÇÃO e VALOR COMPROMETIDO
 * de cartões de crédito. Espelha estritamente as regras já em produção
 * em `src/server/cartao-fatura.server.ts` (faturaCorrenteRef,
 * cicloFatura, getFaturaAtualPorCartao, getFaturaPorMes,
 * getComprasParceladasEmAberto) — não duplica nem inventa cálculo.
 *
 * Conceitos (sem dupla contagem):
 *  - faturaAtual          → ciclo aberto do cartão (regra do site).
 *  - proximaFaturaEstimada → invoice_month = mês imediatamente
 *                            seguinte ao ciclo aberto.
 *  - parcelasFuturasAposProximo → soma das parcelas em aberto cujo
 *                            invoice_month é estritamente MAIOR que o
 *                            próximo invoice_month. Não inclui parcelas
 *                            já contabilizadas em fatura atual ou
 *                            próxima fatura.
 *  - disponivelEstimado   → max(0, limite - faturaAtual
 *                            - proximaFaturaEstimada
 *                            - parcelasFuturasAposProximo). Só é
 *                            calculado quando há limite cadastrado.
 *                            Não infere status de pagamento de fatura
 *                            nem de bloqueios da operadora.
 *
 * Privacidade: chamador passa `userId` autorizado pelo gate canônico.
 * Todas as queries filtram por user_id (delegado aos helpers de
 * `cartao-fatura.server.ts`). Nunca lê dados de outro usuário.
 */
import {
  loadCartoesDoUsuario,
  getFaturaAtualPorCartao,
  getFaturaPorMes,
  getComprasParceladasEmAberto,
  faturaCorrenteRef,
  nowInAppTz,
  type CartaoRow,
} from "./cartao-fatura.server";

export type ResumoLimiteCartao = {
  cartao: CartaoRow;
  limite: number;
  hasLimite: boolean;
  faturaAtual: number;
  proximaFaturaEstimada: number;
  parcelasFuturasAposProximo: number;
  /** Disponibilidade estimada quando há limite cadastrado; null caso contrário. */
  disponivelEstimado: number | null;
  /**
   * Disponibilidade é considerada calculável quando há limite > 0.
   * Não afirmamos que esse valor reflete pagamentos ou bloqueios da
   * operadora — só projeta o que já está registrado no app.
   */
  disponivelConfiavel: boolean;
};

function nextInvoiceYm(diaFech: number, hoje: Date): string {
  const { mes, ano } = faturaCorrenteRef(diaFech, hoje);
  const nm = mes === 12 ? 1 : mes + 1;
  const ny = mes === 12 ? ano + 1 : ano;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

function currentInvoiceYm(diaFech: number, hoje: Date): string {
  const { mes, ano } = faturaCorrenteRef(diaFech, hoje);
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

/**
 * Resumo completo de limite/utilização/comprometimento de UM cartão.
 * Reusa helpers existentes — não duplica regras financeiras.
 */
export async function getResumoLimiteCartao(
  userId: string,
  cartao: CartaoRow,
  hoje: Date = nowInAppTz(),
): Promise<ResumoLimiteCartao> {
  const diaFech = Number(cartao.dia_fechamento ?? 1) || 1;
  const limite = Number(cartao.limite_total ?? 0) || 0;
  const hasLimite = limite > 0;

  const fatAtual = await getFaturaAtualPorCartao(userId, cartao, hoje);
  const proxYm = nextInvoiceYm(diaFech, hoje);
  const curYm = currentInvoiceYm(diaFech, hoje);
  const prox = await getFaturaPorMes(userId, cartao, proxYm);
  const proxTotal = prox?.total ?? 0;

  // Parcelas após o PRÓXIMO ciclo (estritamente > proxYm) para evitar
  // somar valor já presente em faturaAtual ou proximaFatura.
  const compras = await getComprasParceladasEmAberto(userId, hoje);
  let parcelasAposProximo = 0;
  for (const c of compras) {
    if (c.cartaoId !== cartao.id) continue;
    for (const p of c.parcelasRestantes) {
      const ym = p.invoiceMonth ?? (p.data ? p.data.slice(0, 7) : "");
      if (!ym) continue;
      // > proxYm → após o próximo ciclo. parcelas em curYm/proxYm
      // já contam em faturaAtual/proximaFatura, então NÃO somamos.
      if (ym > proxYm && ym !== curYm) parcelasAposProximo += p.valor;
    }
  }

  const disponivelEstimado = hasLimite
    ? Math.max(0, limite - fatAtual.total - proxTotal - parcelasAposProximo)
    : null;

  return {
    cartao,
    limite,
    hasLimite,
    faturaAtual: fatAtual.total,
    proximaFaturaEstimada: proxTotal,
    parcelasFuturasAposProximo: parcelasAposProximo,
    disponivelEstimado,
    disponivelConfiavel: hasLimite,
  };
}

/** Resumo de todos os cartões do usuário. */
export async function getResumoLimitesUsuario(
  userId: string,
  hoje: Date = nowInAppTz(),
): Promise<ResumoLimiteCartao[]> {
  const cartoes = await loadCartoesDoUsuario(userId);
  const out: ResumoLimiteCartao[] = [];
  for (const c of cartoes) out.push(await getResumoLimiteCartao(userId, c, hoje));
  return out;
}

/** Comprometimento futuro: fatura atual + próxima + parcelas após o próximo ciclo. */
export async function getComprometimentoFuturoCartao(
  userId: string,
  cartao: CartaoRow,
  hoje: Date = nowInAppTz(),
): Promise<{
  faturaAtual: number;
  proximaFaturaEstimada: number;
  parcelasFuturasAposProximo: number;
  totalComprometido: number;
}> {
  const r = await getResumoLimiteCartao(userId, cartao, hoje);
  return {
    faturaAtual: r.faturaAtual,
    proximaFaturaEstimada: r.proximaFaturaEstimada,
    parcelasFuturasAposProximo: r.parcelasFuturasAposProximo,
    totalComprometido:
      r.faturaAtual + r.proximaFaturaEstimada + r.parcelasFuturasAposProximo,
  };
}
