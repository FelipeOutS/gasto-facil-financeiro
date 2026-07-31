import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logAuditEvent, logWebhookEvent, updateWebhookLog } from "@/server/logs.server";
import { checkRateLimit, getClientIp, RATE_LIMIT_PRESETS } from "@/server/rate-limit.server";
import { canonicalMpStatus } from "@/server/mercadopago-diagnostics.server";
import {
  applyMercadoPagoBillingEvent,
  type CanonicalBillingStatus,
} from "@/server/billing-mercadopago-apply.server";
import { resolveMercadoPagoCancellationKind } from "@/server/mercadopago-cancellation-resolver.server";
import {
  environmentForPersistence,
  resolveMercadoPagoConfig,
} from "@/server/mercadopago-config.server";
import { verifyMercadoPagoSignature } from "@/server/mercadopago-webhook-verify.server";
import {
  markCheckoutSessionConsumed,
  resolveCheckoutSession,
} from "@/server/mercadopago-checkout-session.server";
import { validateOfferAgainstProvider } from "@/server/mercadopago-plan-catalog.server";
import {
  payloadHash,
  sanitizeMercadoPagoPayload,
} from "@/server/mercadopago-payload-sanitize.server";
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

        // Validação de assinatura ANTES de qualquer leitura/escrita de negócio.
        const verification = verifyMercadoPagoSignature({
          signatureHeader: request.headers.get("x-signature"),
          requestId: request.headers.get("x-request-id"),
          dataId,
          secret: webhookSecret,
        });
        if (!verification.ok) {
          if (logId)
            await updateWebhookLog(logId, {
              status: "failed",
              http_status: verification.httpStatus,
              error_message: verification.reason ?? "invalid_signature",
              processing_time_ms: Date.now() - startedAt,
            });
          return json({ error: verification.reason ?? "invalid_signature" }, verification.httpStatus);
        }


        // Resolve paymentId (pode vir direto ou via merchant_order)
        let paymentId: string | null = null;
        if (topic.includes("payment")) {
          paymentId = dataId;
        } else if (topic.includes("merchant_order")) {
          const mo = await fetchMerchantOrder(accessToken, dataId ?? "");
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

        const externalPaymentId = String(payment.id ?? paymentId);
        const idempotencyKey = `mercado_pago:${topic}:${externalPaymentId}`;
        const rawStatus = (payment.status ?? "pending").toLowerCase();

        // ------------------------------------------------------------------
        // Resolução DETERMINÍSTICA do usuário/plano.
        //
        // Ordem: sessão interna de checkout (referência opaca validada por
        // checksum → provider_payment_id → preference_id). Nada de fallback
        // "qualquer pagamento do mesmo usuário", que podia cruzar cobranças
        // de usuários com múltiplos pagamentos pendentes.
        // ------------------------------------------------------------------
        const resolution = await resolveCheckoutSession({
          externalReference: payment.external_reference ?? null,
          providerPaymentId: externalPaymentId,
          providerPreferenceId:
            (payment as { preference_id?: string }).preference_id ??
            (payment as { metadata?: { checkout_session_id?: string } }).metadata
              ?.checkout_session_id ??
            null,
          environment: webhookEnvironment === "sandbox" ? "sandbox" : "production",
          allowExpired: true,
        });

        let userId: string | null = null;
        let plano: string | null = null;
        let periodicidade: string | null = null;
        let months = 0;
        let checkoutSessionId: string | null = null;
        let localRow: { id: string; user_id: string; plano: string | null } | null = null;

        if (resolution.ok) {
          const s = resolution.session;
          userId = s.user_id;
          plano = s.plan_key;
          periodicidade = s.periodicity;
          months = Number(s.expected_amount_cents) >= 0 ? 0 : 0;
          checkoutSessionId = s.id;
          periodicidade = s.periodicity;

          // Validação de oferta: o que o provedor cobrou tem de coincidir com
          // a oferta oficial persistida. Divergência ⇒ não libera plano.
          const offerCheck = validateOfferAgainstProvider({
            expected: {
              planKey: s.plan_key,
              periodicity: s.periodicity,
              amountCents: s.expected_amount_cents,
              currency: s.currency,
            },
            provider: {
              amountCents:
                typeof (payment as { transaction_amount?: number }).transaction_amount === "number"
                  ? Math.round(
                      ((payment as { transaction_amount?: number }).transaction_amount as number) *
                        100,
                    )
                  : null,
              currency: (payment as { currency_id?: string }).currency_id ?? null,
            },
          });
          if (!offerCheck.ok) {
            console.warn("[mp webhook] oferta divergente — plano NÃO liberado", {
              mismatches: offerCheck.mismatches,
              external_payment_id: externalPaymentId,
            });
            if (logId) {
              await updateWebhookLog(logId, {
                status: "failed",
                http_status: 409,
                external_id: externalPaymentId,
                error_message: `offer_mismatch:${offerCheck.mismatches.join("|")}`,
                processing_time_ms: Date.now() - startedAt,
              });
            }
            return json({ error: "offer_mismatch" }, 409);
          }
          const meta = (resolution.session as unknown as { metadata?: { months?: number } })
            .metadata;
          months = Number(meta?.months ?? 0) || 0;
        } else if (
          resolution.error === "environment_mismatch" ||
          resolution.error === "invalid_reference"
        ) {
          // Fail-closed: evento de outro ambiente ou referência forjada.
          if (logId) {
            await updateWebhookLog(logId, {
              status: "failed",
              http_status: 409,
              external_id: externalPaymentId,
              error_message: resolution.error,
              processing_time_ms: Date.now() - startedAt,
            });
          }
          return json({ error: resolution.error }, 409);
        }

        // Pagamentos LEGADOS (criados antes do Prompt 4A, sem sessão interna):
        // resolução estrita pelo provider_payment_id — nunca por usuário.
        if (!userId) {
          const { data: legacyRow } = await supabaseAdmin
            .from("subscription_payments")
            .select("id, user_id, plano, periodicidade, months, method, provider_payment_id")
            .eq("provider", "mercadopago")
            .eq("provider_payment_id", externalPaymentId)
            .maybeSingle();
          if (legacyRow) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const lr = legacyRow as any;
            userId = lr.user_id ?? null;
            plano = lr.plano ?? null;
            periodicidade = lr.periodicidade ?? null;
            months = Number(lr.months ?? 0) || 0;
            localRow = { id: lr.id, user_id: lr.user_id, plano: lr.plano ?? null };
          }
        }

        if (!localRow && checkoutSessionId) {
          const { data: sessionRow } = await supabaseAdmin
            .from("subscription_payments")
            .select("id, user_id, plano")
            .eq("checkout_session_id", checkoutSessionId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (sessionRow) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sr = sessionRow as any;
            localRow = { id: sr.id, user_id: sr.user_id, plano: sr.plano ?? null };
          }
        }

        if (!months) months = 1;
        if (checkoutSessionId && APPROVED.has(rawStatus)) {
          await markCheckoutSessionConsumed(checkoutSessionId, "approved");
        }

        // Atualiza subscription_payments — trilha auditável do pagamento.
        // Payload SANITIZADO: sem dados do pagador, documento, cartão ou tokens.
        const safePayload = sanitizeMercadoPagoPayload(payment);
        const auditPatch = {
          status: rawStatus,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          payload: safePayload as any,
          paid_at: APPROVED.has(rawStatus) ? new Date().toISOString() : null,
          environment: webhookEnvironment,
          received_at: new Date().toISOString(),
          payload_hash: payloadHash(rawBody),
        };
        if (localRow) {
          await supabaseAdmin
            .from("subscription_payments")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .update({ ...auditPatch, provider_payment_id: externalPaymentId } as any)
            .eq("id", localRow.id);
        } else {
          await supabaseAdmin
            .from("subscription_payments")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .update(auditPatch as any)
            .eq("provider", "mercadopago")
            .eq("provider_payment_id", externalPaymentId);
        }

        // WA-C11 F2: aplicação atômica via helper central. A RPC encapsula:
        //   - idempotência L1 (unique) + L2 (provider_updated_at + tiebreak);
        //   - upsert user_plans conforme canonical;
        //   - invalidação atômica de whatsapp_notifications pending sem attempt/claim
        //     quando entitlement transiciona true→false;
        //   - lock advisory por user_id para concorrência.
        let applyOutcome: string = "skipped_no_user";
        let notificationsInvalidated = 0;
        if (userId) {
          // Deriva canonical override quando o topic é explicito (refund/chargeback via
          // notification separada do MP mesmo com status ainda "approved" no recurso).
          let overrideCanonical: CanonicalBillingStatus | null = null;
          let cancellationKind: "immediate" | "scheduled" | null = null;
          if (topic.includes("refund")) overrideCanonical = "refunded";
          else if (topic.includes("chargeback") || topic.includes("charged_back"))
            overrideCanonical = "chargeback";
          else if (rawStatus === "cancelled" || rawStatus === "canceled") {
            // WA-C11 F2.2: classificar via resolver autoritativo, sem confiar em
            // hint do frontend. Lê current_period_end persistido para preservar
            // período pago vigente (scheduled) vs. encerrar imediatamente.
            const { data: planRow } = await supabaseAdmin
              .from("user_plans")
              .select("current_period_end")
              .eq("user_id", userId)
              .maybeSingle();
            const resolved = resolveMercadoPagoCancellationKind({
              rawStatus: payment.status ?? null,
              dateApproved: (payment as { date_approved?: string }).date_approved ?? null,
              dateLastUpdated:
                (payment as { date_last_updated?: string }).date_last_updated ?? null,
              months,
              currentPeriodEnd: planRow?.current_period_end ?? null,
            });
            if (resolved.kind === "scheduled") {
              overrideCanonical = "cancelled_scheduled";
              cancellationKind = "scheduled";
            } else if (resolved.kind === "immediate") {
              overrideCanonical = "cancelled_immediate";
              cancellationKind = "immediate";
            }
            // unknown/not_cancelled: sem override — helper aplica normalização
            // padrão preservando fail-closed sem encurtar período pago.
          }

          const applyResult = await applyMercadoPagoBillingEvent({
            payment: {
              id: payment.id ?? paymentId,
              status: payment.status,
              date_last_updated: (payment as { date_last_updated?: string }).date_last_updated,
              date_approved: (payment as { date_approved?: string }).date_approved,
              date_created: (payment as { date_created?: string }).date_created,
              transaction_amount: (payment as { transaction_amount?: number }).transaction_amount,
              currency_id: (payment as { currency_id?: string }).currency_id,
              external_reference: payment.external_reference ?? null,
              metadata: payment.metadata ?? null,
            },
            userId,
            plano: plano as PlanTier | null,
            periodicidade,
            months,
            eventType: topic,
            overrideCanonical,
            cancellationKind,
          });

          applyOutcome = applyResult.outcome;
          notificationsInvalidated = applyResult.notificationsInvalidated ?? 0;

          // Audit trail apenas em transições bloqueantes efetivas.
          if (
            applyResult.ok &&
            applyResult.outcome === "event_applied" &&
            applyResult.hadWhatsAppBefore &&
            applyResult.hasWhatsAppAfter === false
          ) {
            await logAuditEvent({
              actor_user_id: null,
              action: "payment_access_revoked",
              target_user_id: userId,
              entity_type: "user_plan",
              entity_id: userId,
              metadata: {
                source: "mp_webhook",
                canonical_status: applyResult.canonicalStatus,
                notifications_invalidated: notificationsInvalidated,
                external_payment_id: externalPaymentId,
              },
            });
          }
        }

        // Idempotência já é resolvida dentro da RPC. Se outcome=duplicate_event
        // ou stale_event_skipped, respondemos sucesso idempotente.
        if (applyOutcome === "duplicate_event") {
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

        if (logId) {
          await updateWebhookLog(logId, {
            status: "processed",
            http_status: 200,
            external_id: externalPaymentId,
            user_id: userId ?? null,
            idempotency_key: idempotencyKey,
            processing_time_ms: Date.now() - startedAt,
            response_body: {
              ok: true,
              payment_status: rawStatus,
              apply_outcome: applyOutcome,
              notifications_invalidated: notificationsInvalidated,
            },
          });
        }
        // Sinaliza no console também o status canonical para a linter/scan.
        void canonicalMpStatus(rawStatus);
        return json({ ok: true, outcome: applyOutcome });
      },
    },
  },
});
