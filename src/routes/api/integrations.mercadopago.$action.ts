import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest, unauthorizedResponse } from "@/server/api-auth";
import {
  syncMercadoPagoTransactions,
  disconnectMercadoPago,
  getIntegrationSummary,
} from "@/server/mercado-pago-integration.server";

/**
 * POST /api/integrations/mercadopago/sync     -> sincroniza
 * POST /api/integrations/mercadopago/disconnect -> desconecta
 * GET  /api/integrations/mercadopago/status   -> resumo (configurado/conectado/contagem)
 */
export const Route = createFileRoute("/api/integrations/mercadopago/$action")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await getUserFromRequest(request);
        if (!user) return unauthorizedResponse();
        if (params.action !== "status") {
          return new Response("not_found", { status: 404 });
        }
        const summary = await getIntegrationSummary(user.id);
        return Response.json(summary);
      },
      POST: async ({ request, params }) => {
        const user = await getUserFromRequest(request);
        if (!user) return unauthorizedResponse();

        if (params.action === "sync") {
          const result = await syncMercadoPagoTransactions(user.id);
          return Response.json(result, { status: result.ok ? 200 : 400 });
        }
        if (params.action === "disconnect") {
          const result = await disconnectMercadoPago(user.id);
          return Response.json(result);
        }
        return new Response("not_found", { status: 404 });
      },
    },
  },
});
