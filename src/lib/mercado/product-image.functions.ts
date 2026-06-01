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
    .optional()
    .nullable(),
});

export type ProductImageInput = z.infer<typeof InputSchema>;

export type ProductImageSource =
  | "off_barcode"
  | "off_search"
  | "brand_logo"
  | null;

export type ProductImageConfidence = "high" | "medium" | "low" | null;

export type ProductImageResult = {
  imageUrl: string | null;
  source: ProductImageSource;
  confidence: ProductImageConfidence;
  origin: "openfoodfacts" | "local" | null;
  checkedAt: string;
};

const EMPTY_RESULT: Omit<ProductImageResult, "checkedAt"> = {
  imageUrl: null,
  source: null,
  confidence: null,
  origin: null,
};

const ALLOWED_HOSTS = new Set([
  "images.openfoodfacts.org",
  "world.openfoodfacts.org",
  "static.openfoodfacts.org",
]);

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
  if (typeof raw !== "string" || !raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!ALLOWED_HOSTS.has(u.hostname)) return null;
    // força https
    u.protocol = "https:";
    return u.toString();
  } catch {
    return null;
  }
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
): Promise<Pick<ProductImageResult, "imageUrl" | "source" | "confidence" | "origin"> | null> {
  const q = [productName, brand].filter(Boolean).join(" ").slice(0, 120);
  if (q.length < 3) return null;
  const params = new URLSearchParams({
    search_terms: q,
    json: "1",
    page_size: "3",
    fields: "image_front_url,image_url,product_name,brands",
  });
  const url = `https://world.openfoodfacts.org/cgi/search.pl?${params.toString()}`;
  const data = await fetchJson<OFFSearch>(url);
  if (!data?.products?.length) return null;
  const normalizedQuery = normalizeForKey(productName);
  for (const p of data.products) {
    const img = safeUrl(p.image_front_url || p.image_url);
    if (!img) continue;
    const sim = similarity(normalizedQuery, normalizeForKey(p.product_name));
    if (sim >= 0.55) {
      return {
        imageUrl: img,
        source: "off_search",
        confidence: "medium",
        origin: "openfoodfacts",
      };
    }
  }
  return null;
}

function lookupBrandLogo(
  brand: string | null,
): Pick<ProductImageResult, "imageUrl" | "source" | "confidence" | "origin"> | null {
  if (!brand) return null;
  const slug = normalizeForKey(brand).replace(/\s+/g, "-");
  if (!slug) return null;
  // tenta variações comuns
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

  if (input.barcode) {
    const hit = await lookupByBarcode(input.barcode);
    if (hit) return { ...hit, checkedAt: now };
  }

  const byName = await lookupByName(input.productName, input.brand ?? null);
  if (byName) return { ...byName, checkedAt: now };

  const byBrand = lookupBrandLogo(input.brand ?? null);
  if (byBrand) return { ...byBrand, checkedAt: now };

  return { ...EMPTY_RESULT, checkedAt: now };
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
