/**
 * Identificador único e imutável do build.
 *
 * Gerado UMA vez, no carregamento do `vite.config.ts` (ou seja, uma vez por
 * build), e injetado via `define` — o mesmo valor no bundle do cliente, no
 * servidor e no endpoint `/api/public/app-version`. Nunca é gerado por request.
 *
 * O incidente P0 de 2026-08-07 aconteceu justamente porque o valor anterior era
 * uma string literal fixa no código: builds diferentes tinham o mesmo BUILD_ID,
 * então nenhuma comparação de versão detectava version skew.
 */

declare const __GI_BUILD_ID__: string;
declare const __GI_DEPLOYED_AT__: string;

export const BUILD_ID: string =
  typeof __GI_BUILD_ID__ === "string" ? __GI_BUILD_ID__ : "dev-unknown";

export const DEPLOYED_AT: string =
  typeof __GI_DEPLOYED_AT__ === "string" ? __GI_DEPLOYED_AT__ : "1970-01-01T00:00:00.000Z";
