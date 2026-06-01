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
import {
  cleanProductName,
  isStrongMarketBrand,
  normalizeMarketProductTerms,
} from "./product-name-clean";
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

async function fetchJson<T>(url: string): Promise<{ data: T | null; reason?: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "GastoInteligente/1.0 (mercado-image-lookup)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { data: null, reason: `http_${res.status}` };
    const txt = await res.text();
    if (!txt || txt[0] !== "{") return { data: null, reason: "rate_limited_or_html" };
    try {
      return { data: JSON.parse(txt) as T };
    } catch {
      return { data: null, reason: "invalid_json" };
    }
  } catch {
    return { data: null, reason: "fetch_error" };
  }
}

type OFFImageEntry = { pt?: string; en?: string; fr?: string };
type OFFSelectedImages = {
  front?: { display?: OFFImageEntry; small?: OFFImageEntry; thumb?: OFFImageEntry };
};
type OFFProduct = {
  image_front_url?: string;
  image_url?: string;
  product_name?: string;
  brands?: string;
  selected_images?: OFFSelectedImages;
};

type OFFByBarcode = { status?: number; product?: OFFProduct };
type OFFSearch = { products?: OFFProduct[] };
type ProductImageHit = Pick<
  ProductImageResult,
  "imageUrl" | "source" | "confidence" | "origin" | "persistable"
>;

/** Prioriza imagem frontal selecionada PT > EN > FR > image_front_url > image_url. */
function pickProductImage(p: OFFProduct): string | null {
  const sel = p.selected_images?.front;
  const candidates = [
    sel?.display?.pt,
    sel?.display?.en,
    sel?.display?.fr,
    sel?.small?.pt,
    sel?.small?.en,
    sel?.small?.fr,
    p.image_front_url,
    p.image_url,
  ];
  for (const c of candidates) {
    const v = safeUrl(c);
    if (v) return v;
  }
  return null;
}

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
  return normalizeMarketProductTerms(raw, brand);
}

const BEER_BRANDS = ["heineken", "brahma", "skol", "antarctica", "itaipava", "ambev", "stella artois", "budweiser", "amstel", "eisenbahn", "corona", "original", "bohemia", "serramalte"];
const SOFT_DRINK_BRANDS = ["coca cola", "coca-cola", "coca", "pepsi", "fanta", "sprite", "sukita", "guarana antarctica", "schweppes", "del valle"];
const COFFEE_BRANDS = ["pilao", "melitta", "tres coracoes", "nescafe", "3 coracoes"];
const FLOUR_BRANDS = ["adria", "renata", "dona benta", "sol", "anaconda"];
const CHOCOLATE_BRANDS = ["nescau", "toddy", "toddynho", "ovomaltine"];

function inferCategoryTerms(name: string, explicitCategory?: ProductImageInput["category"] | null, brand?: string | null): string[] {
  const text = normalizeForKey(name);
  const brandKey = normalizeForKey(brand);
  const terms: string[] = [];
  if (explicitCategory === "bebidas" || hasToken(text, ["cerveja", "beer", "lager", "long", "neck"]) || BEER_BRANDS.includes(brandKey)) {
    terms.push("cerveja", "beer", "lager");
  }
  if (
    hasToken(text, ["refrigerante", "refri", "soda", "cola"]) ||
    /\b(coca|pepsi|fanta|sprite|sukita|schweppes|guarana)\b/.test(text) ||
    SOFT_DRINK_BRANDS.includes(brandKey)
  ) {
    terms.push("refrigerante", "soda", "soft drink");
  }
  if (hasToken(text, ["cafe", "pilao", "melitta"]) || COFFEE_BRANDS.includes(brandKey)) terms.push("cafe", "coffee");
  if (hasToken(text, ["farinha", "trigo"]) || FLOUR_BRANDS.includes(brandKey)) terms.push("farinha", "farinha trigo", "flour");
  if (hasToken(text, ["achocolatado", "nescau", "toddy"]) || CHOCOLATE_BRANDS.includes(brandKey)) terms.push("achocolatado", "chocolate milk");
  if (hasToken(text, ["linguica", "ling", "sadia"])) terms.push("linguica", "sausage");
  return unique(terms);
}

function packagingTerms(name: string): string[] {
  const text = normalizeForKey(name);
  const terms: string[] = [];
  if (hasToken(text, ["long", "neck"]) || /\blong\s*neck\b/.test(text)) terms.push("long neck", "longneck");
  if (hasToken(text, ["garrafa"])) terms.push("garrafa");
  if (hasToken(text, ["lata", "latinha"])) terms.push("lata", "can");
  if (hasToken(text, ["pet"])) terms.push("pet");
  if (/\b(?:330\s?ml|330)\b/.test(text)) terms.push("330ml");
  if (/\b(?:350\s?ml|350|355\s?ml|355)\b/.test(text)) terms.push("350ml", "355ml");
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
  const brandKey = normalizeForKey(brand);
  const isBeer =
    hasToken(normalized, ["cerveja", "beer", "lager", "long", "neck"]) ||
    ["heineken", "brahma", "skol", "antarctica", "itaipava", "ambep", "stella artois", "budweiser", "amstel", "eisenbahn", "corona"].includes(brandKey);
  const isSoftDrink =
    hasToken(normalized, ["refrigerante", "refri", "soda", "cola"]) ||
    ["coca cola", "coca", "pepsi", "fanta", "sprite", "sukita", "guarana antarctica", "schweppes"].includes(brandKey);
  if (isBeer) {
    aliases.push("long neck", "longneck", "garrafa", "lata", "330ml", "355ml", "cerveja", "beer", "lager", "lager beer");
  }
  if (isSoftDrink) {
    aliases.push("lata", "can", "garrafa", "pet", "350ml", "355ml", "330ml", "2l", "2 litros", "refrigerante", "soda", "soft drink", "cola");
  }
  if (hasToken(normalized, ["refrigerante", "refri"])) aliases.push("refrigerante", "soda", "soft drink", "pet", "2l", "2 litros");
  return unique([...aliases, ...packs, ...categories]);
}


async function lookupByBarcode(
  barcode: string,
): Promise<ProductImageHit | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(
    barcode,
  )}.json?fields=image_front_url,image_url,product_name,brands,selected_images`;
  const { data } = await fetchJson<OFFByBarcode>(url);
  if (!data || data.status !== 1 || !data.product) return null;
  const img = pickProductImage(data.product);
  if (!img) return null;
  return {
    imageUrl: img,
    source: "off_barcode",
    confidence: "high",
    persistable: true,
    origin: "openfoodfacts",
  };
}

async function lookupByName(
  query: string,
  brand: string | null,
  expectedCategoryTerms: string[] = [],
  expectedPackagingTerms: string[] = [],
  onDiag?: (d: {
    candidates: number;
    bestScore: number | null;
    bestCandidate?: string | null;
    bestBrands?: string | null;
    hadImage?: boolean;
    rejected: string | null;
  }) => void,
): Promise<ProductImageHit | null> {
  const q = query.slice(0, 120);
  if (q.length < 3) {
    onDiag?.({ candidates: 0, bestScore: null, rejected: "query_too_short" });
    return null;
  }
  const params = new URLSearchParams({
    search_terms: q,
    json: "1",
    page_size: "20",
    fields: "image_front_url,image_url,product_name,brands,selected_images",
  });
  const url = `https://world.openfoodfacts.org/cgi/search.pl?${params.toString()}`;
  const { data, reason } = await fetchJson<OFFSearch>(url);
  if (!data?.products?.length) {
    onDiag?.({ candidates: 0, bestScore: null, rejected: reason ?? "no_results" });
    return null;
  }
  const normalizedQuery = normalizeForKey(query);
  const normalizedBrand = brand ? normalizeForKey(brand) : "";
  const strongBrand = isStrongMarketBrand(normalizedBrand);
  const brandOnlyQuery =
    !!normalizedBrand && normalizedQuery === normalizedBrand;
  let best: { img: string; score: number; name: string | null; brands: string | null; brandMatched: boolean } | null = null;
  let bestNoImage: { score: number; name: string | null; brands: string | null } | null = null;
  for (const p of data.products) {
    const img = pickProductImage(p);
    const candidateName = normalizeForKey(p.product_name);
    const candidateBrands = normalizeForKey(p.brands);
    const nameSim = similarity(normalizedQuery, candidateName);
    const candidateText = `${candidateName} ${candidateBrands}`;
    let score = Math.min(nameSim, 0.45);
    const partialTokens = normalizedQuery.split(/\s+/).filter((tok) => tok.length >= 3);
    const partialHits = partialTokens.filter((tok) => candidateText.includes(tok)).length;
    if (partialTokens.length > 0) score += Math.min(0.25, (partialHits / partialTokens.length) * 0.25);
    let brandMatched = false;
    if (normalizedBrand) {
      const brandSim = similarity(normalizedBrand, candidateBrands);
      const brandSubstr =
        candidateBrands.includes(normalizedBrand) ||
        candidateName.includes(normalizedBrand);
      brandMatched = brandSubstr || brandSim > 0.78;
      if (brandSubstr) score += strongBrand ? 0.7 : 0.5;
      else if (brandSim > 0.78) score += strongBrand ? 0.45 : 0.3;
      else if (candidateBrands) score -= strongBrand ? 0.9 : 0.55;
    }
    if (img) score += 0.08;
    const categoryMatched = expectedCategoryTerms.some((term) => candidateText.includes(normalizeForKey(term)));
    const packagingMatched = expectedPackagingTerms.some((term) => candidateText.includes(normalizeForKey(term)));
    if (categoryMatched) score += 0.18;
    if (packagingMatched) score += 0.08;
    if (!img) {
      if (!bestNoImage || score > bestNoImage.score) {
        bestNoImage = { score, name: p.product_name ?? null, brands: p.brands ?? null };
      }
      continue;
    }
    if (!best || score > best.score) {
      best = { img, score, name: p.product_name ?? null, brands: p.brands ?? null, brandMatched };
    }
  }
  if (!best) {
    onDiag?.({
      candidates: data.products.length,
      bestScore: bestNoImage?.score ?? null,
      bestCandidate: bestNoImage?.name ?? null,
      bestBrands: bestNoImage?.brands ?? null,
      hadImage: false,
      rejected: "no_image_in_results",
    });
    return null;
  }
  const threshold = brandOnlyQuery && strongBrand
    ? 0.38
    : normalizedBrand && strongBrand
      ? 0.46
      : normalizedBrand
        ? 0.58
        : 0.62;
  if (normalizedBrand && strongBrand && best.brandMatched && best.score >= 0.42) {
    // Marca forte exata não deve cair fora só porque o nome está incompleto ou com typo.
  } else if (best.score < threshold) {
    onDiag?.({
      candidates: data.products.length,
      bestScore: best.score,
      bestCandidate: best.name,
      bestBrands: best.brands,
      hadImage: true,
      rejected: "score_below_threshold",
    });
    return null;
  }
  const confidence: ProductImageConfidence =
    best.score >= 0.85 ? "high" : best.score >= 0.55 ? "medium" : "low";
  onDiag?.({
    candidates: data.products.length,
    bestScore: best.score,
    bestCandidate: best.name,
    bestBrands: best.brands,
    hadImage: true,
    rejected: null,
  });
  return {
    imageUrl: best.img,
    source: "off_search",
    confidence,
    persistable: confidence === "high" || (confidence === "medium" && (!strongBrand || best.brandMatched)) || (confidence === "low" && false),
    origin: "openfoodfacts",
  };
}

function lookupBrandLogo(
  brand: string | null,
): ProductImageHit | null {
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
        persistable: false,
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
  const normalizedName = normalizeLookupTerms(cleanedName || rawName, effectiveBrand);
  const aliases = buildNameAliases(`${cleanedName} ${rawName}`, effectiveBrand, input.category);
  const categoryTerms = inferCategoryTerms(`${input.productName} ${effectiveBrand ?? ""}`, input.category, effectiveBrand);
  const packTerms = packagingTerms(`${input.productName} ${normalizedName}`);

  const debug: ProductImageDebug | undefined = isDev
    ? {
        productName: input.productName,
        brandReceived: input.brand ?? null,
        cleanedName,
        normalizedName,
        extractedBrand: effectiveBrand,
        aliases,
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

  // Sequência de tentativas: queries com termo de categoria primeiro
  // ("cerveja heineken", "refrigerante coca cola") porque o OFF responde
  // melhor a elas e raramente rate-limita. Depois nome+marca, depois fallback.
  const attempts: Array<{ query: string; brand: string | null }> = [];
  if (effectiveBrand) {
    // Categoria + marca → mais robusto no OFF (ex.: "cerveja heineken")
    for (const term of categoryTerms) attempts.push({ query: `${term} ${effectiveBrand}`, brand: effectiveBrand });
  }
  if (effectiveBrand && normalizedName) attempts.push({ query: `${effectiveBrand} ${normalizedName}`, brand: effectiveBrand });
  if (effectiveBrand) {
    for (const alias of aliases) attempts.push({ query: `${effectiveBrand} ${alias}`, brand: effectiveBrand });
    for (const term of categoryTerms) attempts.push({ query: `${effectiveBrand} ${term}`, brand: effectiveBrand });
    attempts.push({ query: `${input.productName} ${effectiveBrand}`, brand: effectiveBrand });
    // Marca isolada por último — OFF costuma rate-limitar queries brand-only.
    if (isStrongMarketBrand(effectiveBrand)) attempts.push({ query: effectiveBrand, brand: effectiveBrand });
  }
  if (normalizedName) attempts.push({ query: normalizedName, brand: null });
  if (cleanedName && cleanedName !== normalizedName) attempts.push({ query: cleanedName, brand: null });
  if (rawName && rawName !== cleanedName && rawName !== normalizedName) attempts.push({ query: rawName, brand: null });

  const seen = new Set<string>();
  for (const a of attempts) {
    const key = `${normalizeForKey(a.query)}|${normalizeForKey(a.brand ?? "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = await lookupByName(a.query, a.brand, categoryTerms, packTerms, (d) => {
      debug?.attempts.push({ query: a.query, brand: a.brand, ...d });
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

  if (isDev && debug) {
    // Auditoria detalhada quando ficou sem imagem. Sem secrets/PII.
    // eslint-disable-next-line no-console
    console.warn("[image-lookup:miss]", {
      product: debug.productName,
      brand: debug.extractedBrand,
      barcode: debug.barcode,
      cleanedName: debug.cleanedName,
      normalizedName: debug.normalizedName,
      attempts: debug.attempts.map((a) => ({
        query: a.query,
        brand: a.brand,
        candidates: a.candidates,
        bestScore: a.bestScore,
        bestCandidate: a.bestCandidate,
        bestBrands: a.bestBrands,
        rejected: a.rejected,
      })),
    });
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
