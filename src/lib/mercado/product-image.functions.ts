/**
 * Mercado Inteligente — sugestão de imagem de produto
 * ----------------------------------------------------------------------------
 * Server fn que tenta achar uma imagem pública para um produto, sem armazenar
 * nada no Supabase e sem expor secrets. Fontes consultadas, em ordem:
 *
 *   1. Open Food Facts por barcode (alta confiança)
 *   2. Open Food Facts por nome + marca (confiança média)
 *   3. Logo de marca local (`/logos/empresas/*.svg`) — baixa confiança,
 *      sempre marcado como "logo de marca" pelo client.
 *   4. Nada → cliente cai no fallback visual por categoria.
 *
 * NÃO usa nenhum secret (OFF é público). Em qualquer erro/timeout devolve
 * `{ imageUrl: null, ... }` para nunca bloquear o fluxo de cadastro.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  cacheGet,
  cacheSet,
} from "./product-image-cache.server";
import { normalizeForKey } from "./product-image-key";
import { cleanProductName, isStrongMarketBrand } from "./product-name-clean";
import { validateImageUrl } from "./image-url-whitelist";

const InputSchema = z.object({
  productName: z.string().trim().min(2).max(200),
  brand: z.string().trim().max(100).optional().nullable(),
  barcode: z
    .string()
    .trim()
    .regex(/^\d{8,14}$/)
    .optional()
    .nullable(),
  category: z
    .preprocess(
      (v) => {
        const allowed = [
          "hortifruti",
          "acougue",
          "padaria",
          "bebidas",
          "laticinios",
          "limpeza",
          "mercearia",
          "utilidades",
        ];
        if (typeof v !== "string") return null;
        return allowed.includes(v) ? v : null;
      },
      z
        .enum([
          "hortifruti",
          "acougue",
          "padaria",
          "bebidas",
          "laticinios",
          "limpeza",
          "mercearia",
          "utilidades",
        ])
        .nullable(),
    )
    .optional(),
});

export type ProductImageInput = z.infer<typeof InputSchema>;

export type ProductImageSource =
  | "off_barcode"
  | "off_search"
  | "brand_logo"
  | null;

export type ProductImageConfidence = "high" | "medium" | "low" | null;

export type ProductImageDebug = {
  productName: string;
  brandReceived: string | null;
  cleanedName: string;
  normalizedName: string;
  extractedBrand: string | null;
  aliases: string[];
  barcode: string | null;
  attempts: Array<{
    query: string;
    brand: string | null;
    candidates: number;
    bestScore: number | null;
    bestCandidate?: string | null;
    bestBrands?: string | null;
    hadImage?: boolean;
    rejected: string | null;
  }>;
  pickedFrom: "barcode" | "search" | "brand_logo" | "none";
};

export type ProductImageResult = {
  imageUrl: string | null;
  source: ProductImageSource;
  confidence: ProductImageConfidence;
  /** Se a imagem pode ser gravada no banco; baixa confiança fica só em runtime. */
  persistable?: boolean;
  origin: "openfoodfacts" | "local" | null;
  checkedAt: string;
  debug?: ProductImageDebug;
};

const EMPTY_RESULT: Omit<ProductImageResult, "checkedAt"> = {
  imageUrl: null,
  source: null,
  confidence: null,
  origin: null,
};

const BRAND_LOGOS = new Set([
  "adobe",
  "amazon",
  "apple",
  "chatgpt",
  "cobasi",
  "coursera",
  "google",
  "ifood",
  "magalu",
  "mercado-livre",
  "microsoft",
  "netflix",
  "spotify",
  "totalpass",
  "uber-eats",
  "uber",
  "xiaomi",
  "youtube",
]);

const FETCH_TIMEOUT_MS = 4000;

function safeUrl(raw: unknown): string | null {
  const v = validateImageUrl(raw);
  return v.ok ? v.url : null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "GastoInteligente/1.0 (mercado-image-lookup)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type OFFProduct = {
  image_front_url?: string;
  image_url?: string;
  product_name?: string;
  brands?: string;
};

type OFFByBarcode = { status?: number; product?: OFFProduct };
type OFFSearch = { products?: OFFProduct[] };
type ProductImageHit = Pick<
  ProductImageResult,
  "imageUrl" | "source" | "confidence" | "origin" | "persistable"
>;

/** Dice coefficient simples para similaridade de nomes. */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      out.set(bg, (out.get(bg) || 0) + 1);
    }
    return out;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [bg, count] of A) {
    const bCount = B.get(bg);
    if (bCount) inter += Math.min(count, bCount);
  }
  const total = a.length - 1 + (b.length - 1);
  return total > 0 ? (2 * inter) / total : 0;
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeForKey(value);
    if (normalized.length < 2 || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function hasToken(text: string, tokens: string[]): boolean {
  return tokens.some((token) => new RegExp(`(^|\\s)${token}(\\s|$)`, "i").test(text));
}

function normalizeLookupTerms(raw: string, brand: string | null): string {
  let text = normalizeForKey(raw);
  const beerBrand = !!brand && ["heineken", "brahma", "skol", "antarctica", "itaipava", "ambev", "stella artois", "budweiser", "amstel", "eisenbahn"].includes(normalizeForKey(brand));
  text = text
    .replace(/\blong\s*nek\b/g, "long neck")
    .replace(/\blongneck\b/g, "long neck")
    .replace(/\bcx\b/g, "caixa")
    .replace(/\b(?:und|un|unidade|unidades)\b/g, " ");
  if (beerBrand || hasToken(text, ["cerveja", "beer", "lager"])) {
    text = text.replace(/\bln\b/g, "long neck");
  }
  return normalizeForKey(text);
}

function inferCategoryTerms(name: string, explicitCategory?: ProductImageInput["category"] | null): string[] {
  const text = normalizeForKey(name);
  const terms: string[] = [];
  if (explicitCategory === "bebidas" || hasToken(text, ["cerveja", "beer", "lager"])) {
    terms.push("cerveja", "beer", "lager");
  }
  if (hasToken(text, ["refrigerante", "refri", "soda"])) {
    terms.push("refrigerante", "soda", "soft drink");
  }
  if (hasToken(text, ["cafe", "pilao", "melitta"])) terms.push("cafe", "coffee");
  if (hasToken(text, ["farinha", "trigo", "adria"])) terms.push("farinha trigo", "flour");
  if (hasToken(text, ["linguica", "ling", "sadia"])) terms.push("linguica", "sausage");
  return unique(terms);
}

function packagingTerms(name: string): string[] {
  const text = normalizeForKey(name);
  const terms: string[] = [];
  if (hasToken(text, ["long", "neck"]) || /\blong\s*neck\b/.test(text)) terms.push("long neck", "longneck");
  if (hasToken(text, ["garrafa"])) terms.push("garrafa");
  if (hasToken(text, ["lata"])) terms.push("lata");
  if (hasToken(text, ["pet"])) terms.push("pet");
  if (/\b(?:330\s?ml|330)\b/.test(text)) terms.push("330ml");
  if (/\b(?:350\s?ml|350|355\s?ml|355)\b/.test(text)) terms.push("355ml");
  if (/\b(?:2\s?l|2\s?litros|2l)\b/.test(text)) terms.push("2l", "2 litros");
  if (/\b(?:500\s?g|500)\b/.test(text)) terms.push("500g");
  if (/\b(?:1\s?kg|1kg)\b/.test(text)) terms.push("1kg");
  return unique(terms);
}

function buildNameAliases(name: string, brand: string | null, category?: ProductImageInput["category"] | null): string[] {
  const normalized = normalizeLookupTerms(name, brand);
  const categories = inferCategoryTerms(`${name} ${brand ?? ""}`, category);
  const packs = packagingTerms(normalized);
  const aliases = [normalized];
  if (hasToken(normalized, ["cerveja", "beer", "lager", "long", "neck"]) || normalizeForKey(brand) === "heineken") {
    aliases.push("long neck", "longneck", "garrafa", "330ml", "355ml", "cerveja", "beer", "lager", "lager beer", "original", "premium pure malt");
  }
  if (hasToken(normalized, ["refrigerante", "refri"])) aliases.push("refrigerante", "soda", "soft drink", "pet", "2l", "2 litros");
  return unique([...aliases, ...packs, ...categories]);
}

async function lookupByBarcode(
  barcode: string,
): Promise<Pick<ProductImageResult, "imageUrl" | "source" | "confidence" | "origin"> | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(
    barcode,
  )}.json?fields=image_front_url,image_url,product_name,brands`;
  const data = await fetchJson<OFFByBarcode>(url);
  if (!data || data.status !== 1 || !data.product) return null;
  const img = safeUrl(data.product.image_front_url || data.product.image_url);
  if (!img) return null;
  return {
    imageUrl: img,
    source: "off_barcode",
    confidence: "high",
    origin: "openfoodfacts",
  };
}

async function lookupByName(
  productName: string,
  brand: string | null,
  onDiag?: (d: { candidates: number; bestScore: number | null; rejected: string | null }) => void,
): Promise<Pick<ProductImageResult, "imageUrl" | "source" | "confidence" | "origin"> | null> {
  const q = [productName, brand].filter(Boolean).join(" ").slice(0, 120);
  if (q.length < 3) {
    onDiag?.({ candidates: 0, bestScore: null, rejected: "query_too_short" });
    return null;
  }
  const params = new URLSearchParams({
    search_terms: q,
    json: "1",
    page_size: "8",
    fields: "image_front_url,image_url,product_name,brands",
  });
  const url = `https://world.openfoodfacts.org/cgi/search.pl?${params.toString()}`;
  const data = await fetchJson<OFFSearch>(url);
  if (!data?.products?.length) {
    onDiag?.({ candidates: 0, bestScore: null, rejected: "no_results" });
    return null;
  }
  const normalizedQuery = normalizeForKey(productName);
  const normalizedBrand = brand ? normalizeForKey(brand) : "";
  let best: { img: string; score: number } | null = null;
  for (const p of data.products) {
    const img = safeUrl(p.image_front_url || p.image_url);
    if (!img) continue;
    const candidateName = normalizeForKey(p.product_name);
    const candidateBrands = normalizeForKey(p.brands);
    const nameSim = similarity(normalizedQuery, candidateName);
    let score = nameSim;
    if (normalizedBrand) {
      const brandSim = similarity(normalizedBrand, candidateBrands);
      const brandSubstr =
        candidateBrands.includes(normalizedBrand) ||
        candidateName.includes(normalizedBrand);
      if (brandSubstr) score += 0.25;
      else if (brandSim > 0.6) score += 0.15;
      else score -= 0.25;
    }
    if (!best || score > best.score) best = { img, score };
  }
  if (!best) {
    onDiag?.({ candidates: data.products.length, bestScore: null, rejected: "no_image_in_results" });
    return null;
  }
  if (best.score < 0.5) {
    onDiag?.({ candidates: data.products.length, bestScore: best.score, rejected: "score_below_threshold" });
    return null;
  }
  const confidence: ProductImageConfidence =
    best.score >= 0.85 ? "high" : best.score >= 0.6 ? "medium" : "low";
  onDiag?.({ candidates: data.products.length, bestScore: best.score, rejected: null });
  return {
    imageUrl: best.img,
    source: "off_search",
    confidence,
    origin: "openfoodfacts",
  };
}

function lookupBrandLogo(
  brand: string | null,
): Pick<ProductImageResult, "imageUrl" | "source" | "confidence" | "origin"> | null {
  if (!brand) return null;
  const slug = normalizeForKey(brand).replace(/\s+/g, "-");
  if (!slug) return null;
  const candidates = [slug, slug.replace(/-/g, "")];
  for (const c of candidates) {
    if (BRAND_LOGOS.has(c)) {
      return {
        imageUrl: `/logos/empresas/${c}.svg`,
        source: "brand_logo",
        confidence: "low",
        origin: "local",
      };
    }
  }
  return null;
}

async function lookupCore(input: ProductImageInput): Promise<ProductImageResult> {
  const now = new Date().toISOString();
  const isDev = process.env.NODE_ENV !== "production";

  const { cleanedName, extractedBrand } = cleanProductName(
    input.productName,
    input.brand ?? null,
  );
  const effectiveBrand = extractedBrand || input.brand || null;
  const rawName = normalizeForKey(input.productName);

  const debug: ProductImageDebug | undefined = isDev
    ? {
        productName: input.productName,
        cleanedName,
        extractedBrand: effectiveBrand,
        barcode: input.barcode ?? null,
        attempts: [],
        pickedFrom: "none",
      }
    : undefined;

  if (input.barcode) {
    const hit = await lookupByBarcode(input.barcode);
    if (hit) {
      if (debug) debug.pickedFrom = "barcode";
      return { ...hit, checkedAt: now, debug };
    }
    debug?.attempts.push({
      query: input.barcode,
      brand: null,
      candidates: 0,
      bestScore: null,
      rejected: "barcode_no_match",
    });
  }

  // Sequência de tentativas, da mais específica para a mais ampla.
  const attempts: Array<{ name: string; brand: string | null }> = [];
  if (cleanedName && effectiveBrand)
    attempts.push({ name: cleanedName, brand: effectiveBrand });
  if (rawName && effectiveBrand && rawName !== cleanedName)
    attempts.push({ name: rawName, brand: effectiveBrand });
  if (cleanedName) attempts.push({ name: cleanedName, brand: null });
  if (rawName && rawName !== cleanedName)
    attempts.push({ name: rawName, brand: null });

  const seen = new Set<string>();
  for (const a of attempts) {
    const key = `${a.name}|${a.brand ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = await lookupByName(a.name, a.brand, (d) => {
      debug?.attempts.push({ query: a.name, brand: a.brand, ...d });
    });
    if (hit) {
      if (debug) debug.pickedFrom = "search";
      return { ...hit, checkedAt: now, debug };
    }
  }

  const byBrand = lookupBrandLogo(effectiveBrand);
  if (byBrand) {
    if (debug) debug.pickedFrom = "brand_logo";
    return { ...byBrand, checkedAt: now, debug };
  }

  return { ...EMPTY_RESULT, checkedAt: now, debug };
}

export const lookupProductImage = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<ProductImageResult> => {
    const key = [
      normalizeForKey(data.productName),
      normalizeForKey(data.brand ?? ""),
      data.barcode ?? "",
    ].join("|");

    const cached = cacheGet<ProductImageResult>(key);
    if (cached) return cached;

    try {
      const result = await lookupCore(data);
      cacheSet(key, result);
      return result;
    } catch {
      // Nunca propaga — fallback no client.
      return { ...EMPTY_RESULT, checkedAt: new Date().toISOString() };
    }
  });
