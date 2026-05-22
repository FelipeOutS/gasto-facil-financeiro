import { createFileRoute } from "@tanstack/react-router";
import { handleMercadoPagoCallback } from "@/server/mercado-pago-integration.server";

/**
 * GET /api/integrations/mercadopago/callback
 *
 * Mercado Pago redireciona para cá com ?code=...&state=...
 * Trocamos o code por tokens (server-side) e mandamos o usuário
 * de volta para a tela da integração.
 */
export const Route = createFileRoute("/api/integrations/mercadopago/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const err = url.searchParams.get("error");

        const back = new URL("/app/integracoes/mercado-pago", url.origin);

        if (err) {
          back.searchParams.set("error", err.slice(0, 60));
          return Response.redirect(back.toString(), 302);
        }
        if (!code || !state) {
          back.searchParams.set("error", "missing_params");
          return Response.redirect(back.toString(), 302);
        }

        const result = await handleMercadoPagoCallback({ code, state });
        if (!result.ok) {
          back.searchParams.set("error", result.error);
          return Response.redirect(back.toString(), 302);
        }
        back.searchParams.set("connected", "1");
        return Response.redirect(back.toString(), 302);
      },
    },
  },
});
