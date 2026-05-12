/**
 * Endpoint HTTP público do Radar Econômico.
 *
 * GET /api/economic-radar
 *
 * Retorna as cotações de dólar e euro com cache de 30 minutos. Em caso
 * de falha da API externa, devolve o último valor conhecido marcando
 * status como "desatualizado". Não exige autenticação — são dados
 * públicos de mercado, sem PII.
 *
 * Útil para:
 *  - chamadas a partir do dashboard (via fetch, como alternativa à server fn);
 *  - jobs externos (cron) que precisem aquecer o cache.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getRadarIndicators } from "@/server/radar.server";

export const Route = createFileRoute("/api/economic-radar")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const force = url.searchParams.get("force") === "1";
        try {
          const result = await getRadarIndicators({ force });
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "public, max-age=60",
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[/api/economic-radar] erro:", message);
          return new Response(
            JSON.stringify({
              indicators: [],
              status: "desatualizado",
              fetchedAt: new Date(0).toISOString(),
              message:
                "Não foi possível obter as cotações no momento. Tente novamente em instantes.",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json; charset=utf-8" },
            },
          );
        }
      },
    },
  },
});
