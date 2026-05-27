/**
 * Mercado Inteligente — Server function de "Mercados próximos" (E25 — OSM)
 * ----------------------------------------------------------------------------
 * Esta server fn faz a busca real de mercados próximos usando APIs públicas
 * e gratuitas do OpenStreetMap:
 *   - Nominatim   → geocoding (CEP/cidade+UF → lat/lon)
 *   - Overpass    → consulta de POIs (shop=supermarket|convenience|grocery)
 *
 * Por que NÃO Google Places agora?
 * - Google Places exige billing/cartão e chave (GOOGLE_PLACES_API_KEY).
 * - Para evitar risco de cobrança, esta etapa fica adiada para o futuro.
 *   A arquitetura já está preparada em nearby-markets-api.ts
 *   (NEARBY_PROVIDER_DESCRIPTORS.google_places). Para ativar no futuro:
 *     1. Adicionar GOOGLE_PLACES_API_KEY em secrets.
 *     2. Trocar a implementação deste handler para chamar Google Places.
 *     3. Trocar `ACTIVE_NEARBY_PROVIDER` em nearby-markets-api.ts.
 *
 * Regras de uso responsável do OSM (NÃO violar):
 * - Sempre rodar server-side (esta server fn) — nunca chamar Overpass/Nominatim
 *   direto do navegador em massa.
 * - Enviar User-Agent identificável (política do Nominatim).
 * - Uma requisição por ação do usuário (sem polling/bulk/scraping).
 * - Timeout curto + try/catch para nunca pendurar a UI.
 * - Em caso de falha, retornar erro amigável; cadastro manual continua disponível.
 * - Não persistir resultados automaticamente — o usuário revisa antes de salvar.
 */

import { createServerFn } from "@tanstack/react-start";
import {
  ACTIVE_NEARBY_PROVIDER,
  isValidNearbyQuery,
  normalizeCep,
  normalizeCidade,
  normalizeUf,
  type MercadoNearbyQuery,
  type MercadoNearbyResponse,
  type MercadoNearbyResult,
} from "./nearby-markets-api";

const USER_AGENT =
  "GastoInteligente/1.0 (+https://gastointeligente.com.br) MercadoInteligente";
const REQ_TIMEOUT_MS = 8000;
const MAX_RESULTS = 15;
/** Raio padrão (metros) ao redor do ponto geocodificado. */
const DEFAULT_RADIUS_M = 3000;

function parseQuery(input: unknown): MercadoNearbyQuery {
  const obj = (input ?? {}) as Record<string, unknown>;
  const toStr = (v: unknown) => (typeof v === "string" ? v : undefined);
  const toNum = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  return {
    cep: toStr(obj.cep),
    cidade: toStr(obj.cidade),
    uf: toStr(obj.uf),
    latitude: toNum(obj.latitude),
    longitude: toNum(obj.longitude),
    radiusKm: toNum(obj.radiusKm),
  };
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(id);
  }
}

type GeocodeHit = { lat: number; lon: number };

async function geocode(q: MercadoNearbyQuery): Promise<GeocodeHit | null> {
  const cep = normalizeCep(q.cep);
  const cidade = normalizeCidade(q.cidade);
  const uf = normalizeUf(q.uf);

  if (
    typeof q.latitude === "number" &&
    typeof q.longitude === "number" &&
    Number.isFinite(q.latitude) &&
    Number.isFinite(q.longitude)
  ) {
    return { lat: q.latitude, lon: q.longitude };
  }

  const params = new URLSearchParams({
    format: "json",
    limit: "1",
    countrycodes: "br",
    addressdetails: "0",
  });
  if (cep.length === 8) {
    params.set("postalcode", cep);
    params.set("country", "Brazil");
  } else if (cidade.length >= 2 && uf.length === 2) {
    params.set("city", cidade);
    params.set("state", uf);
    params.set("country", "Brazil");
  } else {
    return null;
  }

  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{ lat: string; lon: string }>;
  const hit = data[0];
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lon = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

async function queryOverpass(
  center: GeocodeHit,
  radiusM: number,
): Promise<OverpassElement[]> {
  // shop=supermarket|convenience|grocery cobre supermercados e mercadinhos.
  const query = `
    [out:json][timeout:20];
    (
      node["shop"~"^(supermarket|convenience|grocery)$"](around:${radiusM},${center.lat},${center.lon});
      way["shop"~"^(supermarket|convenience|grocery)$"](around:${radiusM},${center.lat},${center.lon});
    );
    out center ${MAX_RESULTS};
  `.trim();

  const res = await fetchWithTimeout("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`overpass_${res.status}`);
  const data = (await res.json()) as { elements?: OverpassElement[] };
  return Array.isArray(data.elements) ? data.elements : [];
}

function mapElement(el: OverpassElement): MercadoNearbyResult | null {
  const tags = el.tags ?? {};
  const nome = (tags.name || tags.brand || "").trim();
  if (!nome) return null;

  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;

  const ruaParts = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean);
  const endereco = ruaParts.join(", ") || undefined;
  const bairro = tags["addr:suburb"] || tags["addr:neighbourhood"] || undefined;
  const cidade = tags["addr:city"] || undefined;
  const uf = tags["addr:state"] || undefined;
  const cep = (tags["addr:postcode"] || "").replace(/\D/g, "").slice(0, 8) || undefined;
  const telefone = tags.phone || tags["contact:phone"] || undefined;

  return {
    id: `osm-${el.type}-${el.id}`,
    placeId: `${el.type}/${el.id}`,
    nome,
    endereco,
    bairro,
    cidade,
    uf,
    cep,
    telefone,
    latitude: lat,
    longitude: lon,
    fonte: "openstreetmap_overpass",
  };
}

export const findNearbyMarketsServerFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => parseQuery(data))
  .handler(async ({ data }): Promise<MercadoNearbyResponse> => {
    if (!isValidNearbyQuery(data)) {
      return {
        ok: false,
        provider: ACTIVE_NEARBY_PROVIDER,
        error: { code: "invalid_location" },
      };
    }
    try {
      const center = await geocode(data);
      if (!center) {
        return {
          ok: false,
          provider: ACTIVE_NEARBY_PROVIDER,
          error: { code: "invalid_location" },
        };
      }
      const radiusM = Math.max(
        500,
        Math.min(10000, Math.round((data.radiusKm ?? 3) * 1000)),
      );
      const elements = await queryOverpass(
        center,
        radiusM || DEFAULT_RADIUS_M,
      );
      const results = elements
        .map(mapElement)
        .filter((r): r is MercadoNearbyResult => r !== null)
        .slice(0, MAX_RESULTS);

      if (results.length === 0) {
        return {
          ok: false,
          provider: ACTIVE_NEARBY_PROVIDER,
          error: { code: "empty" },
        };
      }
      return { ok: true, provider: ACTIVE_NEARBY_PROVIDER, results };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      const code =
        msg.includes("aborted") || msg.includes("timeout")
          ? "timeout"
          : "network";
      return {
        ok: false,
        provider: ACTIVE_NEARBY_PROVIDER,
        error: { code },
      };
    }
  });
