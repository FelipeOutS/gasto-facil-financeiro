import { createFileRoute } from "@tanstack/react-router";
import {
  getUserFromRequest,
  unauthorizedResponse,
  isAdminMasterUser,
  forbiddenResponse,
} from "@/server/api-auth";
import { startMercadoPagoOAuth } from "@/server/mercado-pago-integration.server";

/**
 * GET /api/integrations/mercadopago/connect
 * Gera URL de autorização e redireciona o usuário.
 */
export const Route = createFileRoute("/api/integrations/mercadopago/connect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getUserFromRequest(request);
        if (!user) return unauthorizedResponse();
        if (!isAdminMasterUser(user)) return forbiddenResponse();

        const result = startMercadoPagoOAuth(user.id);
        if ("error" in result) {
          return Response.json(
            {
              error: "not_configured",
              message: "Integração preparada, aguardando configuração das credenciais.",
            },
            { status: 503 },
          );
        }

        return Response.json({ url: result.url });
      },
      GET: async ({ request }) => {
        const user = await getUserFromRequest(request);
        if (!user) {
          return Response.redirect(new URL("/login", request.url).toString(), 302);
        }
        if (!isAdminMasterUser(user)) {
          return Response.redirect(new URL("/app/dashboard", request.url).toString(), 302);
        }
        const result = startMercadoPagoOAuth(user.id);
        if ("error" in result) {
          // App ainda não configurado — manda de volta com flag
          return Response.redirect(
            new URL("/app/integracoes/mercado-pago?error=not_configured", request.url).toString(),
            302,
          );
        }
        return Response.redirect(result.url, 302);
      },
    },
  },
});
