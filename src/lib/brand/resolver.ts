/**
 * Resolução automática de domínio para marcas / estabelecimentos.
 *
 * Combina:
 *  - mapa seed de marcas conhecidas (Brasil + globais)
 *  - heurística por sufixo TLD a partir do nome normalizado
 *  - extração de domínio quando o usuário já informou uma URL
 *
 * Não consulta DB aqui — apenas lógica pura. O resolver server-side
 * (brand.functions.ts) usa este módulo para gerar candidatos e
 * persistir o resultado em `brand_assets` / `merchant_brand_aliases`.
 */

import { normalizeMerchantName, slugifyMerchantName } from "./normalize";

const KNOWN_PUBLIC_SUFFIXES = new Set([
  "com.br","com.mx","com.ar","com.co","com.pe","com.uy","com.pt",
  "co.uk","co.jp","co.kr","co.in","co.za","co.nz",
  "org.br","net.br","gov.br","edu.br",
  "com.au","com.tr","com.sg","com.hk",
]);

/** Extrai o domínio principal a partir de uma URL ou string livre. */
export function extractDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let raw = String(input).trim().toLowerCase();
  if (!raw) return null;
  raw = raw.replace(/^[a-z]+:\/\//, "").split("/")[0]
           .split("?")[0].split("#")[0];
  raw = (raw.split("@").pop() ?? raw).split(":")[0]
           .replace(/^(www\.|m\.|app\.|web\.)/, "");
  if (!raw.includes(".") || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw)) return null;
  const parts = raw.split(".");
  if (parts.length <= 2) return raw;
  const lastTwo = parts.slice(-2).join(".");
  const lastThree = parts.slice(-3).join(".");
  return KNOWN_PUBLIC_SUFFIXES.has(lastTwo) ? lastThree : lastTwo;
}

/** Mapa seed: ajuda inicial para os casos mais comuns no Brasil. */
export const SEED_BRAND_DOMAINS: Record<string, string> = {
  "nubank": "nubank.com.br",
  "nu pagamentos": "nubank.com.br",
  "mercado pago": "mercadopago.com.br",
  "mercadopago": "mercadopago.com.br",
  "mercado livre": "mercadolivre.com.br",
  "mercadolivre": "mercadolivre.com.br",
  "picpay": "picpay.com",
  "inter": "bancointer.com.br",
  "banco inter": "bancointer.com.br",
  "c6 bank": "c6bank.com.br",
  "c6bank": "c6bank.com.br",
  "itau": "itau.com.br",
  "itaú": "itau.com.br",
  "bradesco": "bradesco.com.br",
  "santander": "santander.com.br",
  "banco do brasil": "bb.com.br",
  "bb": "bb.com.br",
  "caixa": "caixa.gov.br",
  "caixa economica": "caixa.gov.br",
  "pagseguro": "pagseguro.uol.com.br",
  "will bank": "willbank.com.br",
  "neon": "neon.com.br",
  "hotmart": "hotmart.com",
  "spotify": "spotify.com",
  "netflix": "netflix.com",
  "amazon": "amazon.com.br",
  "google": "google.com",
  "apple": "apple.com",
  "microsoft": "microsoft.com",
  "guppy": "guppy.io",
  "lovable": "lovable.dev",
  "chat gpt": "chatgpt.com",
  "chatgpt": "chatgpt.com",
  "openai": "openai.com",
  "ifood": "ifood.com.br",
  "uber": "uber.com",
  "uber eats": "ubereats.com",
  "rappi": "rappi.com.br",
  "renner": "lojasrenner.com.br",
  "lojas renner": "lojasrenner.com.br",
  "magazine luiza": "magazineluiza.com.br",
  "magalu": "magazineluiza.com.br",
  "americanas": "americanas.com.br",
  "shopee": "shopee.com.br",
  "aliexpress": "aliexpress.com",
  "youtube": "youtube.com",
  "youtube premium": "youtube.com",
  "disney": "disneyplus.com",
  "disney plus": "disneyplus.com",
  "hbo": "max.com",
  "hbo max": "max.com",
  "max": "max.com",
  "prime video": "primevideo.com",
  "globo": "globoplay.com",
  "globoplay": "globoplay.com",
  "adobe": "adobe.com",
  "github": "github.com",
  "linkedin": "linkedin.com",
  "instagram": "instagram.com",
  "facebook": "facebook.com",
  "whatsapp": "whatsapp.com",
  "tim": "tim.com.br",
  "vivo": "vivo.com.br",
  "claro": "claro.com.br",
  "oi": "oi.com.br",
};

/** Palpita domínios prováveis a partir do nome (várias TLDs). */
export function guessDomainsFromName(name: string | null | undefined): string[] {
  const norm = normalizeMerchantName(name);
  if (!norm) return [];
  if (SEED_BRAND_DOMAINS[norm]) return [SEED_BRAND_DOMAINS[norm]];

  const slug = slugifyMerchantName(name);
  const firstWord = norm.split(" ")[0];
  const out = new Set<string>();
  for (const base of [slug, firstWord]) {
    if (!base || base.length < 2) continue;
    for (const tld of [".com.br", ".com", ".io", ".dev", ".app", ".co"]) {
      out.add(`${base}${tld}`);
    }
  }
  return [...out];
}

/** Token público do Logo.dev — publishable, ok no frontend. */
export const LOGO_DEV_PUBLIC_TOKEN =
  (import.meta as any).env?.VITE_LOGO_DEV_KEY || "pk_X-1ZO13ESQOXMI5MlVUVQQ";

/** Constrói a cascata de URLs candidatas para um domínio. */
export function logoUrlsForDomain(domain: string): string[] {
  return [
    `https://img.logo.dev/${domain}?token=${LOGO_DEV_PUBLIC_TOKEN}&size=128&format=png`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
  ];
}

/** Cascata completa: domínio explícito + palpites por nome. */
export function getLogoCandidates(
  domain: string | null | undefined,
  name?: string | null,
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const pushFor = (d: string) => {
    const norm = extractDomain(d) ?? d;
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    urls.push(...logoUrlsForDomain(norm));
  };
  if (domain) pushFor(domain);
  for (const guess of guessDomainsFromName(name)) pushFor(guess);
  return urls;
}

/** Cor estável (HSL) derivada de uma seed string — para letter avatar. */
export function colorForSeed(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360} 55% 38%)`;
}

export function initialOfName(name: string | null | undefined): string {
  if (!name) return "?";
  const s = String(name).trim();
  return (s[0] ?? "?").toUpperCase();
}
