/**
 * Resolução automática de domínio para marcas / estabelecimentos.
 *
 * Combina:
 *  - mapa seed de marcas conhecidas (Brasil + globais)
 *  - heurística por sufixo TLD a partir do nome normalizado
 *  - extração de domínio quando o usuário já informou uma URL
 */

import { normalizeMerchantName, slugifyMerchantName } from "./normalize";

const KNOWN_PUBLIC_SUFFIXES = new Set([
  "com.br",
  "com.mx",
  "com.ar",
  "com.co",
  "com.pe",
  "com.uy",
  "com.pt",
  "co.uk",
  "co.jp",
  "co.kr",
  "co.in",
  "co.za",
  "co.nz",
  "org.br",
  "net.br",
  "gov.br",
  "edu.br",
  "com.au",
  "com.tr",
  "com.sg",
  "com.hk",
]);

export function extractDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let raw = String(input).trim().toLowerCase();
  if (!raw) return null;
  raw = raw
    .replace(/^[a-z]+:\/\//, "")
    .split("/")[0]
    .split("?")[0]
    .split("#")[0];
  raw = (raw.split("@").pop() ?? raw).split(":")[0].replace(/^(www\.|m\.|app\.|web\.)/, "");
  if (!raw.includes(".") || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw)) return null;
  const parts = raw.split(".");
  if (parts.length <= 2) return raw;
  const lastTwo = parts.slice(-2).join(".");
  const lastThree = parts.slice(-3).join(".");
  return KNOWN_PUBLIC_SUFFIXES.has(lastTwo) ? lastThree : lastTwo;
}

/** Mapa seed: ajuda inicial para os casos mais comuns. */
export const SEED_BRAND_DOMAINS: Record<string, string> = {
  // Bancos BR
  nubank: "nubank.com.br",
  "nu pagamentos": "nubank.com.br",
  nu: "nubank.com.br",
  "mercado pago": "mercadopago.com.br",
  mercadopago: "mercadopago.com.br",
  "mercado livre": "mercadolivre.com.br",
  mercadolivre: "mercadolivre.com.br",
  picpay: "picpay.com",
  inter: "bancointer.com.br",
  "banco inter": "bancointer.com.br",
  "c6 bank": "c6bank.com.br",
  c6bank: "c6bank.com.br",
  c6: "c6bank.com.br",
  itau: "itau.com.br",
  "itau unibanco": "itau.com.br",
  bradesco: "bradesco.com.br",
  santander: "santander.com.br",
  "banco do brasil": "bb.com.br",
  bb: "bb.com.br",
  caixa: "caixa.gov.br",
  "caixa economica": "caixa.gov.br",
  "caixa economica federal": "caixa.gov.br",
  pagseguro: "pagseguro.uol.com.br",
  pagbank: "pagseguro.uol.com.br",
  "will bank": "willbank.com.br",
  willbank: "willbank.com.br",
  neon: "neon.com.br",
  next: "next.me",
  meli: "mercadopago.com.br",
  "meli mais": "mercadopago.com.br",
  "meli+": "mercadopago.com.br",
  melimais: "mercadopago.com.br",
  "mp melimais": "mercadopago.com.br",
  "mp meli": "mercadopago.com.br",
  "mercado pago meli": "mercadopago.com.br",
  original: "original.com.br",
  safra: "safra.com.br",
  sicoob: "sicoob.com.br",
  sicredi: "sicredi.com.br",
  btg: "btgpactual.com",
  "btg pactual": "btgpactual.com",
  xp: "xpi.com.br",
  "xp investimentos": "xpi.com.br",
  rico: "rico.com.vc",

  // Plataformas
  hotmart: "hotmart.com",
  kiwify: "kiwify.com.br",
  eduzz: "eduzz.com",
  monetizze: "monetizze.com.br",
  spotify: "spotify.com",
  netflix: "netflix.com",
  amazon: "amazon.com.br",
  "amazon prime": "amazon.com.br",
  "prime video": "primevideo.com",
  google: "google.com",
  "google play": "play.google.com",
  "google cloud": "cloud.google.com",
  apple: "apple.com",
  xiaomi: "mi.com",
  mi: "mi.com",
  icloud: "icloud.com",
  itunes: "apple.com",
  microsoft: "microsoft.com",
  office: "microsoft.com",
  "office 365": "microsoft.com",
  xbox: "xbox.com",
  playstation: "playstation.com",
  steam: "steampowered.com",
  guppy: "gupy.io",
  gupy: "gupy.io",
  lovable: "lovable.dev",
  "chat gpt": "openai.com",
  chatgpt: "openai.com",
  openai: "openai.com",
  anthropic: "anthropic.com",
  claude: "claude.ai",
  midjourney: "midjourney.com",

  // Delivery / mobilidade
  ifood: "ifood.com.br",
  uber: "uber.com",
  "uber eats": "ubereats.com",
  "uber trip": "uber.com",
  "99": "99app.com",
  "99 app": "99app.com",
  "99app": "99app.com",
  "99 pop": "99app.com",
  rappi: "rappi.com.br",
  cabify: "cabify.com",
  blablacar: "blablacar.com.br",

  // E-commerce
  renner: "lojasrenner.com.br",
  "lojas renner": "lojasrenner.com.br",
  "magazine luiza": "magazineluiza.com.br",
  magalu: "magazineluiza.com.br",
  americanas: "americanas.com.br",
  submarino: "submarino.com.br",
  "casas bahia": "casasbahia.com.br",
  "ponto frio": "pontofrio.com.br",
  shopee: "shopee.com.br",
  shein: "shein.com",
  aliexpress: "aliexpress.com",
  "amazon marketplace": "amazon.com.br",
  centauro: "centauro.com.br",
  nike: "nike.com.br",
  adidas: "adidas.com.br",
  zara: "zara.com",
  cea: "cea.com.br",
  "c&a": "cea.com.br",
  riachuelo: "riachuelo.com.br",
  marisa: "marisa.com.br",

  // Streaming / midia
  youtube: "youtube.com",
  "youtube premium": "youtube.com",
  "youtube music": "music.youtube.com",
  disney: "disneyplus.com",
  "disney plus": "disneyplus.com",
  hbo: "max.com",
  "hbo max": "max.com",
  max: "max.com",
  globoplay: "globoplay.com",
  globo: "globoplay.com",
  deezer: "deezer.com",
  tidal: "tidal.com",
  paramount: "paramountplus.com",
  "paramount plus": "paramountplus.com",
  "apple tv": "tv.apple.com",
  "apple music": "music.apple.com",
  twitch: "twitch.tv",

  // Devs / produtividade
  adobe: "adobe.com",
  figma: "figma.com",
  notion: "notion.so",
  slack: "slack.com",
  github: "github.com",
  gitlab: "gitlab.com",
  linkedin: "linkedin.com",
  vercel: "vercel.com",
  cloudflare: "cloudflare.com",
  aws: "aws.amazon.com",
  supabase: "supabase.com",
  stripe: "stripe.com",

  // Sociais
  instagram: "instagram.com",
  facebook: "facebook.com",
  whatsapp: "whatsapp.com",
  tiktok: "tiktok.com",
  x: "x.com",
  twitter: "x.com",

  // Telecom
  tim: "tim.com.br",
  vivo: "vivo.com.br",
  claro: "claro.com.br",
  oi: "oi.com.br",
  algar: "algartelecom.com.br",
  sky: "sky.com.br",

  // Combustível / utilidades
  shell: "shell.com.br",
  ipiranga: "ipiranga.com.br",
  petrobras: "petrobras.com.br",
  br: "br.com.br",
  enel: "enel.com.br",
  cpfl: "cpfl.com.br",
  light: "light.com.br",
  sabesp: "sabesp.com.br",
  "conta de agua": "sabesp.com.br",
  "conta de água": "sabesp.com.br",
  agua: "sabesp.com.br",
  água: "sabesp.com.br",
  "conta de luz": "enel.com.br",
  luz: "enel.com.br",
  "energia eletrica": "enel.com.br",
  "energia elétrica": "enel.com.br",
  comgas: "comgas.com.br",

  // Supermercados / varejo BR
  carrefour: "carrefour.com.br",
  extra: "extra.com.br",
  "pao de acucar": "paodeacucar.com",
  assai: "assai.com.br",
  atacadao: "atacadao.com.br",
  dia: "dia.com.br",
  "sams club": "samsclub.com.br",
  cobasi: "cobasi.com.br",
  petz: "petz.com.br",
  raia: "drogaraia.com.br",
  drogaraia: "drogaraia.com.br",
  drogasil: "drogasil.com.br",
  pacheco: "drogariaspacheco.com.br",
  "drogaria pacheco": "drogariaspacheco.com.br",
  "drogaria sao paulo": "drogariasaopaulo.com.br",
  "drogarias sao paulo": "drogariasaopaulo.com.br",
  dsp: "drogariasaopaulo.com.br",
  panvel: "panvel.com",
  "pague menos": "paguemenos.com.br",
  ultrafarma: "ultrafarma.com.br",
  oxxo: "oxxo.com.br",
  bobs: "bobs.com.br",
  "bob's": "bobs.com.br",
  "bacio di latte": "baciodilatte.com.br",
  bacio: "baciodilatte.com.br",
  "giuliana flores": "giulianaflores.com.br",
  giuliana: "giulianaflores.com.br",
  havanna: "havanna.com.br",
  starbucks: "starbucks.com.br",
  mcdonalds: "mcdonalds.com.br",
  "mc donalds": "mcdonalds.com.br",
  "burger king": "burgerking.com.br",
  bk: "burgerking.com.br",
  subway: "subway.com.br",
  kfc: "kfc.com.br",
  outback: "outback.com.br",
  habibs: "habibs.com.br",
  spoleto: "spoleto.com.br",
  "china in box": "chinainbox.com.br",
  "pizza hut": "pizzahut.com.br",
  dominos: "dominos.com.br",
  totalpass: "totalpass.com",
  gympass: "gympass.com",
  wellhub: "wellhub.com",
  smartfit: "smartfit.com.br",

  // Educação
  coursera: "coursera.org",
  udemy: "udemy.com",
  alura: "alura.com.br",
  rocketseat: "rocketseat.com.br",
  duolingo: "duolingo.com",
};

/**
 * Resultado da geração de palpites: o domínio + se ele veio do mapa
 * SEED (confiável) ou é apenas um chute por TLD.
 */
type DomainGuess = { domain: string; trusted: boolean };

export function guessDomainsFromName(name: string | null | undefined): DomainGuess[] {
  const norm = normalizeMerchantName(name);
  if (!norm) return [];

  const out: DomainGuess[] = [];
  const seen = new Set<string>();
  const push = (d: string, trusted: boolean) => {
    if (!d || seen.has(d)) return;
    seen.add(d);
    out.push({ domain: d, trusted });
  };

  if (SEED_BRAND_DOMAINS[norm]) push(SEED_BRAND_DOMAINS[norm], true);

  const firstWord = norm.split(" ")[0];
  if (firstWord && firstWord !== norm && SEED_BRAND_DOMAINS[firstWord]) {
    push(SEED_BRAND_DOMAINS[firstWord], true);
  }
  const firstTwo = norm.split(" ").slice(0, 2).join(" ");
  if (firstTwo && firstTwo !== norm && SEED_BRAND_DOMAINS[firstTwo]) {
    push(SEED_BRAND_DOMAINS[firstTwo], true);
  }

  // Palpites por TLD — não confiáveis, só passamos por Logo.dev (que dá 404
  // honesto para domínios inexistentes, diferente de Google s2/DuckDuckGo
  // que devolvem um favicon genérico cinza).
  const slug = slugifyMerchantName(name);
  for (const base of [slug, firstWord]) {
    if (!base || base.length < 3) continue;
    for (const tld of [".com.br", ".com", ".io", ".dev", ".app", ".co", ".net"]) {
      push(`${base}${tld}`, false);
    }
  }
  return out;
}

export const LOGO_DEV_PUBLIC_TOKEN =
  (import.meta as any).env?.VITE_LOGO_DEV_KEY || "pk_X-1ZO13ESQOXMI5MlVUVQQ";

/**
 * Gera URLs candidatas para um domínio em ordem de qualidade.
 * Priorizamos Logo.dev em alta resolução; depois tentamos provedores que
 * costumam entregar ícones maiores. O componente rejeita imagens minúsculas
 * no carregamento, evitando favicon borrado esticado.
 */
export function logoUrlsForDomain(domain: string, trusted = true): string[] {
  const urls = [
    // Logo.dev em alta resolução — a melhor opção quando a marca existe.
    `https://img.logo.dev/${domain}?token=${LOGO_DEV_PUBLIC_TOKEN}&size=256&format=png&retina=true`,
  ];
  if (!trusted) {
    urls.push(`https://favicon.im/${domain}?larger=true`);
    urls.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=256`);
    return urls;
  }
  if (trusted) {
    // Rede de segurança para domínios explícitos ou mapeados no SEED.
    urls.push(`https://favicon.im/${domain}?larger=true`);
    urls.push(`https://favicon.yandex.net/favicon/v2/${domain}?size=120`);
    urls.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=256`);
    urls.push(`https://icons.duckduckgo.com/ip3/${domain}.ico`);
  }
  return urls;
}

/**
 * Overrides locais para marcas que Logo.dev / DuckDuckGo / Google não
 * conseguem entregar com qualidade. Aplicados ANTES da cascata externa.
 */
export const LOCAL_LOGO_OVERRIDES: Record<string, string> = {
  oxxo: "/logos/empresas/oxxo.webp",
  "drogaria sao paulo": "/logos/empresas/drogaria-sao-paulo.webp",
  "drogarias sao paulo": "/logos/empresas/drogaria-sao-paulo.webp",
  dsp: "/logos/empresas/drogaria-sao-paulo.webp",
  "chat gpt": "/logos/empresas/chatgpt.svg",
  chatgpt: "/logos/empresas/chatgpt.svg",
  openai: "/logos/empresas/chatgpt.svg",
  "open ai": "/logos/empresas/chatgpt.svg",
  "magazine luiza": "/logos/empresas/magalu.svg",
  magazineluiza: "/logos/empresas/magalu.svg",
  magalu: "/logos/empresas/magalu.svg",
  xiaomi: "/logos/empresas/xiaomi.svg",
  mi: "/logos/empresas/xiaomi.svg",
};

export function getLogoCandidates(
  domain: string | null | undefined,
  name?: string | null,
  opts?: { trustedOnly?: boolean },
): string[] {
  const trustedOnly = opts?.trustedOnly === true;
  const urls: string[] = [];
  const seen = new Set<string>();
  const pushUrl = (u: string) => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  };
  const pushFor = (d: string, trusted: boolean) => {
    const norm = extractDomain(d) ?? d;
    if (!norm) return;
    for (const u of logoUrlsForDomain(norm, trusted)) pushUrl(u);
  };

  // 1) Override local (asset estático no /public).
  const normName = normalizeMerchantName(name);
  if (normName && LOCAL_LOGO_OVERRIDES[normName]) {
    pushUrl(LOCAL_LOGO_OVERRIDES[normName]);
  }
  const firstWord = normName.split(" ")[0];
  if (firstWord && firstWord !== normName && LOCAL_LOGO_OVERRIDES[firstWord]) {
    pushUrl(LOCAL_LOGO_OVERRIDES[firstWord]);
  }

  // 2) Domínio explicitamente fornecido pelo dado — confiável.
  if (domain) pushFor(domain, true);

  // 3) Palpites a partir do nome.
  //    Em modo trustedOnly, ignoramos chutes por TLD (que costumam cair em
  //    favicons genéricos e causam "flicker" antes de aparecer o ícone da
  //    categoria). Só passam hits explícitos do SEED.
  for (const guess of guessDomainsFromName(name)) {
    if (trustedOnly && !guess.trusted) continue;
    pushFor(guess.domain, guess.trusted);
  }
  return urls;
}

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
