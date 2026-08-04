/**
 * Brand logos registry.
 *
 * All bank/merchant SVGs are imported statically via Vite so the bundler
 * fingerprints them and they're available immediately as URLs (no runtime
 * fetch path resolution). This eliminates the visual delay between card
 * color change and logo appearance.
 */

/* -------------------- Static imports (banks) -------------------- */
import bradescoUrl from "/public/logos/bancos/Banco_Bradesco.svg?url";
import bbUrl from "/public/logos/bancos/banco-do-brasil-novo.svg?url";
import interUrl from "/public/logos/bancos/banco-inter.svg?url";
import itauUrl from "/public/logos/bancos/banco-itau.svg?url";
import c6Url from "/public/logos/bancos/Logo_C6_Bank.svg?url";
import caixaUrl from "/public/logos/bancos/logo-caixa.svg?url";
import santanderUrl from "/public/logos/bancos/logo-santander.svg?url";
import mpUrl from "/public/logos/bancos/mercadopago-branco.svg?url";
import nubankUrl from "/public/logos/bancos/nubank.svg?url";
import picpayUrl from "/public/logos/bancos/picpay.svg?url";
import willUrl from "/public/logos/bancos/will-bank.svg?url";
import neonUrl from "/public/logos/bancos/neon.svg?url";

/* -------------------- Static imports (merchants) -------------------- */
import adobeUrl from "/public/logos/empresas/adobe.svg?url";
import amazonUrl from "/public/logos/empresas/amazon.svg?url";
import appleUrl from "/public/logos/empresas/apple.svg?url";
import cobasiUrl from "/public/logos/empresas/cobasi.svg?url";
import courseraUrl from "/public/logos/empresas/coursera.svg?url";
import googleUrl from "/public/logos/empresas/google.svg?url";
import ifoodUrl from "/public/logos/empresas/ifood.svg?url";
import mlUrl from "/public/logos/empresas/mercado-livre.svg?url";
import microsoftUrl from "/public/logos/empresas/microsoft.svg?url";
import netflixUrl from "/public/logos/empresas/netflix.svg?url";
import spotifyUrl from "/public/logos/empresas/spotify.svg?url";
import totalpassUrl from "/public/logos/empresas/totalpass.svg?url";
import uberEatsUrl from "/public/logos/empresas/uber-eats.svg?url";
import uberUrl from "/public/logos/empresas/uber.svg?url";
import youtubeUrl from "/public/logos/empresas/youtube.svg?url";

/** Normalize a free-form name for matching. Case/diacritics/whitespace insensitive. */
export function normalizeName(input: string | undefined | null): string {
  if (!input) return "";
  return input
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toSlug(normalized: string): string {
  return normalized.replace(/\s+/g, "-");
}

/* -------------------- Bancos -------------------- */

const BANK_URL: Record<string, string> = {
  nubank: nubankUrl,
  "mercadopago-branco": mpUrl,
  "banco-inter": interUrl,
  "banco-itau": itauUrl,
  "logo-santander": santanderUrl,
  Banco_Bradesco: bradescoUrl,
  "logo-caixa": caixaUrl,
  "banco-do-brasil": bbUrl,
  picpay: picpayUrl,
  neon: neonUrl,
  Logo_C6_Bank: c6Url,
  "will-bank": willUrl,
};

const BANK_ALIASES: Record<string, string> = {
  nubank: "nubank",
  "nu pagamentos": "nubank",
  nu: "nubank",
  "mercado pago": "mercadopago-branco",
  mercadopago: "mercadopago-branco",
  mp: "mercadopago-branco",
  inter: "banco-inter",
  "banco inter": "banco-inter",
  itau: "banco-itau",
  "itau unibanco": "banco-itau",
  santander: "logo-santander",
  bradesco: "Banco_Bradesco",
  caixa: "logo-caixa",
  "caixa economica": "logo-caixa",
  "caixa economica federal": "logo-caixa",
  cef: "logo-caixa",
  "banco do brasil": "banco-do-brasil",
  bb: "banco-do-brasil",
  picpay: "picpay",
  neon: "neon",
  c6: "Logo_C6_Bank",
  "c6 bank": "Logo_C6_Bank",
  "will bank": "will-bank",
  will: "will-bank",
};

const BANK_COLOR: Record<string, string> = {
  nubank: "#820ad1",
  "mercadopago-branco": "#00b1ea",
  "banco-inter": "#ff7a00",
  "banco-itau": "#ec7000",
  "logo-santander": "#ec0000",
  Banco_Bradesco: "#cc092f",
  "logo-caixa": "#1c5aa8",
  "banco-do-brasil": "#fae128",
  picpay: "#21c25e",
  neon: "#00d563",
  Logo_C6_Bank: "#1f1f1f",
  "will-bank": "#0f9b5e",
};

/* -------------------- Merchants -------------------- */

const MERCHANT_URL: Record<string, string> = {
  spotify: spotifyUrl,
  apple: appleUrl,
  uber: uberUrl,
  "uber-eats": uberEatsUrl,
  ifood: ifoodUrl,
  netflix: netflixUrl,
  amazon: amazonUrl,
  google: googleUrl,
  youtube: youtubeUrl,
  "mercado-livre": mlUrl,
  adobe: adobeUrl,
  microsoft: microsoftUrl,
  totalpass: totalpassUrl,
  cobasi: cobasiUrl,
  coursera: courseraUrl,
};

const MERCHANT_ALIASES: Record<string, string> = {
  spotify: "spotify",
  apple: "apple",
  "apple com bill": "apple",
  itunes: "apple",
  uber: "uber",
  "uber trip": "uber",
  "uber eats": "uber-eats",
  ifood: "ifood",
  "i food": "ifood",
  netflix: "netflix",
  amazon: "amazon",
  "amazon prime": "amazon",
  "amazon br": "amazon",
  google: "google",
  "google play": "google",
  "google one": "google",
  youtube: "youtube",
  "youtube premium": "youtube",
  "mercado livre": "mercado-livre",
  mercadolivre: "mercado-livre",
  ml: "mercado-livre",
  adobe: "adobe",
  microsoft: "microsoft",
  "microsoft 365": "microsoft",
  "office 365": "microsoft",
  xbox: "microsoft",
  totalpass: "totalpass",
  "total pass": "totalpass",
  gympass: "totalpass",
  cobasi: "cobasi",
  coursera: "coursera",
};

const MERCHANT_COLOR: Record<string, string> = {
  spotify: "#1db954",
  apple: "#111111",
  uber: "#111111",
  "uber-eats": "#06c167",
  ifood: "#ea1d2c",
  netflix: "#e50914",
  amazon: "#ff9900",
  google: "#4285f4",
  youtube: "#ff0000",
  "mercado-livre": "#fff159",
  adobe: "#fa0f00",
  microsoft: "#0078d4",
  totalpass: "#0a2540",
  cobasi: "#0072ce",
  coursera: "#0056d2",
};

/* -------------------- Resolution -------------------- */

export type BrandResolved = {
  slug: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  initial: string;
};

function resolve(
  name: string | undefined | null,
  aliasMap: Record<string, string>,
  urlMap: Record<string, string>,
  colorMap: Record<string, string>,
): BrandResolved {
  const norm = normalizeName(name);
  const initial = (norm[0] || "?").toUpperCase();
  if (!norm) return { slug: null, logoUrl: null, brandColor: null, initial };

  let slug = aliasMap[norm];
  if (!slug) {
    for (const key of Object.keys(aliasMap)) {
      if (norm.includes(key)) {
        slug = aliasMap[key];
        break;
      }
    }
  }
  if (!slug) {
    const guess = toSlug(norm);
    if (colorMap[guess]) slug = guess;
  }
  if (!slug) return { slug: null, logoUrl: null, brandColor: null, initial };

  return {
    slug,
    logoUrl: urlMap[slug] ?? null,
    brandColor: colorMap[slug] ?? null,
    initial,
  };
}

export function getBankLogo(name: string | undefined | null): BrandResolved {
  return resolve(name, BANK_ALIASES, BANK_URL, BANK_COLOR);
}

export function getMerchantLogo(name: string | undefined | null): BrandResolved {
  return resolve(name, MERCHANT_ALIASES, MERCHANT_URL, MERCHANT_COLOR);
}

export function hasMerchantLogo(name: string | undefined | null): boolean {
  return getMerchantLogo(name).slug !== null;
}

/** All bank logo URLs — useful for preloading on screens that swap cards. */
export const ALL_BANK_LOGO_URLS: ReadonlyArray<string> = Object.values(BANK_URL);
/** All merchant logo URLs — preload to make transaction lists feel instant. */
export const ALL_MERCHANT_LOGO_URLS: ReadonlyArray<string> = Object.values(MERCHANT_URL);

function preloadUrls(urls: ReadonlyArray<string>): void {
  if (typeof document === "undefined") return;
  for (const url of urls) {
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = url;
    link.type = "image/svg+xml";
    document.head.appendChild(link);
    const img = new Image();
    img.src = url;
  }
}

let _bankPreloaded = false;
export function preloadAllBankLogos(): void {
  if (_bankPreloaded) return;
  _bankPreloaded = true;
  preloadUrls(ALL_BANK_LOGO_URLS);
}

let _merchantPreloaded = false;
export function preloadAllMerchantLogos(): void {
  if (_merchantPreloaded) return;
  _merchantPreloaded = true;
  preloadUrls(ALL_MERCHANT_LOGO_URLS);
}
