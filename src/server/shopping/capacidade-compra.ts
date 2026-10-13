/**
 * Estimativa PURA de capacidade de compra (centavos inteiros, sem I/O).
 * - Renda: média dos últimos 3 meses COMPLETOS antes do mês de `hoje`.
 * - Compromissos mensais deduplicados por id (fixas, faturas, parcelas, assinaturas).
 * - Dinheiro guardado e limite de cartão NUNCA entram na folga.
 * - Parcela > 30% da folga → "Pode apertar seu orçamento".
 * Cenários 6/10/12x são SIMULAÇÃO matemática sem juros, não condição da loja.
 */
export const AVISO_APERTO = "Pode apertar seu orçamento";
export const LIMITE_PCT_FOLGA = 30;

export type Compromisso = {
  id: string;
  tipo: "fixa" | "fatura" | "parcela" | "assinatura";
  valorMensalCents: number;
};
export type CapacidadeInput = {
  hoje: string; // YYYY-MM-DD no fuso do usuário
  rendaPorMes: Record<string, number>; // "YYYY-MM" → centavos
  compromissos: Compromisso[];
  precoCents: number;
  /** Ignorados de propósito (documentam a regra). */
  guardadoCents?: number;
  limiteCartaoCents?: number;
  parcelas?: number[];
};
export type Cenario = { n: number; parcelaCents: number; pctFolga: number | null; aperta: boolean };
export type Capacidade = {
  confianca: "ok" | "baixa" | "insuficiente";
  meses: string[];
  rendaMediaCents: number | null;
  compromissosCents: number;
  folgaCents: number | null;
  cabeAVista: boolean | null;
  cenarios: Cenario[];
  mensagem: string;
};

export function ultimosMesesCompletos(hoje: string, n = 3): string[] {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(hoje);
  if (!m) throw new Error("data inválida");
  let y = Number(m[1]);
  let mo = Number(m[2]);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    mo--;
    if (mo === 0) { mo = 12; y--; }
    out.push(`${y}-${String(mo).padStart(2, "0")}`);
  }
  return out;
}

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");

export function estimarCapacidadeCompra(i: CapacidadeInput): Capacidade {
  if (!Number.isSafeInteger(i.precoCents) || i.precoCents <= 0) throw new Error("preço inválido");
  const meses = ultimosMesesCompletos(i.hoje).filter((k) => Number.isSafeInteger(i.rendaPorMes[k]) && i.rendaPorMes[k] > 0);
  const vistos = new Set<string>();
  let compromissosCents = 0;
  for (const c of i.compromissos) {
    if (vistos.has(c.id) || !Number.isSafeInteger(c.valorMensalCents) || c.valorMensalCents <= 0) continue;
    vistos.add(c.id);
    compromissosCents += c.valorMensalCents;
  }
  const ns = [...new Set(i.parcelas ?? [6, 10, 12])].filter((n) => Number.isInteger(n) && n >= 2 && n <= 24);
  if (meses.length === 0) {
    return {
      confianca: "insuficiente", meses, rendaMediaCents: null, compromissosCents, folgaCents: null,
      cabeAVista: null, cenarios: ns.map((n) => ({ n, parcelaCents: Math.ceil(i.precoCents / n), pctFolga: null, aperta: false })),
      mensagem: "Não tenho receitas suficientes dos últimos 3 meses para estimar se essa compra cabe no seu orçamento.",
    };
  }
  const soma = meses.reduce((s, k) => s + i.rendaPorMes[k], 0);
  const rendaMediaCents = Math.floor(soma / meses.length);
  const folgaCents = rendaMediaCents - compromissosCents;
  const cenarios = ns.map((n) => {
    const parcelaCents = Math.ceil(i.precoCents / n);
    const pctFolga = folgaCents > 0 ? Math.round((parcelaCents * 1000) / folgaCents) / 10 : null;
    return { n, parcelaCents, pctFolga, aperta: folgaCents <= 0 || parcelaCents * 100 > LIMITE_PCT_FOLGA * folgaCents };
  });
  const confianca = meses.length === 3 ? "ok" : "baixa";
  const linhas: string[] = [];
  if (confianca === "baixa") linhas.push(`Estimativa com baixa confiança: só encontrei receitas de ${meses.length} dos últimos 3 meses.`);
  linhas.push(`Folga mensal estimada: ${brl(Math.max(folgaCents, 0))} (renda média ${brl(rendaMediaCents)} menos compromissos ${brl(compromissosCents)}; dinheiro guardado não entra).`);
  let cabeAVista: boolean | null;
  if (folgaCents <= 0) {
    cabeAVista = false;
    linhas.push("Pela estimativa, essa compra não cabe na sua folga mensal.");
  } else {
    cabeAVista = i.precoCents <= folgaCents;
    linhas.push(cabeAVista ? `À vista (${brl(i.precoCents)}): cabe na folga de um mês, pela estimativa.` : `À vista (${brl(i.precoCents)}): passa da folga de um mês.`);
    for (const c of cenarios) {
      linhas.push(`${c.n}x de ${brl(c.parcelaCents)} (simulação sem juros) = ${String(c.pctFolga).replace(".", ",")}% da folga${c.aperta ? ` — ${AVISO_APERTO}` : ""}`);
    }
  }
  linhas.push("É uma estimativa com seus registros, não uma garantia.");
  return { confianca, meses, rendaMediaCents, compromissosCents, folgaCents, cabeAVista, cenarios, mensagem: linhas.join("\n") };
}
