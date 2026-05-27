/**
 * Mercado Inteligente — Server function preparatória para "Mercados próximos"
 * ----------------------------------------------------------------------------
 * Esta é a casca server-side da futura busca de mercados próximos. Nesta
 * etapa (E24) ela NÃO faz chamada real para Google Places ou Overpass.
 * Apenas estabelece o ponto de entrada seguro:
 *
 * - Roda apenas no servidor (createServerFn / TanStack Start).
 * - Lê `process.env.*` SOMENTE dentro de `.handler()` — nunca em escopo de
 *   módulo. Isso evita que qualquer chave externa seja bundleada no client.
 * - Valida a query com a mesma `isValidNearbyQuery` usada no client.
 * - Retorna o mesmo shape `MercadoNearbyResponse` exposto em
 *   `nearby-markets-api.ts`, para que a UI possa simplesmente trocar a fonte
 *   (de `findNearbyMarkets` local para esta server fn) sem refatoração.
 *
 * Como ativar futuramente (NÃO ativar agora):
 * 1. Configurar `GOOGLE_PLACES_API_KEY` em secrets do projeto (server-only,
 *    sem prefixo VITE_).
 * 2. Substituir o branch "manual_only" abaixo pela chamada real ao provider,
 *    sempre dentro de `.handler()`. Usar try/catch e mapear o resultado para
 *    `MercadoNearbyResult` (preencher `placeId` e `fonte`).
 * 3. Trocar o `ACTIVE_NEARBY_PROVIDER` em `nearby-markets-api.ts` e fazer a
 *    UI chamar `findNearbyMarketsServerFn` via `useServerFn`.
 *
 * Regras de segurança:
 * - NUNCA retornar a chave ou qualquer header de autenticação no payload.
 * - NUNCA persistir automaticamente os resultados — quem decide é o usuário.
 * - Aplicar timeout, rate-limit e cache antes de habilitar provider público.
 */

import { createServerFn } from "@tanstack/react-start";
import {
  ACTIVE_NEARBY_PROVIDER,
  isValidNearbyQuery,
  type MercadoNearbyQuery,
  type MercadoNearbyResponse,
} from "./nearby-markets-api";

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

    // Provider ativo é "manual_only" — nenhuma chamada externa por enquanto.
    // Quando google_places/openstreetmap_overpass forem ativados, ler aqui:
    //   const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    //   if (!apiKey) return { ok: false, provider, error: { code: "provider_unavailable" } };
    //   ... fetch com timeout + map para MercadoNearbyResult[] ...
    return {
      ok: false,
      provider: ACTIVE_NEARBY_PROVIDER,
      error: { code: "provider_unavailable" },
    };
  });
