/**
 * Brand logos registry.
 *
 * Resolves a logo URL for banks/issuers and merchants by name. If no logo
 * file exists for the given key, returns `null` and the UI shows an elegant
 * fallback (initial inside a colored circle).
 *
 * Local files should live under:
 *   /public/logos/bancos/<slug>.svg|png
 *   /public/logos/empresas/<slug>.svg|png
 *
 * Until those files are added, the fallback is used automatically.
 */

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

/** Slugify normalized name into kebab-case (for filenames). */
function toSlug(normalized: string): string {
  return normalized.replace(/\s+/g, "-");
}

/* -------------------- Bancos / emissores -------------------- */

/**
 * Map of normalized name (or alias) -> canonical slug used as filename in
 * /public/logos/bancos/. Add aliases here as users type variations.
 */
const BANK_ALIASES: Record<string, string> = {
  "nubank": "nubank",
  "nu pagamentos": "nubank",
  "nu": "nubank",
  "mercado pago": "mercado-pago",
  "mercadopago": "mercado-pago",
  "mp": "mercado-pago",
  "inter": "inter",
  "banco inter": "inter",
  "itau": "itau",
  "itau unibanco": "itau",
  "santander": "santander",
  "bradesco": "bradesco",
  "caixa": "caixa",
  "caixa economica": "caixa",
  "caixa economica federal": "caixa",
  "cef": "caixa",
  "banco do brasil": "banco-do-brasil",
  "bb": "banco-do-brasil",
  "picpay": "picpay",
  "neon": "neon",
  "c6": "c6-bank",
  "c6 bank": "c6-bank",
  "will bank": "will-bank",
  "will": "will-bank",
};

/** Brand color suggestion per bank (used for fallback bubble bg). */
const BANK_COLOR: Record<string, string> = {
  "nubank": "#820ad1",
  "mercado-pago": "#00b1ea",
  "inter": "#ff7a00",
  "itau": "#ec7000",
  "santander": "#ec0000",
  "bradesco": "#cc092f",
  "caixa": "#1c5aa8",
  "banco-do-brasil": "#fae128",
  "picpay": "#21c25e",
  "neon": "#00d563",
  "c6-bank": "#1f1f1f",
  "will-bank": "#0f9b5e",
};

/* -------------------- Empresas / merchants -------------------- */

const MERCHANT_ALIASES: Record<string, string> = {
  "spotify": "spotify",
  "apple": "apple",
  "apple com bill": "apple",
  "itunes": "apple",
  "uber": "uber",
  "uber trip": "uber",
  "uber eats": "uber-eats",
  "ifood": "ifood",
  "i food": "ifood",
  "netflix": "netflix",
  "amazon": "amazon",
  "amazon prime": "amazon",
  "amazon br": "amazon",
  "google": "google",
  "google play": "google",
  "google one": "google",
  "youtube": "youtube",
  "youtube premium": "youtube",
  "mercado livre": "mercado-livre",
  "mercadolivre": "mercado-livre",
  "ml": "mercado-livre",
  "adobe": "adobe",
  "microsoft": "microsoft",
  "microsoft 365": "microsoft",
  "office 365": "microsoft",
  "xbox": "microsoft",
};

const MERCHANT_COLOR: Record<string, string> = {
  "spotify": "#1db954",
  "apple": "#111111",
  "uber": "#111111",
  "uber-eats": "#06c167",
  "ifood": "#ea1d2c",
  "netflix": "#e50914",
  "amazon": "#ff9900",
  "google": "#4285f4",
  "youtube": "#ff0000",
  "mercado-livre": "#fff159",
  "adobe": "#fa0f00",
  "microsoft": "#0078d4",
};

/* -------------------- Resolution -------------------- */

export type BrandResolved = {
  /** Canonical slug (or null if unknown) */
  slug: string | null;
  /** Public URL to the local logo file (may 404 until file is added) */
  logoUrl: string | null;
  /** Suggested brand color for fallback bubble background */
  brandColor: string | null;
  /** First letter for fallback */
  initial: string;
};

function resolve(
  name: string | undefined | null,
  aliasMap: Record<string, string>,
  colorMap: Record<string, string>,
  folder: "bancos" | "empresas",
): BrandResolved {
  const norm = normalizeName(name);
  const initial = (norm[0] || "?").toUpperCase();
  if (!norm) return { slug: null, logoUrl: null, brandColor: null, initial };

  // Direct alias hit
  let slug = aliasMap[norm];

  // Fallback: see if any alias is a substring (e.g. "ifood delivery sp")
  if (!slug) {
    for (const key of Object.keys(aliasMap)) {
      if (norm.includes(key)) {
        slug = aliasMap[key];
        break;
      }
    }
  }

  // Last resort: try slug from normalized name itself
  if (!slug) {
    const guess = toSlug(norm);
    // Only treat as known if we have a brand color for it
    if (colorMap[guess]) slug = guess;
  }

  if (!slug) return { slug: null, logoUrl: null, brandColor: null, initial };

  return {
    slug,
    logoUrl: `/logos/${folder}/${slug}.svg`,
    brandColor: colorMap[slug] ?? null,
    initial,
  };
}

export function getBankLogo(name: string | undefined | null): BrandResolved {
  return resolve(name, BANK_ALIASES, BANK_COLOR, "bancos");
}

export function getMerchantLogo(name: string | undefined | null): BrandResolved {
  return resolve(name, MERCHANT_ALIASES, MERCHANT_COLOR, "empresas");
}
