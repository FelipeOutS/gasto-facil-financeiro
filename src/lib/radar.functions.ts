/**
 * Server functions do Radar Econômico.
 *
 * Vive em src/lib/ (client-safe path) para passar pelo import-protection
 * do TanStack Start. radar.server é carregado dinamicamente dentro do
 * handler — fetch externo e service role não chegam ao bundle do cliente.
 */
import { createServerFn } from "@tanstack/react-start";

export const getEconomicRadar = createServerFn({ method: "GET" }).handler(async () => {
  const { getRadarIndicators } = await import("@/server/radar.server");
  return getRadarIndicators();
});

export const refreshEconomicRadar = createServerFn({ method: "POST" }).handler(async () => {
  const { getRadarIndicators } = await import("@/server/radar.server");
  return getRadarIndicators({ force: true });
});
