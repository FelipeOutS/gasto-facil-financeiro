/** Pure routing and arithmetic for the no-paid-API WhatsApp research MVP. */
export type ResearchIntent = "product" | "compare" | "general" | "followup";
export type PriceOrigin = "USER_PROVIDED" | "SEARCH_VERIFIED";
export type ResearchProduct = {
  name: string;
  priceCents: number | null;
  priceOrigin: PriceOrigin | null;
  sourceUrl: string | null; // Article/source for product information, never proof of USER_PROVIDED price.
  summary: string | null;
};
export type ResearchContext = { products: ResearchProduct[]; researchedAt: string };

export const normalizeResearch = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const FINANCIAL = /\b(?:meus?|minhas?|minha|meu)\s+(?:gastos?|despesas?|receitas?|renda|saldo|fatura|cart(?:ao|oes)|metas?|contas?|limites?|orcamento)\b|\b(?:gastei|paguei|recebi|ganhei|transferi|cancele|cancelar|registra|registrar|lancei|comprei|guardei)\b/;
const PRODUCT = /\b(?:celular(?:es)?|smartphones?|iphones?|galaxy|motorola|samsung|notebooks?|laptops?|computadores?|pc|televisao|tv|monitores?|geladeiras?|fogao|maquina de lavar|fones?|cameras?|tablets?|produtos?|modelos?|eletrodomesticos?|aspiradores?|ar condicionado)\b/;
const PRICE_WORD = String.raw`(?:R\$\s*)?(?:\d{1,3}(?:\.\d{3})+|\d{1,6})(?:,\d{2})?`;
const CONCEPT_TITLES: Record<string, string> = {
  cdi: "Certificado de Depósito Interbancário",
  ipca: "Índice Nacional de Preços ao Consumidor Amplo",
  ip68: "Grau de proteção IP",
  oled: "Diodo orgânico emissor de luz",
  qled: "QLED",
  arm: "Arquitetura ARM",
  inverter: "Inversor de frequência",
  selic: "Taxa Selic",
  cdb: "Certificado de depósito bancário",
  cashback: "Cashback",
  "juros compostos": "Juros compostos",
};

export function researchConcepts(text: string): Array<{ term: string; query: string }> {
  const t = normalizeResearch(text);
  return Object.entries(CONCEPT_TITLES)
    .filter(([term]) => new RegExp(`\\b${term.replaceAll(" ", "\\s+")}\\b`, "i").test(t))
    .map(([term, query]) => ({ term: term.toUpperCase(), query }))
    .slice(0, 2);
}

export function isProductImageCaption(text: string): boolean {
  const t = normalizeResearch(text);
  return /\b(?:pesquis[ae]|procur[ae]|compare|vale a pena)\b/.test(t) &&
    /\b(?:produto|modelo|celular|tv|notebook|esse|essa|este|esta)\b/.test(t) &&
    !FINANCIAL.test(t);
}

export function comparisonNames(text: string): string[] {
  const raw = text.trim().replace(/[?.!]+$/, "");
  const match = /^(?:compare|comparar|qual (?:é|e) a diferença entre|qual a diferença entre)\s+(.+)$/i.exec(raw);
  if (!match) return [];
  const body = match[1].trim();
  const commaParts = body.split(/\s*,\s*/);
  let parts: string[];
  if (commaParts.length === 3) {
    parts = commaParts.map((part, i) => i === 2 ? part.replace(/^e\s+/i, "") : part);
  } else if (commaParts.length === 2 && /\s+e\s+/i.test(commaParts[1])) {
    parts = [commaParts[0], ...commaParts[1].split(/\s+e\s+/i)];
  } else if (commaParts.length === 1) {
    parts = body.split(/\s+e\s+/i);
    if (parts.length === 3) {
      // Três nomes sem vírgula só são seguros quando cada segmento começa
      // com uma família/marca de produto; caso contrário, pedir separação.
      const startsProduct = /^(?:galaxy|motorola|moto|iphone|samsung|xiaomi|redmi|pixel|lenovo|dell|hp|acer|asus|lg|sony|nokia|macbook|notebook|tv|bose|jbl)\b/i;
      if (!parts.every(part => startsProduct.test(part))) return [];
    }
  } else return [];
  if (parts.length < 2 || parts.length > 3) return [];
  const names = parts.map(x => x.replace(/^(?:o|a|um|uma)\s+/i, "").trim());
  return names.every(x => x.length >= 2 && x.length <= 70 && !/https?:\/\//i.test(x)) ? names : [];
}

function parseAmount(raw: string): number | null {
  const amount = Number(raw.replace(/R\$\s*/i, "").replaceAll(".", "").replace(",", "."));
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 100_000_000 ? cents : null;
}

export function parseUserPriceCents(text: string): number | null {
  const t = normalizeResearch(text);
  const match = new RegExp(`\\b(?:achei(?:\\s+.{1,45}?)?\\s+por|est(?:a|ao)\\s+(?:por\\s+)?|custa\\s+|esse\\s+por\\s+|por\\s+)(${PRICE_WORD})(?=\\s|[.!?,;]|$)`, "i").exec(t);
  return match ? parseAmount(match[1]) : null;
}

export function parseInstallmentOffer(text: string): { count: number; installmentCents: number; totalCents: number } | null {
  const t = normalizeResearch(text);
  const match = new RegExp(`(?:^|\\s)(\\d{1,2})\\s*x\\s*de\\s*(${PRICE_WORD})(?=\\s|[.!?,;]|$)`, "i").exec(t);
  if (!match) return null;
  const count = Number(match[1]);
  const installmentCents = parseAmount(match[2]);
  const totalCents = installmentCents === null ? 0 : count * installmentCents;
  return Number.isInteger(count) && count >= 2 && count <= 24 && Number.isSafeInteger(totalCents) && totalCents <= 100_000_000
    ? { count, installmentCents: installmentCents!, totalCents }
    : null;
}

export function namedUserPrices(text: string): Array<{ name: string; priceCents: number }> {
  const t = normalizeResearch(text);
  const pair = new RegExp(`^(.{2,60}?)\\s+(?:esta|custa)\\s+(${PRICE_WORD})\\s+e\\s+(.{2,60}?)\\s+(?:esta|custa)?\\s*(${PRICE_WORD})(?=\\s|[.!?,;]|$)`, "i").exec(t);
  if (!pair) return [];
  const first = parseAmount(pair[2]);
  const second = parseAmount(pair[4]);
  if (!first || !second) return [];
  const names = [pair[1], pair[3]].map(x => x.trim());
  if (names.some(x => x.length < 2 || x.length > 60 || /https?:\/\//.test(x))) return [];
  return [{ name: names[0], priceCents: first }, { name: names[1], priceCents: second }];
}

export function isCurrentPriceQuestion(text: string): boolean {
  const t = normalizeResearch(text);
  return /\b(?:quanto custa|onde (?:esta|ta) mais barato|menor preco|preco atual|ofertas? (?:atuais|de|do|da)|mais barato entre lojas)\b/.test(t);
}

export function detectResearchIntent(text: string, hasContext: boolean): ResearchIntent | null {
  const t = normalizeResearch(text);
  if (!t || t.length > 700 || (FINANCIAL.test(t) && !/\bcabe no meu orcamento\b/.test(t))) return null;
  if (t === "pesquisa inteligente" || t === "pesquisar com ia") return "general";
  if (hasContext && (parseInstallmentOffer(t) !== null || parseUserPriceCents(t) !== null || /\b(?:cabe no meu orcamento|consigo comprar|em \d{1,2}\s*(?:x|vezes)|parcelar em \d{1,2}|qual (?:tem|e) melhor|qual (?:tem|e) .{1,30} melhor|compare|mais opcoes|mais detalhes|mais barato|preco esta bom|quanto custa|pessoas reclamam|avaliacoes|problema conhecido)\b/.test(t))) return "followup";
  if (namedUserPrices(t).length === 2) return "compare";
  if (isCurrentPriceQuestion(t)) return "product";
  if (comparisonNames(t).length >= 2) return researchConcepts(t).length === 2 ? "general" : "compare";
  if (/^(?:compare|comparar)\s+/.test(t)) return "compare";
  if (/^(?:o que e|qual a diferenca entre|como funciona|explique|o que significa)\b/.test(t) && researchConcepts(t).length) return "general";
  if (/\b(?:pesquis[ae]|procur[ae]|busqu[ae]|encontr[ae])\b/.test(t) && researchConcepts(t).length && !PRODUCT.test(t)) return "general";
  if (/\b(?:pesquis[ae]|procur[ae]|busqu[ae]|encontr[ae]|opcoes|mais barato|quanto custa)\b/.test(t) && PRODUCT.test(t)) return "product";
  if (/\b(?:vale (?:mais )?a pena|comparacao|reviews?|avaliacoes)\b/.test(t) && PRODUCT.test(t)) return "compare";
  if (/^(?:pesquis[ae]|procur[ae])\b/.test(t)) return "product";
  return null;
}

export function parseInstallments(text: string): number | null {
  const m = /(?:\bem\s*(\d{1,2})\s*(?:x|vezes)\b|\bparcelar\s+em\s+(\d{1,2})\b)/i.exec(normalizeResearch(text));
  const count = Number(m?.[1] ?? m?.[2]);
  return Number.isInteger(count) && count >= 2 && count <= 24 ? count : null;
}

export function splitInstallments(cents: number, count: number): number[] {
  if (!Number.isSafeInteger(cents) || cents <= 0 || !Number.isInteger(count) || count < 2 || count > 24) throw new Error("invalid installment input");
  const base = Math.floor(cents / count);
  const remainder = cents % count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

export const brl = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export function budgetComparison(capCents: number, spentCents: number, priceCents: number): string {
  if (![capCents, spentCents, priceCents].every(Number.isSafeInteger) || capCents <= 0 || spentCents < 0 || priceCents <= 0) throw new Error("invalid budget input");
  const remaining = capCents - spentCents;
  const percent = remaining > 0 ? Math.round((priceCents / remaining) * 100) : null;
  const budgetState = remaining >= 0
    ? `há ${brl(remaining)} ainda não usado nos lançamentos`
    : `os lançamentos já ultrapassaram o limite em ${brl(-remaining)}`;
  return `No orçamento total de ${brl(capCents)} deste mês, ${budgetState}. ` +
    `Esse preço é ${percent === null ? "maior que o valor restante" : `${percent}% do valor restante`}. ` +
    "Isso não é saldo bancário nem confirmação de que a compra cabe nas suas finanças: contas futuras, faturas e gastos não lançados podem mudar o cenário.";
}

export function safeSourceUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 300) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password ||
        /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname) || url.hostname.endsWith(".local")) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}
