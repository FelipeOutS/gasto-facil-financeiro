/**
 * WA-F3 — Helper financeiro reutilizável para COMPRAS PARCELADAS no cartão.
 *
 * Espelha as mesmas regras de ciclo de fatura usadas em
 * `cartao-fatura.server.ts` (que por sua vez espelham `src/lib/store.ts`).
 *
 * Regras obrigatórias:
 * - valor total sempre é a origem da compra;
 * - dividir em centavos sem perder valor;
 * - a soma das parcelas é exatamente igual ao total;
 * - centavos restantes do arredondamento são distribuídos nas
 *   PRIMEIRAS parcelas (parcela 1, 2, ...);
 * - nunca gera parcela com valor zero ou negativo;
 * - mínimo 2 parcelas, máximo 48;
 * - timezone America/Sao_Paulo;
 * - usa `faturaCorrenteRef` para determinar o invoice_month da
 *   primeira parcela e incrementa mês a mês para as próximas.
 *
 * Sem efeitos colaterais. Sem I/O. Pode ser usado tanto no WhatsApp
 * quanto em futuros pontos do site.
 */
import { faturaCorrenteRef, nowInAppTz } from "./cartao-fatura.server";

export const MIN_PARCELAS = 2;
export const MAX_PARCELAS = 48;

export type ParcelaItem = {
  /** 1-indexed. */
  numero: number;
  /** Valor em reais (R$), com 2 casas. Soma exata = total. */
  valor: number;
  /** "YYYY-MM" — chave usada em `gastos.invoice_month`. */
  invoiceMonth: string;
  /** "YYYY-MM-DD" — data sintética (dia da compra clampado no mês). */
  data: string;
  mes: number;
  ano: number;
};

export type PlanoParcelamento = {
  totalParcelas: number;
  /** Total em reais (R$), com 2 casas. */
  total: number;
  parcelas: ParcelaItem[];
};

/**
 * Divide o total em N parcelas em centavos. Retorna um array de
 * inteiros (centavos) cuja soma é exatamente `totalCentavos`. O
 * centavo extra é distribuído nas primeiras parcelas.
 *
 * Exemplo: (10000, 3) → [3334, 3333, 3333]
 */
export function calcularParcelasCentavos(
  totalCentavos: number,
  n: number,
): number[] {
  if (!Number.isFinite(totalCentavos) || !Number.isInteger(totalCentavos)) {
    throw new Error("totalCentavos precisa ser inteiro");
  }
  if (totalCentavos <= 0) throw new Error("totalCentavos precisa ser > 0");
  if (!Number.isInteger(n) || n < MIN_PARCELAS || n > MAX_PARCELAS) {
    throw new Error(`quantidade de parcelas inválida (esperado ${MIN_PARCELAS}..${MAX_PARCELAS})`);
  }
  if (totalCentavos < n) {
    // Garantia: cada parcela precisa ter pelo menos 1 centavo.
    throw new Error("total insuficiente para o número de parcelas");
  }
  const base = Math.floor(totalCentavos / n);
  const resto = totalCentavos - base * n;
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = i < resto ? base + 1 : base;
  }
  return out;
}

/**
 * Converte um valor em reais (R$) para centavos com arredondamento
 * banker-safe via Math.round (suficiente porque a entrada sempre tem
 * no máximo 2 casas decimais).
 */
export function reaisParaCentavos(reais: number): number {
  return Math.round(reais * 100);
}
function centavosParaReais(c: number): number {
  return Math.round(c) / 100;
}

function addMonthsToYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

function dataForInvoiceMonth(ym: string, baseDay: number): string {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const day = Math.min(Math.max(1, baseDay), last);
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Determina o invoice_month da PRIMEIRA parcela, respeitando o
 * fechamento do cartão e a data da compra. Reusa `faturaCorrenteRef`
 * — exatamente como o site/`WA-F1`/`WA-F2`.
 */
export function determinarInvoiceMonthDaPrimeiraParcela(args: {
  diaFechamento: number;
  dataCompra?: Date;
}): string {
  const hoje = args.dataCompra ?? nowInAppTz();
  const dia = Math.max(1, Math.min(28, args.diaFechamento || 1));
  const { mes, ano } = faturaCorrenteRef(dia, hoje);
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

/**
 * Monta o plano completo de parcelamento (sem persistência).
 */
export function criarPlanoParcelamento(args: {
  totalReais: number;
  totalParcelas: number;
  diaFechamentoCartao: number;
  dataCompra?: Date;
}): PlanoParcelamento {
  const total = Number(args.totalReais);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("totalReais inválido");
  }
  const n = args.totalParcelas;
  const totalCentavos = reaisParaCentavos(total);
  const centavos = calcularParcelasCentavos(totalCentavos, n);
  const primeiraYm = determinarInvoiceMonthDaPrimeiraParcela({
    diaFechamento: args.diaFechamentoCartao,
    dataCompra: args.dataCompra,
  });
  const baseDay = (args.dataCompra ?? nowInAppTz()).getDate();
  const parcelas: ParcelaItem[] = centavos.map((c, i) => {
    const ym = i === 0 ? primeiraYm : addMonthsToYm(primeiraYm, i);
    const data = dataForInvoiceMonth(ym, baseDay);
    const [y, m] = ym.split("-").map(Number);
    return {
      numero: i + 1,
      valor: centavosParaReais(c),
      invoiceMonth: ym,
      data,
      mes: m,
      ano: y,
    };
  });
  // Sanity check: soma exata.
  const somaCent = centavos.reduce((a, b) => a + b, 0);
  if (somaCent !== totalCentavos) {
    throw new Error("invariante violado: soma das parcelas != total");
  }
  return {
    totalParcelas: n,
    total: centavosParaReais(totalCentavos),
    parcelas,
  };
}

/** Formata R$ no padrão pt-BR. Mantido aqui para evitar imports cruzados. */
export function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
