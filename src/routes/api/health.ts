import { createFileRoute } from "@tanstack/react-router";
import { applySecurityHeaders } from "@/server/security-headers.server";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const response = new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        });
        applySecurityHeaders(response.headers);
        return response;
      },
    },
  },
});

