import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const cspReportSchema = z.object({
  "csp-report": z.object({
    "document-uri": z.string().optional(),
    "referrer": z.string().optional(),
    "violated-directive": z.string().optional(),
    "effective-directive": z.string().optional(),
    "original-policy": z.string().optional(),
    "disposition": z.string().optional(),
    "blocked-uri": z.string().optional(),
    "line-number": z.number().optional(),
    "column-number": z.number().optional(),
    "source-file": z.string().optional(),
    "status-code": z.number().optional(),
    "script-sample": z.string().optional(),
  }).passthrough()
});

export const Route = createFileRoute("/api/public/csp-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Opção A: Endpoint Próprio
        // Requisitos: POST, Limite de tamanho, Sanitização, 204.
        
        try {
          // Rate limit simplificado (token bucket no Worker seria ideal, aqui simulamos recepção segura)
          const contentType = request.headers.get("content-type");
          if (!contentType?.includes("application/csp-report") && !contentType?.includes("application/json")) {
            return new Response(null, { status: 415 });
          }

          const bodyText = await request.text();
          if (bodyText.length > 10000) { // Limite 10KB
            return new Response("Payload too large", { status: 413 });
          }

          const payload = JSON.parse(bodyText);
          const validated = cspReportSchema.safeParse(payload);

          if (validated.success) {
            const report = validated.data["csp-report"];
            // Sanitização e Log (em produção enviaria para um log aggregator/DB)
            console.log("[CSP Report]", {
              uri: report["document-uri"]?.split("?")[0], // Remove query strings
              directive: report["violated-directive"],
              blocked: report["blocked-uri"]?.split("?")[0],
            });
          }

          return new Response(null, { status: 204 });
        } catch (e) {
          return new Response(null, { status: 204 }); // Fail silent para o browser
        }
      },
    },
  },
});

