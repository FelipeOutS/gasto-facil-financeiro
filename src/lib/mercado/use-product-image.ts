/**
 * Hook leve para sugerir imagem de produto, com cache em memória e
 * deduplicação de chamadas. Não depende de QueryClientProvider — usa um
 * Map + Promises em vôo. Lazy: só dispara quando habilitado.
 */
import { useEffect, useRef, useState } from "react";
import {
  lookupProductImage,
  type ProductImageInput,
  type ProductImageResult,
} from "./product-image.functions";
import { normalizeForKey } from "./product-image-key";

type CacheEntry = {
  result?: ProductImageResult;
  inFlight?: Promise<ProductImageResult>;
  fetchedAt: number;
};

const STALE_MS = 60 * 60 * 1000; // 1h
const cache = new Map<string, CacheEntry>();

function makeKey(input: ProductImageInput): string {
  return [
    normalizeForKey(input.productName),
    normalizeForKey(input.brand ?? ""),
    input.barcode ?? "",
  ].join("|");
}

function isFresh(
  entry: CacheEntry | undefined,
): entry is CacheEntry & { result: ProductImageResult } {
  return !!entry && !!entry.result && Date.now() - entry.fetchedAt < STALE_MS;
}

export type UseProductImageInput = {
  productName?: string | null;
  brand?: string | null;
  barcode?: string | null;
  category?: ProductImageInput["category"] | null;
};

export type UseProductImageOptions = {
  enabled?: boolean;
};

export function useProductImage(
  input: UseProductImageInput,
  options: UseProductImageOptions = {},
): { data: ProductImageResult | null; isLoading: boolean } {
  const { enabled = true } = options;
  const name = (input.productName ?? "").trim();
  const normalizedInput: ProductImageInput | null =
    name.length >= 2
      ? {
          productName: name,
          brand: input.brand?.trim() || null,
          barcode: input.barcode?.trim() || null,
          category: input.category ?? null,
        }
      : null;

  const key = normalizedInput ? makeKey(normalizedInput) : null;

  const [data, setData] = useState<ProductImageResult | null>(() => {
    if (!key) return null;
    const hit = cache.get(key);
    return isFresh(hit) ? hit.result : null;
  });
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !key || !normalizedInput) return;

    const hit = cache.get(key);
    if (isFresh(hit)) {
      setData(hit.result);
      return;
    }

    let inFlight = hit?.inFlight;
    if (!inFlight) {
      inFlight = lookupProductImage({ data: normalizedInput })
        .then((res) => {
          cache.set(key, { result: res, fetchedAt: Date.now() });
          if (import.meta.env.DEV && res.debug) {
            // eslint-disable-next-line no-console
            console.debug(
              `[image-lookup] "${res.debug.productName}" → ${
                res.imageUrl ? `${res.debug.pickedFrom} (${res.confidence})` : "sem imagem"
              }`,
              {
                cleaned: res.debug.cleanedName,
                brand: res.debug.extractedBrand,
                barcode: res.debug.barcode,
                attempts: res.debug.attempts,
              },
            );
          }
          return res;
        })
        .catch(() => {
          const fallback: ProductImageResult = {
            imageUrl: null,
            source: null,
            confidence: null,
            origin: null,
            checkedAt: new Date().toISOString(),
          };
          cache.set(key, { result: fallback, fetchedAt: Date.now() });
          return fallback;
        });
      cache.set(key, { fetchedAt: Date.now(), inFlight });
    }


    setIsLoading(true);
    inFlight.then((res) => {
      if (!mountedRef.current) return;
      setData(res);
      setIsLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return { data, isLoading };
}
