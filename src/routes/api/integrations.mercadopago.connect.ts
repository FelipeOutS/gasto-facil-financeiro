import { createFileRoute, redirect } from "@tanstack/react-router";
import { getUserFromRequest, unauthorizedResponse } from "@/server/api-auth";
import { startMercadoPagoOAuth } from "@/server/mercado-pago-integration.server";

/**
 * GET /api/integrations/mercadopago/connect
 * Gera URL de autorização e redireciona o usuário.
 */
export const Route = createFileRoute("/api/integrations/mercadopago/connect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getUserFromRequest(request);
        if (!user) return unauthorizedResponse();
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
