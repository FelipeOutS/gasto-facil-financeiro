/**
 * Parser de mensagens estilo WhatsApp para registrar gastos rapidamente.
 * Heurística regex local, sem chamada de IA. Tolera formatos livres,
 * curtos, organizados, com Pix ou parcelados.
 *
 * Exemplos suportados:
 *  - "Gastei R$ 26,00 na H Nunes Lanchonete hoje no Mercado Pago"
 *  - "Spotify 19,90 assinatura Nubank"
 *  - "Cobasi 221,13 pet cartão Mercado Pago 13/04"
 *  - "Aluguel 950 pix moradia 25/04"
 *  - "Notebook 2500 em 10x cartão Inter"
 *  - "valor: 89,90\nlocal: TotalPass\ncategoria: Assinaturas\ncartão: Mercado Pago\ndata: 19/04"
 */

import type { Cartao } from "./types";
import type { FormaPagamento } from "./types";

export type ParsedExpense = {
  nome: string;
  valor: number;
  data: string; // ISO YYYY-MM-DD
  formaPagamento: FormaPagamento;
  cartaoNomeDetectado?: string;
  cartaoId?: string;
  /** Quando o termo do cartão casa com mais de um cartão cadastrado. */
  cartaoAmbiguo?: { ids: string[]; nomes: string[] };
  parcelas?: number;
  categoriaSugestao?: string; // texto livre p/ casar com suggestCategory
  mensagemOriginal: string;
  /** 0..1 — quanto maior, mais confiança */
  confianca: number;
  /** Razões explicáveis (debug + UI). */
  notas: string[];
};

// ---------- helpers ----------

const APP_TZ = "America/Sao_Paulo";

function todayISO() {
  // Data local do usuário (BR) — evita off-by-one quando o host roda em UTC.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

function shiftDaysISO(deltaDays: number): string {
  const [y, m, d] = todayISO().split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function toISO(day: number, month: number, year: number): string {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// ---------- valor ----------

function parseValor(text: string): number | null {
  // R$ 1.234,56 | 1234,56 | 1234.56 | 950 | 19,90
  const re = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[,.]\d{1,2})?)/i;
  const m = text.match(re);
  if (!m) return null;
  let raw = m[1];
  // Se tem vírgula, é separador decimal br
  if (raw.includes(",")) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---------- data ----------

const MESES: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

function parseData(textRaw: string): { iso: string; matched: boolean } {
  const text = normalize(textRaw);
  const now = new Date();
  const yearNow = now.getFullYear();

  if (/\bhoje\b/.test(text)) return { iso: todayISO(), matched: true };
  if (/\bontem\b/.test(text)) {
    return { iso: shiftDaysISO(-1), matched: true };
  }
  if (/\banteontem\b/.test(text)) {
    return { iso: shiftDaysISO(-2), matched: true };
  }

  // dd/mm/yyyy ou dd/mm
  const dm = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dm) {
    const d = Number(dm[1]);
    const m = Number(dm[2]);
    let y = dm[3] ? Number(dm[3]) : yearNow;
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      return { iso: toISO(d, m, y), matched: true };
    }
  }

  // dd de mes [de yyyy]
  const dmExt = text.match(/\b(\d{1,2})\s+de\s+([a-z]{3,})(?:\s+de\s+(\d{2,4}))?/);
  if (dmExt) {
    const d = Number(dmExt[1]);
    const monthKey = dmExt[2].slice(0, 3);
    const m = MESES[monthKey];
    let y = dmExt[3] ? Number(dmExt[3]) : yearNow;
    if (y < 100) y += 2000;
    if (m && d >= 1 && d <= 31) return { iso: toISO(d, m, y), matched: true };
  }

  return { iso: todayISO(), matched: false };
}

// ---------- forma de pagamento ----------

function parseFormaPagamento(textRaw: string): {
  forma: FormaPagamento;
  matched: boolean;
} {
  const t = normalize(textRaw);
  if (/\bpix\b/.test(t)) return { forma: "pix", matched: true };
  if (/\bdinheiro\b|\bem especie\b/.test(t)) return { forma: "dinheiro", matched: true };
  if (/\bdebito\b|\bdébito\b/.test(t)) return { forma: "debito", matched: true };
  if (/\bboleto\b/.test(t)) return { forma: "boleto", matched: true };
  if (/\btransfer(e|ê)ncia\b|\bted\b|\bdoc\b/.test(t))
    return { forma: "transferencia", matched: true };
  if (/\bvale\s*alimenta/.test(t)) return { forma: "vale_alimentacao", matched: true };
  if (/\bvale\s*refei/.test(t)) return { forma: "vale_refeicao", matched: true };
  // crédito é o default quando aparece "cartão" ou nome de banco
  if (/\bcr(e|é)dito\b|\bcart(a|ã)o\b/.test(t)) return { forma: "credito", matched: true };
  return { forma: "credito", matched: false };
}

// ---------- cartão ----------

const BANCOS_KEYWORDS = [
  "nubank",
  "itau",
  "itaú",
  "santander",
  "mercado pago",
  "mercadopago",
  "inter",
  "c6",
  "bradesco",
  "banco do brasil",
  "bb",
  "caixa",
  "picpay",
  "next",
  "neon",
  "will",
  "pan",
  "original",
  "btg",
  "xp",
  "porto",
  "safra",
];

function detectCartao(
  textRaw: string,
  cartoes: Cartao[],
): { cartaoId?: string; nomeDetectado?: string; ambiguo?: { ids: string[]; nomes: string[] } } {
  const t = normalize(textRaw);

  // 1) Match direto pelo nome do cartão cadastrado (todos os matches)
  const matchesNome = cartoes.filter((c) => {
    const n = normalize(c.nome);
    return n.length >= 3 && t.includes(n);
  });
  if (matchesNome.length === 1) {
    return { cartaoId: matchesNome[0].id, nomeDetectado: matchesNome[0].nome };
  }
  if (matchesNome.length > 1) {
    return {
      nomeDetectado: matchesNome[0].nome,
      ambiguo: { ids: matchesNome.map((c) => c.id), nomes: matchesNome.map((c) => c.nome) },
    };
  }
  // 2) Match pelo banco do cartão cadastrado
  const matchesBanco = cartoes.filter((c) => {
    const b = normalize(c.banco || "");
    return b.length >= 3 && t.includes(b);
  });
  if (matchesBanco.length === 1) {
    return { cartaoId: matchesBanco[0].id, nomeDetectado: matchesBanco[0].nome };
  }
  if (matchesBanco.length > 1) {
    return {
      nomeDetectado: matchesBanco[0].banco,
      ambiguo: { ids: matchesBanco.map((c) => c.id), nomes: matchesBanco.map((c) => c.nome) },
    };
  }
  // 3) Keyword genérica de banco — sem cartão correspondente
  for (const k of BANCOS_KEYWORDS) {
    if (t.includes(k)) return { nomeDetectado: k };
  }
  return {};
}

// ---------- parcelas ----------

function parseParcelas(textRaw: string): number | undefined {
  const t = normalize(textRaw);
  const m = t.match(/\b(?:em\s+)?(\d{1,2})\s*x\b/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 2 && n <= 36 ? n : undefined;
}

// ---------- formato organizado (chave: valor) ----------

function parseEstruturado(message: string): Partial<ParsedExpense> | null {
  const lines = message.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const obj: Record<string, string> = {};
  let hits = 0;
  for (const ln of lines) {
    const m = ln.match(/^([a-zA-ZÀ-ÿ]+)\s*[:=]\s*(.+)$/);
    if (!m) continue;
    obj[normalize(m[1])] = m[2].trim();
    hits++;
  }
  if (hits < 2) return null;
  return {
    nome: obj["local"] || obj["estabelecimento"] || obj["nome"] || obj["descricao"] || "",
    valor: obj["valor"] ? parseValor(obj["valor"]) ?? 0 : 0,
    data: obj["data"] ? parseData(obj["data"]).iso : todayISO(),
    categoriaSugestao: obj["categoria"] || obj["categoria"],
    cartaoNomeDetectado: obj["cartao"] || obj["cartão"],
  };
}

// ---------- limpeza de descrição ----------

/**
 * Normaliza o nome do gasto antes de salvar/exibir:
 * - remove vírgulas, pontos, hífens, ponto-e-vírgula e espaços nas bordas;
 * - preserva pontuação legítima no meio (ex.: "Café & Cia.");
 * - colapsa espaços internos.
 */
export function cleanDescricao(input: string | null | undefined): string {
  if (!input) return "";
  return String(input)
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:\-_/\\|·•]+/, "")
    .replace(/[\s,;:\-_/\\|·•]+$/, "")
    .trim();
}

// ---------- nome do estabelecimento ----------

function extractNome(textRaw: string, valor: number | null): string {
  let t = textRaw.trim();
  // remove valor e R$
  t = t.replace(/r\$\s*/gi, "");
  if (valor != null) {
    const valorRe = new RegExp(
      String(valor)
        .replace(".", "[.,]")
        .replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1\\.?"),
      "g",
    );
    t = t.replace(valorRe, " ");
  }
  // remove tokens conhecidos
  const stop = [
    /\br\$\s*\d[\d.,]*\b/gi,
    /\b\d+[.,]\d{1,2}\b/g,
    /\b\d+\b/g,
    /\bhoje\b|\bontem\b|\banteontem\b/gi,
    /\bem\s+\d{1,2}\s*x\b/gi,
    /\b\d{1,2}\s*x\b/gi,
    /\bgastei\b|\bcomprei\b|\bpaguei\b/gi,
    /\bno\b|\bna\b|\bnos\b|\bnas\b|\bde\b|\bdo\b|\bda\b|\bcom\b|\bpor\b/gi,
    /\bcart(a|ã)o\b|\bcr(e|é)dito\b|\bd(e|é)bito\b|\bpix\b|\bboleto\b|\btransfer(e|ê)ncia\b|\bdinheiro\b/gi,
    new RegExp(`\\b(?:${BANCOS_KEYWORDS.map((k) => k.replace(/ /g, "\\s+")).join("|")})\\b`, "gi"),
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  ];
  for (const re of stop) t = t.replace(re, " ");
  t = t.replace(/\s+/g, " ").trim();
  // capitaliza palavras
  const titled = t
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ")
    .slice(0, 80);
  return cleanDescricao(titled);
}

// ---------- main ----------

export function parseWhatsAppExpenseMessage(
  message: string,
  cartoes: Cartao[] = [],
): ParsedExpense {
  const original = message.trim();
  const notas: string[] = [];

  // 1) Tenta formato chave: valor
  const estr = parseEstruturado(original);

  const valor = estr?.valor && estr.valor > 0 ? estr.valor : parseValor(original);
  if (valor == null || valor <= 0) notas.push("Valor não identificado");

  const data = estr?.data ?? parseData(original).iso;
  const dataMatched = !!estr?.data || parseData(original).matched;
  // Ausência de data NÃO é considerada falha de revisão:
  // se não vier data, usamos hoje silenciosamente.

  const fp = parseFormaPagamento(original);
  const card = detectCartao(original, cartoes);

  // Se a mensagem citou um banco/cartão conhecido, isso valida a forma
  // como crédito — não é mais "inferência ambígua".
  const formaConfirmada = fp.matched || !!card.nomeDetectado;
  if (!formaConfirmada) notas.push("Forma de pagamento não identificada");

  if (fp.forma === "credito" && card.nomeDetectado && !card.cartaoId) {
    notas.push(`Cartão "${card.nomeDetectado}" não encontrado no cadastro`);
  } else if (fp.forma === "credito" && !card.nomeDetectado && !card.cartaoId) {
    // Crédito explícito ("cartão") mas sem banco citado nem cartão cadastrado
    if (fp.matched) notas.push("Cartão não identificado");
  }

  const parcelas = parseParcelas(original);
  const nome = (estr?.nome && estr.nome.length > 1
    ? estr.nome
    : extractNome(original, valor ?? null)) || "Gasto WhatsApp";

  // confiança — ausência de data NÃO penaliza (usa hoje por padrão)
  let confianca = 0;
  if (valor && valor > 0) confianca += 0.5;
  if (nome && nome.length >= 3) confianca += 0.25;
  if (formaConfirmada) confianca += 0.1;
  // Crédito OK quando temos cartão cadastrado OU banco conhecido citado;
  // formas não-crédito (pix, débito, etc.) já são suficientes por si só.
  if (fp.forma !== "credito" || card.cartaoId || card.nomeDetectado) {
    confianca += 0.15;
  }
  if (dataMatched) confianca += 0.05;
  confianca = Math.min(1, confianca);

  return {
    nome,
    valor: valor ?? 0,
    data,
    formaPagamento: fp.forma,
    cartaoNomeDetectado: card.nomeDetectado ?? estr?.cartaoNomeDetectado,
    cartaoId: card.cartaoId,
    cartaoAmbiguo: card.ambiguo,
    parcelas,
    categoriaSugestao: estr?.categoriaSugestao || undefined,
    mensagemOriginal: original,
    confianca,
    notas,
  };
}
