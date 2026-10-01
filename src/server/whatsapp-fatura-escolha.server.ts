/**
 * Escolha manual da competência da fatura no WhatsApp quando a compra no
 * crédito foi feita com cartão NÃO cadastrado ("Em qual fatura essa compra
 * vai cair?"). Botão e texto convergem para `tratarEscolhaFatura`, então o
 * resultado financeiro é idêntico.
 *
 * Segurança: só atualiza gasto do próprio `userId`, origem WhatsApp, crédito,
 * sem cartão, ainda sem competência e criado nas últimas 2 horas.
 */
import * as _supa from "@/integrations/supabase/client.server";
import { addMonthsYm, isYm, nomeMesYm, ym } from "@/lib/fatura-competencia";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin: any = new Proxy({}, { get: (_t, prop) => (_supa.supabaseAdmin as any)[prop] });

const PENDENTE_JANELA_MS = 2 * 60 * 60 * 1000;

const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[?!.,;:"']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Opções sugeridas: 1 e 2 meses após a compra. */
export function opcoesFatura(dataCompraISO: string): string[] {
  const base = dataCompraISO.slice(0, 7);
  return [addMonthsYm(base, 1), addMonthsYm(base, 2)];
}

export function perguntaEscolhaFatura(dataCompraISO: string): string {
  const [a, b] = opcoesFatura(dataCompraISO).map((o) => nomeMesYm(o).split("/")[0].toLowerCase());
  return (
    "Em qual fatura essa compra vai cair?\n" +
    `Responda: "fatura de ${a}", "fatura de ${b}" ou outro mês.`
  );
}

/** Prefixo dos IDs de botão: `fatura_comp:YYYY-MM` e `fatura_comp:outro`. */
export const FATURA_COMP_PREFIX = "fatura_comp:";

export type EscolhaFaturaParse = { kind: "mes"; mes: number; ano?: number } | { kind: "ym"; ym: string } | { kind: "outro" };

/** Interpreta a resposta (texto digitado OU texto canônico vindo do botão). */
export function parseEscolhaFatura(texto: string): EscolhaFaturaParse | null {
  const raw = (texto ?? "").trim();
  if (raw.startsWith(FATURA_COMP_PREFIX)) {
    const v = raw.slice(FATURA_COMP_PREFIX.length);
    if (v === "outro") return { kind: "outro" };
    return isYm(v) ? { kind: "ym", ym: v } : null;
  }
  const t = norm(raw);
  if (/^outro mes$/.test(t)) return { kind: "outro" };
  const re = new RegExp(
    `^(?:(?:na|vai na|cai na)\\s+)?(?:fatura\\s+(?:de\\s+|do\\s+mes\\s+de\\s+)?)?(${Object.keys(MESES).join("|")})(?:\\s+(?:de\\s+)?(\\d{4}))?$`,
  );
  const m = t.match(re);
  if (!m) return null;
  return { kind: "mes", mes: MESES[m[1]], ano: m[2] ? Number(m[2]) : undefined };
}

/** Resolve o mês escolhido para YYYY-MM nunca antes do mês da compra. */
export function resolverCompetenciaEscolhida(
  p: EscolhaFaturaParse,
  dataCompraISO: string,
): string | null {
  if (p.kind === "outro") return null;
  if (p.kind === "ym") return p.ym;
  const compra = dataCompraISO.slice(0, 7);
  const [ca] = compra.split("-").map(Number);
  if (p.ano) return ym(p.ano, p.mes);
  let cand = ym(ca, p.mes);
  if (cand < compra) cand = ym(ca + 1, p.mes);
  return cand;
}

type Pendente = { id: string; data: string };

async function buscarGastoPendente(userId: string): Promise<Pendente | null> {
  const desde = new Date(Date.now() - PENDENTE_JANELA_MS).toISOString();
  try {
    const { data } = await supabaseAdmin
      .from("gastos")
      .select("id, data, created_at")
      .eq("user_id", userId)
      .eq("origem", "whatsapp")
      .eq("forma_pagamento", "credito")
      .is("cartao_id", null)
      .is("fatura_competencia", null)
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .limit(1);
    const row = Array.isArray(data) ? data[0] : null;
    return row ? { id: String(row.id), data: String(row.data) } : null;
  } catch {
    return null;
  }
}

/**
 * Retorna null quando a mensagem não é uma escolha de fatura OU não existe
 * gasto pendente — nesse caso o pipeline normal segue (ex.: "fatura de
 * novembro" continua sendo consulta).
 */
export async function tratarEscolhaFatura(
  userId: string,
  texto: string,
): Promise<{ gastoId: string; resposta: string } | null> {
  const parsed = parseEscolhaFatura(texto);
  if (!parsed) return null;
  const pend = await buscarGastoPendente(userId);
  if (!pend) return null;
  if (parsed.kind === "outro") {
    return {
      gastoId: pend.id,
      resposta: 'Qual mês? Responda, por exemplo, "fatura de dezembro".',
    };
  }
  const comp = resolverCompetenciaEscolhida(parsed, pend.data);
  if (!comp) return null;
  const { error } = await supabaseAdmin
    .from("gastos")
    .update({ fatura_competencia: comp })
    .eq("id", pend.id)
    .eq("user_id", userId)
    .is("fatura_competencia", null);
  if (error) {
    return { gastoId: pend.id, resposta: "Não consegui salvar a fatura agora. Pode tentar de novo?" };
  }
  return {
    gastoId: pend.id,
    resposta:
      `Pronto! Essa compra vai na fatura de ${nomeMesYm(comp)}.\n` +
      `Em Gastos ela continua no mês da compra (${nomeMesYm(pend.data.slice(0, 7))}).`,
  };
}
