import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest, unauthorizedResponse, isAdminMasterUser, forbiddenResponse } from "@/server/api-auth";
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
        if (!isAdminMasterUser(user)) return forbiddenResponse();
        if (params.action !== "status") {
          return new Response("not_found", { status: 404 });
        }
        const summary = await getIntegrationSummary(user.id);
        return Response.json(summary);
      },
      POST: async ({ request, params }) => {
        const user = await getUserFromRequest(request);
        if (!user) return unauthorizedResponse();
        if (!isAdminMasterUser(user)) return forbiddenResponse();

        if (params.action === "sync") {
          let body: { period?: string; beginDate?: string; endDate?: string } = {};
          try {
            const text = await request.text();
            if (text) body = JSON.parse(text);
          } catch {
            body = {};
          }
          const allowed = new Set([
            "last30",
            "current_month",
            "last_month",
            "last3",
            "last6",
            "last12",
            "custom",
          ]);
          const period = body.period && allowed.has(body.period)
            ? (body.period as
                | "last30"
                | "current_month"
                | "last_month"
                | "last3"
                | "last6"
                | "last12"
                | "custom")
            : "last30";
          const result = await syncMercadoPagoTransactions(user.id, {
            period,
            beginDate: body.beginDate,
            endDate: body.endDate,
          });
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
