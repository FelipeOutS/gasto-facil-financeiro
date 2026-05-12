/**
 * Server functions do Radar Econômico.
 *
 * Client-safe: pode ser importado por componentes (o build substitui pela
 * chamada RPC). Toda a lógica sensível (fetch externo, service role) vive
 * em radar.server.ts e nunca chega ao bundle do cliente.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRadarIndicators } from "./radar.server";

/**
 * Retorna os indicadores econômicos com cache.
 *
 * - Sem auth: dados públicos de mercado.
 * - Cache: 30 minutos (gerenciado no servidor).
 * - Falha externa: degrada para o último valor salvo com status "desatualizado".
 */
export const getEconomicRadar = createServerFn({ method: "GET" }).handler(async () => {
  return getRadarIndicators();
});

/**
 * Força refresh ignorando o TTL do cache. Útil para um endpoint de cron
 * ou um botão administrativo.
 */
export const refreshEconomicRadar = createServerFn({ method: "POST" }).handler(async () => {
  return getRadarIndicators({ force: true });
});
