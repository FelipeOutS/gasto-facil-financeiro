import { createFileRoute } from "@tanstack/react-router";
import {
  getUserFromRequest,
  unauthorizedResponse,
  isAdminMasterUser,
  forbiddenResponse,
} from "@/server/api-auth";
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
          let body: { period?: string; beginDate?: string; endDate?: string; months?: unknown } =
            {};
          try {
            const text = await request.text();
            if (text) body = JSON.parse(text);
          } catch {
            body = {};
          }

          // === Modo MESES (preferido) ===
          if (Array.isArray(body.months)) {
            const raw = body.months as unknown[];
            if (raw.length === 0) {
              return Response.json(
                {
                  ok: false,
                  error: "no_months",
                  message: "Selecione pelo menos um mês para sincronizar.",
                },
                { status: 400 },
              );
            }
            if (raw.length > 12) {
              return Response.json(
                {
                  ok: false,
                  error: "too_many_months",
                  message: "Selecione no máximo 12 meses por sincronização.",
                },
                { status: 400 },
              );
            }
            const re = /^\d{4}-(0[1-9]|1[0-2])$/;
            const now = new Date();
            const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
            const months: string[] = [];
            for (const item of raw) {
              if (typeof item !== "string" || !re.test(item)) {
                return Response.json(
                  {
                    ok: false,
                    error: "invalid_month",
                    message: "Formato de mês inválido. Use AAAA-MM.",
                  },
                  { status: 400 },
                );
              }
              if (item > nowKey) {
                return Response.json(
                  {
                    ok: false,
                    error: "future_month",
                    message: "Não é possível sincronizar meses futuros.",
                  },
                  { status: 400 },
                );
              }
              if (!months.includes(item)) months.push(item);
            }
            const result = await syncMercadoPagoTransactions(user.id, { period: "months", months });
            return Response.json(result, { status: result.ok ? 200 : 400 });
          }

          // === Modo PERÍODO (compatibilidade) ===
          const allowed = new Set([
            "last30",
            "current_month",
            "last_month",
            "last3",
            "last6",
            "last12",
            "custom",
          ]);
          const period =
            body.period && allowed.has(body.period)
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
