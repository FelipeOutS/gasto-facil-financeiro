/**
 * Mercado Inteligente — Consulta de produto por código de barras (Open Food Facts).
 *
 * Serviço isolado, seguro e opcional:
 * - não persiste nada;
 * - não quebra a UI em erro de rede;
 * - retorna DTO normalizado.
 */

export type ProductLookupSource = "open-food-facts";

export interface ProductLookupResult {
  found: boolean;
  barcode: string;
  name?: string;
  brand?: string;
  quantity?: string;
  imageUrl?: string;
  source: ProductLookupSource;
}

export type ProductLookupErrorCode = "empty" | "invalid" | "timeout" | "network" | "server";

export class ProductLookupError extends Error {
  code: ProductLookupErrorCode;
  constructor(code: ProductLookupErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "ProductLookupError";
  }
}

const OFF_BASE = "https://world.openfoodfacts.org/api/v2/product";
const DEFAULT_TIMEOUT_MS = 8000;

export function normalizeBarcode(input: string): string {
  return (input ?? "").replace(/\D+/g, "").trim();
}

function isValidBarcode(code: string): boolean {
  // EAN-8, UPC-A, EAN-13, ITF-14 etc — 8 a 14 dígitos
  return /^\d{8,14}$/.test(code);
}

/**
 * Busca um produto na Open Food Facts pelo código de barras.
 * Nunca lança para "não encontrado": retorna { found: false }.
 * Lança ProductLookupError apenas para falhas de validação/rede.
 */
export async function buscarProdutoPorCodigoBarras(
  codigo: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ProductLookupResult> {
  const raw = (codigo ?? "").trim();
  if (!raw) throw new ProductLookupError("empty");

  const barcode = normalizeBarcode(raw);
  if (!isValidBarcode(barcode)) throw new ProductLookupError("invalid");

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Encadeia signal externo, se houver.
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const url = `${OFF_BASE}/${encodeURIComponent(
    barcode,
  )}.json?fields=product_name,brands,quantity,image_front_small_url,image_small_url,image_url`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if ((err as { name?: string })?.name === "AbortError") {
      throw new ProductLookupError("timeout");
    }
    throw new ProductLookupError("network");
  }
  clearTimeout(timeoutId);

  if (res.status === 404) {
    return { found: false, barcode, source: "open-food-facts" };
  }
  if (!res.ok) {
    throw new ProductLookupError("server", `HTTP ${res.status}`);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ProductLookupError("server", "invalid-json");
  }

  const body = data as {
    status?: number;
    product?: {
      product_name?: string;
      brands?: string;
      quantity?: string;
      image_front_small_url?: string;
      image_small_url?: string;
      image_url?: string;
    };
  };

  if (!body || body.status !== 1 || !body.product) {
    return { found: false, barcode, source: "open-food-facts" };
  }

  const p = body.product;
  const name = typeof p.product_name === "string" ? p.product_name.trim() : "";
  const brand = typeof p.brands === "string" ? p.brands.split(",")[0]?.trim() : "";
  const quantity = typeof p.quantity === "string" ? p.quantity.trim() : "";
  const imageUrl = p.image_front_small_url || p.image_small_url || p.image_url || undefined;

  return {
    found: true,
    barcode,
    name: name || undefined,
    brand: brand || undefined,
    quantity: quantity || undefined,
    imageUrl: imageUrl || undefined,
    source: "open-food-facts",
  };
}
