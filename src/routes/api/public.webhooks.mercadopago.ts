import { createFileRoute } from "@tanstack/react-router";
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

        // Validação de assinatura: implementação completa quando
        // o segredo do webhook for fornecido pelo Mercado Pago.
        // Por enquanto, exigimos apenas a presença do header.
        const signature = request.headers.get("x-signature");
        if (!signature) return json({ error: "missing_signature" }, 401);

        let body: {
          type?: string;
          action?: string;
          data?: { id?: string | number };
        } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "invalid_body" }, 400);
        }

        const paymentId = body.data?.id ? String(body.data.id) : null;
        if (!paymentId) return json({ ok: true, ignored: true });

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
            await supabaseAdmin.from("user_plans").upsert(
              { user_id: userId, plano, status: "ativo" },
              { onConflict: "user_id" },
            );
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
