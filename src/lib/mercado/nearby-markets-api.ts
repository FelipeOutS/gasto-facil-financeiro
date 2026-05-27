/**
 * Mercado Inteligente — Camada de provider para "Mercados próximos"
 * ----------------------------------------------------------------------------
 * Esta camada é isolada da UI e dos stores locais. Ela define a forma como
 * o app irá consultar mercados próximos no futuro, mas NÃO faz nenhuma
 * chamada externa real nesta etapa (E23).
 *
 * Providers previstos:
 * - manual_only      → estado atual. Sem busca automática.
 * - google_places    → futuro. EXIGE backend/server function próprio para
 *                      proteger a chave; NUNCA chamar Google Places direto
 *                      do navegador.
 * - openstreetmap    → futuro. Overpass API é pública, mas exige rate-limit
 *                      e User-Agent. Provavelmente também via proxy.
 *
 * Regras:
 * - Sem chave de API hardcoded.
 * - Sem fetch para provider externo neste arquivo. Quando a integração real
 *   for ativada, ela deve ser feita via createServerFn (TanStack), nunca
 *   exposta no client.
 * - Sem acoplamento com UI, sem leitura/escrita em localStorage,
 *   sem Supabase, sem alteração de stores existentes.
 * - Resultado vazio ou indisponível NÃO deve quebrar o cadastro manual.
 */

export type MercadoNearbyProvider =
  | "manual_only"
  | "google_places"
  | "openstreetmap";

export type MercadoNearbyResult = {
  id: string;
  nome: string;
  endereco?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
  distanciaKm?: number;
  latitude?: number;
  longitude?: number;
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
  /** Coordenadas opcionais (geolocalização do navegador, com opt-in). */
  latitude?: number;
  longitude?: number;
  /** Raio de busca em km (apenas hint para provider futuro). */
  radiusKm?: number;
};

export type MercadoNearbyResponse =
  | { ok: true; results: MercadoNearbyResult[]; provider: MercadoNearbyProvider }
  | { ok: false; error: MercadoNearbyError; provider: MercadoNearbyProvider };

/**
 * Provider ativo no momento. Enquanto não houver backend seguro para
 * consultar Google Places / Overpass, mantemos "manual_only" para que a UI
 * exiba a mensagem de preparação e o usuário continue cadastrando à mão.
 */
export const ACTIVE_NEARBY_PROVIDER: MercadoNearbyProvider = "manual_only";

// ---------------------------------------------------------------------------
// Normalizadores (puros, sem efeito colateral)
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
// Busca pública (preparada — não ativa)
// ---------------------------------------------------------------------------

/**
 * Busca mercados próximos. Nesta etapa retorna sempre
 * `provider_unavailable` quando o provider ativo é `manual_only`, sinalizando
 * para a UI que ela deve manter o cadastro manual.
 *
 * Quando google_places/openstreetmap forem ativados, a implementação real
 * deve ocorrer aqui chamando uma createServerFn no backend — nunca um fetch
 * direto para provider externo no client.
 */
export async function findNearbyMarkets(
  query: MercadoNearbyQuery,
): Promise<MercadoNearbyResponse> {
  if (!isValidNearbyQuery(query)) {
    return {
      ok: false,
      error: { code: "invalid_location" },
      provider: ACTIVE_NEARBY_PROVIDER,
    };
  }

  // Provider ainda não ativado. Resposta controlada — não quebra a UI.
  return {
    ok: false,
    error: { code: "provider_unavailable" },
    provider: ACTIVE_NEARBY_PROVIDER,
  };
}
