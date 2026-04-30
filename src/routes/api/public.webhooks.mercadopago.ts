import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * POST /api/public/webhooks/mercadopago
 *
 * Recebe notificações do Mercado Pago (Pix/cartão). Quando o pagamento
 * é aprovado, atualiza `subscription_payments` e ativa o plano em
 * `user_plans` (status = 'ativo'). Em falha, marca como 'expirado'/'cancelado'.
 *
 * A verificação da requisição é feita via `MERCADO_PAGO_WEBHOOK_SECRET`
 * (header `x-signature` no formato "ts=...,v1=..."). Se o secret não
 * estiver configurado, a rota responde 503 — não processa nada às cegas.
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const APPROVED = new Set(["approved", "authorized"]);
const FAILED = new Set(["rejected", "cancelled", "refunded", "charged_back"]);

export const Route = createFileRoute("/api/public/webhooks/mercadopago")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
        const webhookSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
        if (!accessToken || !webhookSecret) {
          return json({ error: "webhook_not_configured" }, 503);
        }

        // Lê o corpo bruto para validar a assinatura HMAC do Mercado Pago.
        const rawBody = await request.text();
        let body: {
          type?: string;
          action?: string;
          data?: { id?: string | number };
        } = {};
        try {
          body = JSON.parse(rawBody) as typeof body;
        } catch {
          return json({ error: "invalid_body" }, 400);
        }

        const paymentId = body.data?.id ? String(body.data.id) : null;

        // Validação de assinatura conforme docs do Mercado Pago:
        // header `x-signature` traz "ts=<timestamp>,v1=<hash>"; o manifest
        // a ser assinado é "id:<dataId>;request-id:<x-request-id>;ts:<ts>;".
        const signatureHeader = request.headers.get("x-signature") ?? "";
        const requestId = request.headers.get("x-request-id") ?? "";
        const parts = Object.fromEntries(
          signatureHeader.split(",").map((kv) => {
            const [k, ...rest] = kv.split("=");
            return [k?.trim() ?? "", rest.join("=").trim()];
          }),
        ) as Record<string, string>;
        const ts = parts.ts;
        const v1 = parts.v1;
        if (!ts || !v1 || !paymentId) {
          return json({ error: "missing_signature" }, 401);
        }
        const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
        const expected = createHmac("sha256", webhookSecret)
          .update(manifest)
          .digest("hex");
        const a = Buffer.from(expected, "hex");
        const b = Buffer.from(v1, "hex");
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return json({ error: "invalid_signature" }, 401);
        }

        // Busca status real direto na API do MP
        const res = await fetch(
          `https://api.mercadopago.com/v1/payments/${paymentId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!res.ok) return json({ error: "mp_fetch_failed" }, 502);
        const payment = (await res.json()) as {
          id?: number | string;
          status?: string;
          metadata?: { user_id?: string; plano?: string };
        };

        const status = payment.status ?? "pending";
        const userId = payment.metadata?.user_id;
        const plano = payment.metadata?.plano;

        // Atualiza registro de pagamento
        await supabaseAdmin
          .from("subscription_payments")
          .update({
            status,
            payload: payment,
            paid_at: APPROVED.has(status) ? new Date().toISOString() : null,
          })
          .eq("provider", "mercadopago")
          .eq("provider_payment_id", String(payment.id ?? paymentId));

        if (userId && plano) {
          if (APPROVED.has(status)) {
            const { data: existing } = await supabaseAdmin
              .from("user_plans")
              .select("user_id")
              .eq("user_id", userId)
              .maybeSingle();
            if (existing) {
              await supabaseAdmin
                .from("user_plans")
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .update({ plano: plano as any, status: "ativo" })
                .eq("user_id", userId);
            } else {
              await supabaseAdmin
                .from("user_plans")
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .insert({ user_id: userId, plano: plano as any, status: "ativo" });
            }
          } else if (FAILED.has(status)) {
            await supabaseAdmin
              .from("user_plans")
              .update({ status: "cancelado" })
              .eq("user_id", userId);
          }
        }

        return json({ ok: true });
      },
    },
  },
});
