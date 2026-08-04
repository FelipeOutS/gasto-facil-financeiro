/**
 * WA-C11 FASE 2.1B — Helper central de aplicação atômica de eventos de billing
 * do Mercado Pago.
 *
 * Server-only — NUNCA importar em código client.
 *
 * Responsabilidades:
 *   - receber recurso autoritativo já consultado no Mercado Pago;
 *   - validar/normalizar campos;
 *   - determinar `canonical_status`, `plano` interno, `provider_updated_at`;
 *   - invocar `public.billing_apply_mercadopago_event_atomic`;
 *   - interpretar retorno JSONB;
 *   - produzir logs sanitizados (sem PII).
 *
 * A RPC subjacente garante:
 *   - lock advisory por user_id (concorrência serializada);
 *   - idempotência L1 (unique index em payment_events);
 *   - proteção contra out-of-order via provider_updated_at + desempate por
 *     external_payment_id;
 *   - upsert transacional em user_plans conforme política de cancelamento
 *     imediato vs agendado, refund, chargeback, expiração;
 *   - invalidação atômica de whatsapp_notifications pending/sem-claim/
 *     sem-attempt quando entitlement de WhatsApp transiciona true→false;
 *   - canary v1 preservada naturalmente.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

type PlanTier = Database["public"]["Enums"]["plan_tier"];

export type CanonicalBillingStatus =
  | "approved"
  | "cancelled_immediate"
  | "cancelled_scheduled"
  | "refunded"
  | "chargeback"
  | "expired"
  | "pending"
  | "rejected"
  | "unknown";

export type BillingApplyOutcome =
  | "event_applied"
  | "duplicate_event"
  | "stale_event_skipped"
  | "event_noop"
  | "unknown_status"
  | "mapping_missing"
  | "user_not_found"
  | "rpc_error"
  | "invalid_input";

export interface AuthoritativeMpPayment {
  id: number | string;
  status: string | null | undefined;
  status_detail?: string | null;
  date_last_updated?: string | null;
  date_approved?: string | null;
  date_created?: string | null;
  transaction_amount?: number | null;
  currency_id?: string | null;
  external_reference?: string | null;
  metadata?: {
    user_id?: string;
    plano?: string;
    periodicidade?: string;
    months?: number | string;
  } | null;
}

export interface ApplyBillingInput {
  payment: AuthoritativeMpPayment;
  userId: string;
  plano: PlanTier | null;
  periodicidade: string | null;
  months: number;
  eventType: string;
  /** Hint semântico do webhook: cancelamento explícito imediato vs. agendado. */
  cancellationKind?: "immediate" | "scheduled" | null;
  /** Se o webhook já sabe que é refund/chargeback (via topic) mesmo com status "approved". */
  overrideCanonical?: CanonicalBillingStatus | null;
  environment?: "production" | "sandbox";
}

export interface ApplyBillingResult {
  ok: boolean;
  outcome: BillingApplyOutcome;
  eventId?: string | null;
  canonicalStatus: CanonicalBillingStatus;
  providerUpdatedAt: string | null;
  planApplied?: PlanTier | null;
  statusApplied?: string | null;
  hadWhatsAppBefore?: boolean;
  hasWhatsAppAfter?: boolean;
  notificationsInvalidated?: number;
  reason?: string;
}

const APPROVED_RAW = new Set(["approved", "authorized", "paid"]);

/**
 * Normaliza `raw_status` do MP para o canônico interno do billing.
 * Note: cancellationKind decide entre `cancelled_immediate` e `cancelled_scheduled`.
 */
export function normalizeCanonicalStatus(
  rawStatus: string | null | undefined,
  cancellationKind?: "immediate" | "scheduled" | null,
  override?: CanonicalBillingStatus | null,
): CanonicalBillingStatus {
  if (override) return override;
  const s = (rawStatus ?? "").toLowerCase().trim();
  if (APPROVED_RAW.has(s)) return "approved";
  if (s === "pending" || s === "in_process" || s === "in_mediation") return "pending";
  if (s === "rejected") return "rejected";
  if (s === "refunded") return "refunded";
  if (s === "charged_back") return "chargeback";
  if (s === "expired") return "expired";
  if (s === "cancelled" || s === "canceled") {
    return cancellationKind === "scheduled" ? "cancelled_scheduled" : "cancelled_immediate";
  }
  return "unknown";
}

/**
 * Extrai o timestamp autoritativo do provider. Prioridade:
 *   1. date_last_updated (campo oficial do MP para "última alteração no recurso");
 *   2. date_approved (para approved);
 *   3. date_created (fallback conservador).
 * Retorna ISO string ou null (a RPC lida com null aceitando ordem por external_payment_id).
 */
export function extractProviderUpdatedAt(payment: AuthoritativeMpPayment): string | null {
  const raw = payment.date_last_updated ?? payment.date_approved ?? payment.date_created ?? null;
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Log sanitizado — nunca inclui token MP, payload completo, email do payer,
 * external_reference bruto ou detalhes de PII.
 */
function logSanitized(
  level: "info" | "warn" | "error",
  msg: string,
  ctx: Record<string, unknown>,
): void {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (
      k === "token" ||
      k === "payload" ||
      k === "email" ||
      k === "external_reference" ||
      k === "raw_body"
    )
      continue;
    safe[k] = v;
  }
  const line = `[billing-apply] ${msg} ${JSON.stringify(safe)}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Aplica atomicamente um evento de billing.
 *
 * Precondição: caller já executou:
 *   1. validação de assinatura HMAC (para webhook) ou autorização admin (reconciler);
 *   2. consulta autoritativa em `https://api.mercadopago.com/v1/payments/{id}`;
 *   3. validação de user_id (server-side, não confia no client);
 *   4. mapeamento server-side de plano.
 *
 * Fail-closed: qualquer erro estruturado retorna `ok:false` sem alterar plano.
 */
export async function applyMercadoPagoBillingEvent(
  input: ApplyBillingInput,
): Promise<ApplyBillingResult> {
  const canonical = normalizeCanonicalStatus(
    input.payment.status,
    input.cancellationKind ?? null,
    input.overrideCanonical ?? null,
  );
  const providerUpdatedAt = extractProviderUpdatedAt(input.payment);

  if (!input.userId || !input.payment.id) {
    logSanitized("warn", "invalid_input", { hasUser: !!input.userId, hasId: !!input.payment.id });
    return {
      ok: false,
      outcome: "invalid_input",
      canonicalStatus: canonical,
      providerUpdatedAt,
      reason: "missing_user_or_payment_id",
    };
  }

  const externalPaymentId = String(input.payment.id);
  const metadata: Record<string, unknown> = {
    source: input.eventType,
    environment: input.environment ?? "production",
    status_detail: input.payment.status_detail ?? null,
    amount:
      typeof input.payment.transaction_amount === "number"
        ? input.payment.transaction_amount
        : null,
    currency: input.payment.currency_id ?? null,
  };

  try {
    const { data, error } = await supabaseAdmin.rpc(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "billing_apply_mercadopago_event_atomic" as any,

      {
        p_user_id: input.userId,
        p_provider: "mercado_pago",
        p_external_payment_id: externalPaymentId,
        p_event_type: input.eventType,
        p_provider_updated_at: providerUpdatedAt,
        p_canonical_status: canonical,
        p_plano: input.plano,
        p_periodicidade: input.periodicidade,
        p_months: input.months || 1,
        p_period_start: null,
        p_period_end: null,
        p_raw_status: input.payment.status ?? null,
        p_metadata: metadata,
      } as any,
    );

    if (error) {
      logSanitized("error", "rpc_error", {
        code: error.code,
        message: error.message,
        userId: input.userId,
        externalPaymentId,
      });
      return {
        ok: false,
        outcome: "rpc_error",
        canonicalStatus: canonical,
        providerUpdatedAt,
        reason: error.code ?? "rpc_error",
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (data ?? {}) as any;
    const outcome = (r.outcome ?? "rpc_error") as BillingApplyOutcome;

    logSanitized("info", "applied", {
      outcome,
      canonical,
      userId: input.userId,
      externalPaymentId,
      invalidated: r.notifications_invalidated ?? 0,
      planApplied: r.plano_after ?? null,
      statusApplied: r.status_after ?? null,
    });

    return {
      ok: true,
      outcome,
      eventId: r.event_id ?? null,
      canonicalStatus: canonical,
      providerUpdatedAt,
      planApplied: (r.plano_after as PlanTier | null) ?? null,
      statusApplied: (r.status_after as string | null) ?? null,
      hadWhatsAppBefore: r.had_whatsapp_before ?? false,
      hasWhatsAppAfter: r.has_whatsapp_after ?? false,
      notificationsInvalidated: Number(r.notifications_invalidated ?? 0),
      reason: r.reason ?? undefined,
    };
  } catch (err) {
    logSanitized("error", "rpc_threw", {
      message: err instanceof Error ? err.message : "unknown",
      userId: input.userId,
      externalPaymentId,
    });
    return {
      ok: false,
      outcome: "rpc_error",
      canonicalStatus: canonical,
      providerUpdatedAt,
      reason: "exception",
    };
  }
}
