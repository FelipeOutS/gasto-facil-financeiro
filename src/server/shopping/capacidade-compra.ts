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
export const MSG_NAO_AVALIA = "Não consigo avaliar com segurança seu orçamento agora.";
export const ROTULO_SIMULACAO_SEM_JUROS = "simulação matemática sem juros, não é oferta de parcelamento da loja";

export type Compromisso = {
  id: string;
  tipo: "fixa" | "fatura" | "parcela" | "assinatura" | "divida";
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
  /** Meses completos com qualquer registro. Quando presente, mês ativo sem renda = 0. */
  mesesAtivos?: string[];
  alertas?: string[];
  /** Dados conflitantes/incompletos: nunca apresentar folga. */
  inconclusivo?: boolean;
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
  const ultimos = ultimosMesesCompletos(i.hoje);
  const comHistorico = Array.isArray(i.mesesAtivos);
  // Com histórico explícito: meses ativos contam (renda 0 = zero observado). Legado: só meses com renda.
  const meses = comHistorico
    ? ultimos.filter((k) => i.mesesAtivos!.includes(k) && Number.isSafeInteger(i.rendaPorMes[k] ?? 0))
    : ultimos.filter((k) => Number.isSafeInteger(i.rendaPorMes[k]) && i.rendaPorMes[k] > 0);
  const vistos = new Set<string>();
  let compromissosCents = 0;
  for (const c of i.compromissos) {
    if (vistos.has(c.id) || !Number.isSafeInteger(c.valorMensalCents) || c.valorMensalCents <= 0) continue;
    vistos.add(c.id);
    compromissosCents += c.valorMensalCents;
  }
  const ns = [...new Set(i.parcelas ?? [6, 10, 12])].filter((n) => Number.isInteger(n) && n >= 2 && n <= 24);
  const soma = meses.reduce((s, k) => s + (i.rendaPorMes[k] ?? 0), 0);
  const semBase = i.inconclusivo === true || meses.length === 0 || soma <= 0 || (comHistorico && meses.length < 2);
  if (semBase) {
    const motivo = i.inconclusivo
      ? MSG_NAO_AVALIA
      : `${MSG_NAO_AVALIA} Não tenho histórico de receitas suficiente dos últimos 3 meses completos para estimar se essa compra cabe.`;
    return {
      confianca: "insuficiente", meses, rendaMediaCents: null, compromissosCents, folgaCents: null,
      cabeAVista: null, cenarios: ns.map((n) => ({ n, parcelaCents: Math.ceil(i.precoCents / n), pctFolga: null, aperta: false })),
      mensagem: motivo,
    };
  }
  const rendaMediaCents = Math.floor(soma / meses.length);
  const folgaCents = rendaMediaCents - compromissosCents;
  const cenarios = ns.map((n) => {
    const parcelaCents = Math.ceil(i.precoCents / n);
    const pctFolga = folgaCents > 0 ? Math.round((parcelaCents * 1000) / folgaCents) / 10 : null;
    return { n, parcelaCents, pctFolga, aperta: folgaCents <= 0 || parcelaCents * 100 > LIMITE_PCT_FOLGA * folgaCents };
  });
  const confianca = meses.length === 3 ? "ok" : "baixa";
  const linhas: string[] = [];
  if (confianca === "baixa") linhas.push(comHistorico
    ? `Estimativa com baixa confiança: só há registros em ${meses.length} dos últimos 3 meses completos.`
    : `Estimativa com baixa confiança: só encontrei receitas de ${meses.length} dos últimos 3 meses.`);
  for (const a of i.alertas ?? []) linhas.push(`Atenção: ${a}`);
  const dividas = i.compromissos.filter((c) => c.tipo === "divida").length;
  if (dividas > 0) linhas.push(`Contei ${dividas} conta(s) vencida(s) e não paga(s) pelo valor cheio neste mês.`);
  linhas.push(`Folga mensal estimada: ${brl(Math.max(folgaCents, 0))} (renda média ${brl(rendaMediaCents)} menos compromissos ${brl(compromissosCents)}; dinheiro guardado não entra).`);
  let cabeAVista: boolean | null;
  if (folgaCents <= 0) {
    cabeAVista = false;
    linhas.push("Pela estimativa, essa compra não cabe na sua folga mensal.");
  } else {
    cabeAVista = confianca === "ok" ? i.precoCents <= folgaCents : null;
    if (cabeAVista === null) linhas.push(`À vista (${brl(i.precoCents)}): com histórico incompleto, não afirmo que cabe.`);
    else linhas.push(cabeAVista ? `À vista (${brl(i.precoCents)}): cabe na folga de um mês, pela estimativa.` : `À vista (${brl(i.precoCents)}): passa da folga de um mês.`);
    for (const c of cenarios) {
      linhas.push(`${c.n}x de ${brl(c.parcelaCents)} (${ROTULO_SIMULACAO_SEM_JUROS}) = ${String(c.pctFolga).replace(".", ",")}% da folga${c.aperta ? ` — ${AVISO_APERTO}` : ""}`);
    }
  }
  linhas.push("É uma estimativa com seus registros, não uma garantia.");
  return { confianca, meses, rendaMediaCents, compromissosCents, folgaCents, cabeAVista, cenarios, mensagem: linhas.join("\n") };
}
