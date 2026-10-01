/**
 * Competência da fatura (mês do VENCIMENTO) — fonte única, pura e
 * compartilhada por site, servidor e WhatsApp.
 *
 * Conceitos separados:
 *  - mês de referência do gasto (`gastos.invoice_month` / data) → "quando comprei";
 *  - competência da fatura (`gastos.fatura_competencia`, YYYY-MM do VENCIMENTO)
 *    → "quando vou pagar".
 *
 * Internamente as faturas continuam indexadas pelo "ciclo" legado
 * (`faturas_cartao.mes/ano`, mês em que o ciclo começa). A conversão é
 * determinística por cartão:  competência = ciclo + offset, onde
 * offset = 1 (vence no mesmo mês do fechamento) ou 2 (vence no mês
 * seguinte ao fechamento).
 */

const YM_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isYm(v: unknown): v is string {
  return typeof v === "string" && YM_RE.test(v);
}

export function ym(ano: number, mes: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

export function addMonthsYm(base: string, delta: number): string {
  const [a, m] = base.split("-").map(Number);
  const idx = a * 12 + (m - 1) + delta;
  return ym(Math.floor(idx / 12), (idx % 12) + 1);
}

function dia(n: number | null | undefined, fallback: number): number {
  const v = Number(n);
  return Number.isFinite(v) && v >= 1 && v <= 31 ? Math.trunc(v) : fallback;
}

/** Meses entre o mês-ciclo legado e o mês do vencimento. */
export function offsetVencimento(diaFech?: number | null, diaVenc?: number | null): number {
  const f = dia(diaFech, 1);
  const v = dia(diaVenc, 10);
  return v <= f ? 2 : 1;
}

/** Ciclo legado (YYYY-MM) de uma compra pela data: dia ≤ fechamento → mês anterior. */
export function cicloLegadoPorData(dataISO: string, diaFech?: number | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dataISO ?? "");
  if (!m) return null;
  const base = ym(Number(m[1]), Number(m[2]));
  return Number(m[3]) <= dia(diaFech, 1) ? addMonthsYm(base, -1) : base;
}

export function cicloParaCompetencia(ciclo: string, diaFech?: number | null, diaVenc?: number | null) {
  return addMonthsYm(ciclo, offsetVencimento(diaFech, diaVenc));
}

export function competenciaParaCiclo(comp: string, diaFech?: number | null, diaVenc?: number | null) {
  return addMonthsYm(comp, -offsetVencimento(diaFech, diaVenc));
}

export type CompetenciaCalculada = {
  /** YYYY-MM do vencimento. */
  competencia: string;
  /**
   * true quando a compra ocorreu exatamente no dia do fechamento — algumas
   * operadoras processam na fatura seguinte. Mostramos a sugestão, mas
   * permitimos ajuste manual em vez de afirmar certeza.
   */
  diaDoFechamento: boolean;
};

/** Competência (mês do vencimento) de uma compra num cartão cadastrado. */
export function competenciaPorData(
  dataISO: string,
  diaFech?: number | null,
  diaVenc?: number | null,
): CompetenciaCalculada | null {
  const ciclo = cicloLegadoPorData(dataISO, diaFech);
  if (!ciclo) return null;
  const d = Number(dataISO.slice(8, 10));
  return {
    competencia: cicloParaCompetencia(ciclo, diaFech, diaVenc),
    diaDoFechamento: d === dia(diaFech, 1),
  };
}

export type GastoCompetenciaInput = {
  fatura_competencia?: string | null;
  invoice_month?: string | null;
  data?: string | null;
};

/**
 * Competência efetiva de um gasto no crédito.
 *  1. `fatura_competencia` preenchida → fonte da verdade (novos registros).
 *  2. Legado (NULL): exatamente o comportamento anterior — `invoice_month`
 *     tratado como ciclo, senão ciclo pela data — convertido em mês do vencimento.
 * Assim registros antigos continuam na MESMA fatura de antes, só com o
 * nome passando a ser o mês do vencimento.
 */
export function competenciaDoGasto(
  g: GastoCompetenciaInput,
  diaFech?: number | null,
  diaVenc?: number | null,
): string | null {
  if (isYm(g.fatura_competencia)) return g.fatura_competencia;
  const ciclo = isYm(g.invoice_month) ? g.invoice_month : cicloLegadoPorData(g.data ?? "", diaFech);
  return ciclo ? cicloParaCompetencia(ciclo, diaFech, diaVenc) : null;
}

/** Competência da fatura aberta hoje (= compra feita hoje). */
export function competenciaAberta(hoje: Date, diaFech?: number | null, diaVenc?: number | null) {
  const iso = ym(hoje.getFullYear(), hoje.getMonth() + 1) + "-" + String(hoje.getDate()).padStart(2, "0");
  return competenciaPorData(iso, diaFech, diaVenc)!.competencia;
}

const NOMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export function nomeMesYm(v: string): string {
  if (!isYm(v)) return v;
  const [a, m] = v.split("-").map(Number);
  return `${NOMES[m - 1]}/${a}`;
}

/** Plano de competências das parcelas: parcela i → competência inicial + i. */
export function competenciasParcelas(primeira: string, total: number): string[] {
  return Array.from({ length: Math.max(1, total) }, (_, i) => addMonthsYm(primeira, i));
}
