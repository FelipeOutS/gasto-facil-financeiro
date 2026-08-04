/**
 * Mercado Inteligente — Camada de provider para "Mercados próximos"
 * ----------------------------------------------------------------------------
 * Esta camada é client-safe e isolada de UI/stores. Define a forma como o app
 * irá consultar mercados próximos. NÃO faz chamadas externas reais nesta etapa
 * (E23/E24). A integração real será plugada via createServerFn em
 * `nearby-markets.functions.ts` (server-only) — NUNCA via fetch direto do
 * navegador.
 *
 * Providers previstos
 * -------------------
 * - manual_only            → estado atual. Sem busca automática. Default.
 * - google_places          → futuro. EXIGE backend (createServerFn) para
 *                            proteger a chave (env: GOOGLE_PLACES_API_KEY).
 *                            NUNCA chamar do navegador.
 * - openstreetmap_overpass → futuro. Overpass API é pública, mas exige
 *                            User-Agent identificável, rate-limit e cache.
 *                            Também deve passar por backend.
 *
 * Regras de segurança/privacidade
 * -------------------------------
 * - Sem chave de API hardcoded ou em variáveis VITE_*.
 * - Sem fetch para provider externo neste arquivo.
 * - Sem acoplamento com UI, sem localStorage, sem Supabase.
 * - Resultado vazio ou indisponível NÃO deve quebrar o cadastro manual.
 * - Resultados automáticos DEVEM ser revisados/confirmados pelo usuário antes
 *   de salvar no cadastro local. Nenhum mercado é persistido automaticamente.
 */

export type MercadoNearbyProvider = "manual_only" | "google_places" | "openstreetmap_overpass";

export type MercadoNearbyResult = {
  /** Identificador interno estável (uuid local ou hash do placeId). */
  id: string;
  /** Identificador do provedor externo (ex.: Google place_id, OSM id). */
  placeId?: string;
  nome: string;
  endereco?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
  telefone?: string;
  latitude?: number;
  longitude?: number;
  distanciaKm?: number;
  /** Provedor que produziu este resultado. */
  fonte: MercadoNearbyProvider;
};

export type MercadoNearbyErrorCode =
  | "invalid_location"
  | "provider_unavailable"
  | "network"
  | "timeout"
  | "empty"
  | "unknown";

export type MercadoNearbyError = {
  code: MercadoNearbyErrorCode;
  message?: string;
};

export type MercadoNearbyQuery = {
  /** CEP só com dígitos (8). */
  cep?: string;
  cidade?: string;
  uf?: string;
  /** Coordenadas opcionais — exigem opt-in de geolocalização no navegador. */
  latitude?: number;
  longitude?: number;
  /** Raio de busca em km. Apenas hint para providers futuros. */
  radiusKm?: number;
};

export type MercadoNearbyResponse =
  | {
      ok: true;
      provider: MercadoNearbyProvider;
      results: MercadoNearbyResult[];
      /** Raio (km) efetivamente usado quando os resultados foram encontrados. */
      radiusKmUsed?: number;
      /** Rótulo amigável da fonte, e.g. "OpenStreetMap". */
      sourceLabel?: string;
    }
  | {
      ok: false;
      provider: MercadoNearbyProvider;
      error: MercadoNearbyError;
      /** Maior raio (km) tentado antes de desistir. */
      radiusKmTried?: number;
    };

/**
 * Provider ativo no momento.
 *
 * Etapa E25: ativado `openstreetmap_overpass` (gratuito, sem chave).
 * A chamada real acontece SOMENTE em `nearby-markets.functions.ts` (server fn),
 * respeitando o User-Agent e o rate-limit da Overpass/Nominatim. Nada é
 * persistido automaticamente — o usuário revisa e confirma antes de salvar.
 *
 * Google Places fica preparado para uma fase futura (exige billing/cartão e
 * GOOGLE_PLACES_API_KEY). Para migrar:
 *   1. Adicionar a secret no projeto.
 *   2. Implementar a chamada real no handler da server fn.
 *   3. Trocar `ACTIVE_NEARBY_PROVIDER` para "google_places".
 */
export const ACTIVE_NEARBY_PROVIDER: MercadoNearbyProvider = "openstreetmap_overpass";

// ---------------------------------------------------------------------------
// Normalizadores (puros, sem efeito colateral, client-safe)
// ---------------------------------------------------------------------------

export function normalizeCep(input: string | undefined | null): string {
  if (!input) return "";
  return String(input).replace(/\D/g, "").slice(0, 8);
}

export function normalizeUf(input: string | undefined | null): string {
  if (!input) return "";
  return String(input).trim().toUpperCase().slice(0, 2);
}

export function normalizeCidade(input: string | undefined | null): string {
  if (!input) return "";
  return String(input).trim().slice(0, 80);
}

export function isValidNearbyQuery(q: MercadoNearbyQuery): boolean {
  const cep = normalizeCep(q.cep);
  const cidade = normalizeCidade(q.cidade);
  const uf = normalizeUf(q.uf);
  const hasCoords =
    typeof q.latitude === "number" &&
    typeof q.longitude === "number" &&
    Number.isFinite(q.latitude) &&
    Number.isFinite(q.longitude);
  return cep.length === 8 || (cidade.length >= 2 && uf.length === 2) || hasCoords;
}

// ---------------------------------------------------------------------------
// Descritores de provider (apenas documentação tipada — sem efeito runtime)
// ---------------------------------------------------------------------------

export type MercadoNearbyProviderDescriptor = {
  id: MercadoNearbyProvider;
  label: string;
  requiresBackend: boolean;
  envKeyName?: string;
  notes: string;
};

export const NEARBY_PROVIDER_DESCRIPTORS: Readonly<
  Record<MercadoNearbyProvider, MercadoNearbyProviderDescriptor>
> = {
  manual_only: {
    id: "manual_only",
    label: "Cadastro manual",
    requiresBackend: false,
    notes: "Estado padrão. Sem busca automática. O usuário cadastra cada mercado à mão.",
  },
  google_places: {
    id: "google_places",
    label: "Google Places",
    requiresBackend: true,
    envKeyName: "GOOGLE_PLACES_API_KEY",
    notes:
      "API paga. EXIGE chamada via createServerFn server-side para proteger a chave. NUNCA usar do navegador. Implementar retry/quota e mapear place_id → MercadoNearbyResult.placeId.",
  },
  openstreetmap_overpass: {
    id: "openstreetmap_overpass",
    label: "OpenStreetMap (Overpass)",
    requiresBackend: true,
    notes:
      "API pública, mas exige User-Agent identificável, respeito ao rate-limit do servidor público e cache local de respostas para evitar abuso. Também deve passar por backend.",
  },
} as const;

// ---------------------------------------------------------------------------
// Busca pública (preparada — não ativa)
// ---------------------------------------------------------------------------

/**
 * Busca mercados próximos. Enquanto `ACTIVE_NEARBY_PROVIDER === "manual_only"`,
 * resolve sempre com `provider_unavailable` para que a UI mostre a mensagem
 * de preparação e o usuário siga cadastrando manualmente.
 *
 * Quando um provider real for ativado, esta função deve delegar para a
 * server fn correspondente (ex.: `findNearbyMarketsServerFn` em
 * `nearby-markets.functions.ts`). Nunca colocar fetch externo aqui.
 */
export async function findNearbyMarkets(query: MercadoNearbyQuery): Promise<MercadoNearbyResponse> {
  if (!isValidNearbyQuery(query)) {
    return {
      ok: false,
      provider: ACTIVE_NEARBY_PROVIDER,
      error: { code: "invalid_location" },
    };
  }
  // Delegação para a server fn (Overpass/Nominatim). Importação dinâmica
  // garante que o módulo *.functions.ts seja transformado pelo bundler como
  // RPC stub no client — sem qualquer chave ou fetch externo do navegador.
  const { findNearbyMarketsServerFn } = await import("./nearby-markets.functions");
  return findNearbyMarketsServerFn({ data: query });
}
