import { createFileRoute } from "@tanstack/react-router";

/**
 * Endpoint de health check.
 * Recebe headers de segurança via functionMiddleware no roteador (camada TanStack Start).
 */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        });
      },
    },
  },
});


