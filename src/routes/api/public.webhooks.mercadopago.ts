import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logAuditEvent, logWebhookEvent, updateWebhookLog } from "@/server/logs.server";
import { checkRateLimit, getClientIp, RATE_LIMIT_PRESETS } from "@/server/rate-limit.server";
import { canonicalMpStatus } from "@/server/mercadopago-diagnostics.server";
import {
  applyMercadoPagoBillingEvent,
  type CanonicalBillingStatus,
} from "@/server/billing-mercadopago-apply.server";
import type { Database } from "@/integrations/supabase/types";
type PlanTier = Database["public"]["Enums"]["plan_tier"];

/**
 * POST /api/public/webhooks/mercadopago
 *
 * Recebe notificações do Mercado Pago (Pix e Cartão via Checkout Pro).
 * Quando o pagamento é aprovado, atualiza `subscription_payments` e ativa
 * o plano em `user_plans` com `current_period_end` calculado a partir
 * da periodicidade contratada (1, 3, 6 ou 12 meses).
 *
 * Verificação via `MERCADO_PAGO_WEBHOOK_SECRET` (header `x-signature`).
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const APPROVED = new Set(["approved", "authorized"]);
const FAILED = new Set(["rejected", "cancelled", "refunded", "charged_back"]);

type MpPayment = {
  id?: number | string;
  status?: string;
  external_reference?: string | null;
  metadata?: {
    user_id?: string;
    plano?: string;
    periodicidade?: string;
    months?: number | string;
  };
};

async function fetchPayment(accessToken: string, paymentId: string): Promise<MpPayment | null> {
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as MpPayment;
}

async function fetchMerchantOrder(
  accessToken: string,
  orderId: string,
): Promise<{ paymentId?: string } | null> {
  const res = await fetch(`https://api.mercadopago.com/merchant_orders/${orderId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    payments?: Array<{ id?: number | string; status?: string }>;
  };
  const payments = data.payments ?? [];
  const approved = payments.find((p) => (p.status ?? "").toLowerCase() === "approved");
  const target = approved ?? payments[payments.length - 1];
  return target?.id ? { paymentId: String(target.id) } : null;
}

export const Route = createFileRoute("/api/public/webhooks/mercadopago")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const startedAt = Date.now();
        const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
        const webhookSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
        if (!accessToken || !webhookSecret) {
          return json({ error: "webhook_not_configured" }, 503);
        }

        // Rate limit por IP+rota antes de qualquer trabalho pesado.
        const ip = getClientIp(request);
        const ua = request.headers.get("user-agent");
        const rl = await checkRateLimit({
          key: `mp_webhook:${ip ?? "unknown"}`,
          route: "/api/public/webhooks/mercadopago",
          ip_address: ip,
          user_agent: ua,
          method: "POST",
          ...RATE_LIMIT_PRESETS.mpWebhook,
        });
        if (rl.blocked) {
          await logWebhookEvent({
            provider: "mercado_pago",
            status: "ignored",
            http_status: 429,
            request_headers: request.headers,
            error_message: "rate_limited",
            processing_time_ms: Date.now() - startedAt,
          });
          return new Response(JSON.stringify({ error: "rate_limited" }), {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(rl.retryAfterSeconds),
            },
          });
        }

        const rawBody = await request.text();
        let body: {
          type?: string;
          topic?: string;
          action?: string;
          data?: { id?: string | number };
          resource?: string;
        } = {};
        try {
          body = JSON.parse(rawBody) as typeof body;
        } catch {
          await logWebhookEvent({
            provider: "mercado_pago",
            status: "failed",
            http_status: 400,
            request_headers: request.headers,
            error_message: "invalid_body",
          });
          return json({ error: "invalid_body" }, 400);
        }

        const topic = (body.type ?? body.topic ?? "").toLowerCase();
        const dataId = body.data?.id ? String(body.data.id) : null;

        // Log inicial "received"
        const logId = await logWebhookEvent({
          provider: "mercado_pago",
          event_type: topic || null,
          external_id: dataId,
          status: "received",
          request_headers: request.headers,
          request_body: body,
        });

        // Validação de assinatura
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
        if (!ts || !v1 || !dataId) {
          if (logId) await updateWebhookLog(logId, { status: "failed", http_status: 401, error_message: "missing_signature", processing_time_ms: Date.now() - startedAt });
          return json({ error: "missing_signature" }, 401);
        }
        const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
        const expected = createHmac("sha256", webhookSecret).update(manifest).digest("hex");
        const a = Buffer.from(expected, "hex");
        const b = Buffer.from(v1, "hex");
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          if (logId) await updateWebhookLog(logId, { status: "failed", http_status: 401, error_message: "invalid_signature", processing_time_ms: Date.now() - startedAt });
          return json({ error: "invalid_signature" }, 401);
        }


        // Resolve paymentId (pode vir direto ou via merchant_order)
        let paymentId: string | null = null;
        if (topic.includes("payment")) {
          paymentId = dataId;
        } else if (topic.includes("merchant_order")) {
          const mo = await fetchMerchantOrder(accessToken, dataId);
          paymentId = mo?.paymentId ?? null;
        } else {
          // tipo desconhecido — tenta como payment
          paymentId = dataId;
        }
        if (!paymentId) {
          if (logId) await updateWebhookLog(logId, { status: "ignored", http_status: 200, processing_time_ms: Date.now() - startedAt });
          return json({ ok: true, ignored: true });
        }

        const payment = await fetchPayment(accessToken, paymentId);
        if (!payment) {
          if (logId) await updateWebhookLog(logId, { status: "failed", http_status: 502, error_message: "mp_fetch_failed", processing_time_ms: Date.now() - startedAt });
          return json({ error: "mp_fetch_failed" }, 502);
        }

        // Idempotência: já processamos esse evento?
        const externalPaymentId = String(payment.id ?? paymentId);
        const idempotencyKey = `mercado_pago:${topic}:${externalPaymentId}`;
        const already = await paymentEventAlreadyProcessed(externalPaymentId, topic);
        if (already) {
          if (logId) {
            await updateWebhookLog(logId, {
              status: "ignored",
              http_status: 200,
              external_id: externalPaymentId,
              idempotency_key: idempotencyKey,
              error_message: "duplicate_event",
              processing_time_ms: Date.now() - startedAt,
            });
          }
          return json({ ok: true, duplicate: true });
        }

        const status = (payment.status ?? "pending").toLowerCase();
        let userId = payment.metadata?.user_id ?? null;
        let plano = payment.metadata?.plano ?? null;
        let periodicidade = (payment.metadata?.periodicidade as string | undefined) ?? null;
        let months = Number(payment.metadata?.months ?? 0) || 0;

        // Fallback via external_reference "userId:plano:periodicidade"
        if ((!userId || !plano) && payment.external_reference) {
          const parts2 = payment.external_reference.split(":");
          userId = userId ?? parts2[0] ?? null;
          plano = plano ?? parts2[1] ?? null;
          periodicidade = periodicidade ?? parts2[2] ?? null;
        }

        // Tenta enriquecer dados a partir de subscription_payments locais.
        // 1) por provider_payment_id direto (pix), ou 2) onde o ticket_url
        // contém o paymentId (cartão — preference).
        const { data: localRows } = await supabaseAdmin
          .from("subscription_payments")
          .select("id, user_id, plano, periodicidade, months, method, provider_payment_id")
          .eq("provider", "mercadopago")
          .or(
            `provider_payment_id.eq.${String(payment.id ?? paymentId)},user_id.eq.${userId ?? "00000000-0000-0000-0000-000000000000"}`,
          )
          .order("created_at", { ascending: false })
          .limit(20);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const localRow = (localRows ?? []).find((r: any) =>
          r.provider_payment_id === String(payment.id ?? paymentId)
            ? true
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            : (r as any).method === "card" && r.user_id === userId,
        );
        if (localRow) {
          userId = userId ?? localRow.user_id;
          plano = plano ?? localRow.plano;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          periodicidade = periodicidade ?? (localRow as any).periodicidade ?? null;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          months = months || Number((localRow as any).months ?? 0) || 0;
        }
        if (!months) months = 1;

        // Atualiza/insere registro de pagamento (quando ainda não existir,
        // por exemplo em cenário onde o paymentId real só apareceu agora).
        if (localRow) {
          await supabaseAdmin
            .from("subscription_payments")
            .update({
              status,
              payload: payment,
              provider_payment_id: String(payment.id ?? paymentId),
              paid_at: APPROVED.has(status) ? new Date().toISOString() : null,
            })
            .eq("id", localRow.id);
        } else {
          await supabaseAdmin
            .from("subscription_payments")
            .update({
              status,
              payload: payment,
              paid_at: APPROVED.has(status) ? new Date().toISOString() : null,
            })
            .eq("provider", "mercadopago")
            .eq("provider_payment_id", String(payment.id ?? paymentId));
        }

        if (userId && plano) {
          if (APPROVED.has(status)) {
            const startISO = new Date().toISOString();
            const end = new Date();
            end.setMonth(end.getMonth() + months);
            const endISO = end.toISOString();
            const update = {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              plano: plano as any,
              status: "ativo",
              cancelled_at: null,
              access_until: null,
              periodicidade,
              months,
              current_period_start: startISO,
              current_period_end: endISO,
              last_payment_id: String(payment.id ?? paymentId),
            };
            const { data: existing } = await supabaseAdmin
              .from("user_plans")
              .select("user_id")
              .eq("user_id", userId)
              .maybeSingle();
            if (existing) {
              await supabaseAdmin
                .from("user_plans")
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .update(update as any)
                .eq("user_id", userId);
            } else {
              await supabaseAdmin
                .from("user_plans")
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .insert({ user_id: userId, ...update } as any);
            }
          } else if (FAILED.has(status)) {
            // Refund / chargeback / cancelamento posterior à aprovação:
            // se o plano atual foi ativado por este pagamento, revogar acesso.
            const externalId = String(payment.id ?? paymentId);
            const { data: planRow } = await supabaseAdmin
              .from("user_plans")
              .select("user_id, plano, status, last_payment_id, current_period_end, access_until")
              .eq("user_id", userId)
              .maybeSingle();
            if (planRow && planRow.last_payment_id && planRow.last_payment_id === externalId) {
              const nowIso = new Date().toISOString();
              const revoke =
                status === "refunded" || status === "charged_back" || status === "cancelled";
              if (revoke) {
                await supabaseAdmin
                  .from("user_plans")
                  .update({
                    status: "cancelado",
                    cancelled_at: nowIso,
                    access_until: nowIso,
                    current_period_end: nowIso,
                  })
                  .eq("user_id", userId);
                await logAuditEvent({
                  actor_user_id: null,
                  action:
                    status === "refunded"
                      ? "payment_refunded"
                      : status === "charged_back"
                        ? "payment_charged_back"
                        : "payment_cancelled",
                  target_user_id: userId,
                  entity_type: "user_plan",
                  entity_id: userId,
                  new_data: { status: "cancelado", revoked: true, reason: status },
                  metadata: {
                    source: "mp_webhook",
                    external_payment_id: externalId,
                    previous_plan: planRow.plano,
                  },
                });
                await logAuditEvent({
                  actor_user_id: null,
                  action: "payment_access_revoked",
                  target_user_id: userId,
                  entity_type: "user_plan",
                  entity_id: userId,
                  metadata: {
                    source: "mp_webhook",
                    reason: status,
                    external_payment_id: externalId,
                  },
                });
              }
            }
          }
        }

        // Marca como processado (idempotência futura).
        await recordPaymentEventIdempotent({
          external_payment_id: externalPaymentId,
          event_type: topic,
          status: canonicalMpStatus(status),
          raw_status: status,
          user_id: userId ?? null,
          metadata: { source: "webhook" },
        });

        if (logId) {
          await updateWebhookLog(logId, {
            status: "processed",
            http_status: 200,
            external_id: externalPaymentId,
            user_id: userId ?? null,
            idempotency_key: idempotencyKey,
            processing_time_ms: Date.now() - startedAt,
            response_body: { ok: true, payment_status: status },
          });
        }
        return json({ ok: true });
      },
    },
  },
});
