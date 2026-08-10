import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkRateLimit, getClientIp } from "@/server/rate-limit.server";

const cspReportSchema = z.object({
  "csp-report": z
    .object({
      "document-uri": z.string().optional(),
      referrer: z.string().optional(),
      "violated-directive": z.string().optional(),
      "effective-directive": z.string().optional(),
      "original-policy": z.string().optional(),
      disposition: z.string().optional(),
      "blocked-uri": z.string().optional(),
      "line-number": z.number().optional(),
      "column-number": z.number().optional(),
      "source-file": z.string().optional(),
      "status-code": z.number().optional(),
      "script-sample": z.string().optional(),
    })
    .passthrough(),
});

export const Route = createFileRoute("/api/public/csp-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // 1. Verificar content-type (application/csp-report ou application/json)
          const contentType = request.headers.get("content-type");
          if (
            !contentType?.includes("application/csp-report") &&
            !contentType?.includes("application/json")
          ) {
            return new Response(null, { status: 415 });
          }

          // 2. Limite de tamanho do body (10KB)
          const bodyText = await request.text();
          if (bodyText.length > 10000) {
            return new Response("Payload too large", { status: 413 });
          }

          const ip = getClientIp(request) ?? "unknown";
          const rl = await checkRateLimit({
            key: `csp-report:${ip}`,
            route: "/api/public/csp-report",
            limit: 60,
            windowSeconds: 300,
            ip_address: ip,
            method: "POST",
          });
          if (rl.blocked) return new Response(null, { status: 429 });

          const payload = JSON.parse(bodyText);
          const validated = cspReportSchema.safeParse(payload);

          if (validated.success) {
            const report = validated.data["csp-report"];

            // 3. Persistência Sanitizada (Remover queries, fragments, tokens)
            const sanitizeUrl = (url?: string) => {
              if (!url) return undefined;
              try {
                const u = new URL(url);
                return `${u.origin}${u.pathname}`; // Remove query e hash
              } catch {
                return url.split("?")[0].split("#")[0];
              }
            };

            const documentUri = sanitizeUrl(report["document-uri"]);
            const blockedUri = sanitizeUrl(report["blocked-uri"]);

            // Log no console para monitoramento rápido
            console.log("[CSP Report Received]", {
              documentUri,
              blockedUri,
              directive: report["effective-directive"],
            });

            // Persistência no banco (tabela dedicada, fail-closed: apenas service_role escreve)
            const { error } = await supabaseAdmin.from("csp_reports").insert({
              document_uri: documentUri,
              referrer: sanitizeUrl(report["referrer"]),
              violated_directive: report["violated-directive"],
              effective_directive: report["effective-directive"],
              original_policy: report["original-policy"]?.substring(0, 2000),
              disposition: report["disposition"],
              blocked_uri: blockedUri,
              line_number: report["line-number"],
              column_number: report["column-number"],
              source_file: sanitizeUrl(report["source-file"]),
              status_code: report["status-code"],
              script_sample: report["script-sample"]?.substring(0, 100), // Limitar tamanho da amostra
              user_agent: request.headers.get("user-agent")?.substring(0, 512),
            });

            if (error) {
              console.error("[CSP Report Persistence Error]", error);
            }
          } else {
            // Payload não é um relatório CSP válido: rejeitar sem persistir.
            return new Response("Invalid CSP report", { status: 400 });
          }

          // Resposta 204 conforme especificação da CSP
          return new Response(null, { status: 204 });
        } catch {
          // JSON inválido / corpo ilegível
          return new Response("Invalid CSP report", { status: 400 });
        }

      },
    },
  },
});
