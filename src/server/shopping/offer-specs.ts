/**
 * Especificações e rótulos de ofertas (puro). Usado na filtragem e na exibição,
 * inclusive de ofertas vindas do contexto salvo (deriva tudo de título/URL).
 * Espelhado em scripts/serpapi-shopping-smoke.mjs (standalone, sem imports do app).
 */
export const norm = (s: string) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Condição não-nova: vale mesmo se o texto também disser "novo". */
export const NAO_NOVO = /\b(usad[oa]s?|seminov[oa]s?|semi[- ]nov[oa]s?|recondicionad[oa]s?|refurbished|renewed|reembalad[oa]s?|mostruario|vitrine|open[- ]?box|unsealed|desembalad[oa]|(?:com )?caixa aberta|embalagem aberta|lacre (?:rompido|violado)|segunda mao|pre[- ]owned)\b/;

export type Specs = { chips: string[]; air: boolean; pro: boolean; ram: number[]; ssd: number[]; screens: number[] };
const uniq = (a: number[]) => [...new Set(a)];
const SSD_OK = new Set([128, 256, 512, 1024, 2048, 4096]);

export function extractSpecs(text: string): Specs {
  const t = norm(text);
  const chips = [...new Set([...t.matchAll(/\bm(\d)\b/g)].map((m) => `m${m[1]}`))];
  const ram = uniq([...t.matchAll(/\b(\d{1,2})\s?gb\b/g)].map((m) => Number(m[1])).filter((n) => n >= 4 && n <= 64));
  const ssd = uniq([
    ...[...t.matchAll(/\b(\d{3,4})\s?g(?:b)?\b/g)].map((m) => Number(m[1])).filter((n) => SSD_OK.has(n)),
    ...[...t.matchAll(/\b(\d)\s?tb\b/g)].map((m) => Number(m[1]) * 1024),
  ]);
  const screens = uniq([...t.matchAll(/\b(13|15)(?:[.,]\d)?\b(?!\s?(?:gb|tb|g\b|x\b|vezes|parcelas))/g)].map((m) => Number(m[1])));
  return { chips, air: /\bair\b/.test(t), pro: /\bpro\b/.test(t), ram, ssd, screens };
}

/** Compatível com o pedido? Sem evidência do atributo pedido → recusa. Tela/SSD múltiplos → sempre recusa. */
export function compativel(titulo: string, query: string): boolean {
  const t = extractSpecs(titulo);
  const q = extractSpecs(query);
  if (t.screens.length > 1 || t.ssd.length > 1 || t.ram.length > 1) return false; // "13 e 15" por um preço: nunca adivinhar
  if (q.chips.length && (!t.chips.includes(q.chips[0]) || t.chips.some((c) => c !== q.chips[0]))) return false;
  if (q.air && (!t.air || t.pro)) return false;
  if (q.pro && !t.pro) return false;
  if (q.ram.length && (t.ram.length !== 1 || t.ram[0] !== q.ram[0])) return false;
  if (q.ssd.length && (t.ssd.length !== 1 || t.ssd[0] !== q.ssd[0])) return false;
  if (q.screens.length && (t.screens.length !== 1 || t.screens[0] !== q.screens[0])) return false;
  return true;
}

const fmtSsd = (g: number) => (g >= 1024 ? `${g / 1024}TB` : `${g}GB`);
export function rotuloVariante(titulo: string): string {
  const s = extractSpecs(titulo);
  return `Tela ${s.screens[0] ? `${s.screens[0]}"` : "não informada"} · SSD ${s.ssd[0] ? fmtSsd(s.ssd[0]) : "não informado"}`;
}
export function chaveVariante(titulo: string): string {
  const s = extractSpecs(titulo);
  return `${s.screens[0] ?? "?"}|${s.ssd[0] ?? "?"}`;
}
/** Ofertas com tela/SSD diferentes (ou não informados) não podem ser ranqueadas como o mesmo produto. */
export function variantesMisturadas(titulos: string[]): boolean {
  const k = titulos.map(chaveVariante);
  return new Set(k).size > 1 || k.some((x) => x.includes("?"));
}

export const isGoogleHost = (url: string) => {
  try { return /(^|\.)google\.[a-z.]+$/.test(new URL(url).hostname.toLowerCase()); } catch { return false; }
};
export const rotuloLink = (url: string) => (isGoogleHost(url) ? "Ver no Google Shopping" : "Link direto da loja");
export const MSG_ESCOLHA_VARIANTE =
  "Os anúncios têm tela/SSD diferentes ou não informados, então não digo qual é o mais barato. Diga a tela (13\" ou 15\") e o SSD (ex.: 256GB) para comparar o mesmo produto.";
