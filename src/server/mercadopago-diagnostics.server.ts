/**
 * Diagnóstico e reconciliação manual de pagamentos do Mercado Pago.
 *
 * Server-only — NUNCA importe em código client.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logAuditEvent } from "./logs.server";

/**
 * Mapeamento canônico de status do Mercado Pago.
 *  approved/authorized/paid → "approved"
 *  pending                  → "pending"
 *  in_process / in_mediation → "in_process"
 *  rejected                 → "rejected"
 *  cancelled                → "cancelled"
 *  refunded                 → "refunded"
 *  charged_back             → "charged_back"
 */
export const APPROVED_STATUSES = new Set(["approved", "authorized", "paid"]);
export const FAILED_STATUSES = new Set([
  "rejected",
  "cancelled",
  "canceled",
  "refunded",
  "charged_back",
]);

export type MercadoPagoCanonicalStatus =
  | "approved"
  | "pending"
  | "in_process"
  | "rejected"
  | "cancelled"
  | "refunded"
  | "charged_back"
  | "unknown";

export function canonicalMpStatus(raw: string | null | undefined): MercadoPagoCanonicalStatus {
  const s = (raw ?? "").toLowerCase().trim();
  if (APPROVED_STATUSES.has(s)) return "approved";
  if (s === "pending") return "pending";
  if (s === "in_process" || s === "in_mediation") return "in_process";
  if (s === "rejected") return "rejected";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  if (s === "refunded") return "refunded";
  if (s === "charged_back") return "charged_back";
  return "unknown";
}

type MpPayment = {
  id?: number | string;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  external_reference?: string | null;
  payer?: { email?: string };
  metadata?: {
    user_id?: string;
    plano?: string;
    periodicidade?: string;
    months?: number | string;
  };
};

async function fetchPayment(paymentId: string): Promise<MpPayment | null> {
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!token) return null;
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as MpPayment;
}

export interface DiagnosisResult {
  mercado_pago_status: MercadoPagoCanonicalStatus;
  mp_raw_status: string | null;
  local_payment_status: string | null;
  local_subscription_status: string | null;
  user_id: string | null;
  user_email: string | null;
  plan: string | null;
  amount: number | null;
  external_payment_id: string;
  inconsistencies: string[];
  recommended_action:
    | "none"
    | "activate_subscription"
    | "mark_payment_paid"
    | "investigate"
    | "payment_not_found";
}

/**
 * Diagnostica um pagamento do Mercado Pago. NUNCA modifica o estado local.
 * Compara dados remotos com locais e detecta inconsistências.
 */
export async function diagnoseMercadoPagoPayment(
  paymentId: string,
): Promise<DiagnosisResult> {
  const inconsistencies: string[] = [];
  const payment = await fetchPayment(paymentId);

  if (!payment) {
    return {
      mercado_pago_status: "unknown",
      mp_raw_status: null,
      local_payment_status: null,
      local_subscription_status: null,
      user_id: null,
      user_email: null,
      plan: null,
      amount: null,
      external_payment_id: paymentId,
      inconsistencies: ["payment_not_found_in_mercado_pago"],
      recommended_action: "payment_not_found",
    };
  }

  const mpCanonical = canonicalMpStatus(payment.status);
  const refUser = payment.metadata?.user_id ?? null;
  const refPlano = payment.metadata?.plano ?? null;
  const extRef = payment.external_reference?.split(":") ?? [];
  const userId = refUser ?? extRef[0] ?? null;
  const plano = refPlano ?? extRef[1] ?? null;
  const userEmail = payment.payer?.email ?? null;

  // Local payment row
  const { data: localPayment } = await supabaseAdmin
    .from("subscription_payments")
    .select("id, user_id, plano, status, paid_at, amount_cents")
    .eq("provider", "mercadopago")
    .eq("provider_payment_id", String(payment.id ?? paymentId))
    .maybeSingle();

  // Local subscription
  const { data: localPlan } = userId
    ? await supabaseAdmin
        .from("user_plans")
        .select("plano, status, current_period_end")
        .eq("user_id", userId)
        .maybeSingle()
    : { data: null as null | { plano: string; status: string; current_period_end: string | null } };

  let recommended: DiagnosisResult["recommended_action"] = "none";

  if (mpCanonical === "approved") {
    if (!localPayment) {
      inconsistencies.push("approved_in_mp_but_no_local_payment");
      recommended = "investigate";
    } else if (localPayment.status !== "approved") {
      inconsistencies.push("approved_in_mp_but_local_status_" + localPayment.status);
      recommended = "mark_payment_paid";
    }
    if (
      userId &&
      (!localPlan || localPlan.status !== "ativo" || localPlan.plano !== plano)
    ) {
      inconsistencies.push("approved_in_mp_but_subscription_not_active");
      recommended = "activate_subscription";
    }
  } else if (mpCanonical === "pending" || mpCanonical === "in_process") {
    if (localPayment?.status === "approved") {
      inconsistencies.push("local_marked_approved_but_mp_is_" + mpCanonical);
      recommended = "investigate";
    }
  } else if (FAILED_STATUSES.has(payment.status ?? "")) {
    if (localPlan?.status === "ativo" && (localPayment?.id ?? null)) {
      // Não rebaixar automaticamente — apenas sinalizar.
      inconsistencies.push("mp_failed_but_local_subscription_active");
    }
  }

  return {
    mercado_pago_status: mpCanonical,
    mp_raw_status: payment.status ?? null,
    local_payment_status: localPayment?.status ?? null,
    local_subscription_status: localPlan?.status ?? null,
    user_id: userId,
    user_email: userEmail,
    plan: plano,
    amount: typeof payment.transaction_amount === "number" ? payment.transaction_amount : null,
    external_payment_id: String(payment.id ?? paymentId),
    inconsistencies,
    recommended_action: recommended,
  };
}

/**
 * Idempotência: tenta registrar um evento processado.
 * Retorna `true` se foi a primeira vez (continue processando); `false` se já existia.
 */
export async function recordPaymentEventIdempotent(input: {
  provider?: string;
  external_payment_id: string;
  event_type?: string | null;
  status: string;
  raw_status?: string | null;
  user_id?: string | null;
  payment_id?: string | null;
  metadata?: unknown;
}): Promise<{ firstTime: boolean }> {
  try {
    const { error } = await supabaseAdmin.from("payment_events").insert({
      provider: input.provider ?? "mercado_pago",
      external_payment_id: input.external_payment_id,
      event_type: input.event_type ?? null,
      status: input.status,
      raw_status: input.raw_status ?? null,
      user_id: input.user_id ?? null,
      payment_id: input.payment_id ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: (input.metadata ?? null) as any,
    });
    if (error) {
      // unique violation → já processado
      if (error.code === "23505") return { firstTime: false };
      console.error("[recordPaymentEventIdempotent] insert failed", error.message);
      return { firstTime: true }; // não bloqueia o fluxo em erro genérico
    }
    return { firstTime: true };
  } catch (err) {
    console.error("[recordPaymentEventIdempotent] threw", err);
    return { firstTime: true };
  }
}

/**
 * Verifica se já existe evento processado para a chave idempotente.
 */
export async function paymentEventAlreadyProcessed(
  externalPaymentId: string,
  eventType: string | null,
): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from("payment_events")
      .select("id")
      .eq("provider", "mercado_pago")
      .eq("external_payment_id", externalPaymentId)
      .eq("event_type", eventType ?? "")
      .maybeSingle();
    return !!data;
  } catch (err) {
    console.error("[paymentEventAlreadyProcessed] threw", err);
    return false;
  }
}

/**
 * Reconcilia um pagamento por ID. Usa o diagnóstico e, se MP estiver approved,
 * marca o pagamento local como aprovado e ativa/renova a assinatura.
 * Idempotente: nunca duplica ativação.
 *
 * Quem chama é responsável por garantir que o caller é admin.
 */
export async function reconcileMercadoPagoPaymentById(
  paymentId: string,
  actor: { user_id?: string | null; email?: string | null },
): Promise<{
  ok: boolean;
  applied: boolean;
  diagnosis: DiagnosisResult;
  message: string;
}> {
  const diagnosis = await diagnoseMercadoPagoPayment(paymentId);

  if (diagnosis.recommended_action === "payment_not_found") {
    return { ok: false, applied: false, diagnosis, message: "payment_not_found" };
  }

  if (diagnosis.mercado_pago_status !== "approved") {
    return {
      ok: true,
      applied: false,
      diagnosis,
      message: `mp_status_is_${diagnosis.mercado_pago_status}`,
    };
  }

  // approved
  const { user_id: userId, plan } = diagnosis;
  let applied = false;

  // 1) marcar pagamento local como aprovado se ainda não estiver
  if (diagnosis.local_payment_status && diagnosis.local_payment_status !== "approved") {
    await supabaseAdmin
      .from("subscription_payments")
      .update({ status: "approved", paid_at: new Date().toISOString() })
      .eq("provider", "mercadopago")
      .eq("provider_payment_id", diagnosis.external_payment_id);
    applied = true;
  }

  // 2) ativar assinatura se inativa / divergente
  if (userId && plan && diagnosis.local_subscription_status !== "ativo") {
    const startISO = new Date().toISOString();
    const end = new Date();
    end.setMonth(end.getMonth() + 1); // padrão mensal; ciclo correto vem do trigger
    const { data: existing } = await supabaseAdmin
      .from("user_plans")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    const update = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      plano: plan as any,
      status: "ativo",
      cancelled_at: null,
      access_until: null,
      current_period_start: startISO,
      current_period_end: end.toISOString(),
      last_payment_id: diagnosis.external_payment_id,
    };
    if (existing) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabaseAdmin.from("user_plans").update(update as any).eq("user_id", userId);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabaseAdmin.from("user_plans").insert({ user_id: userId, ...update } as any);
    }
    applied = true;
  }

  // Registra idempotência + audit log
  await recordPaymentEventIdempotent({
    external_payment_id: diagnosis.external_payment_id,
    event_type: "manual_reconcile",
    status: "approved",
    raw_status: diagnosis.mp_raw_status,
    user_id: userId,
    metadata: { source: "manual_reconcile", actor_email: actor.email ?? null },
  });

  await logAuditEvent({
    actor_user_id: actor.user_id ?? null,
    actor_email: actor.email ?? null,
    action: applied ? "payment_reconciled_approved" : "payment_reconciled_noop",
    target_user_id: userId,
    entity_type: "payment",
    entity_id: diagnosis.external_payment_id,
    new_data: {
      mp_status: diagnosis.mercado_pago_status,
      plan,
      applied,
    },
    metadata: {
      source: "manual_reconcile",
      inconsistencies: diagnosis.inconsistencies,
    },
  });

  return {
    ok: true,
    applied,
    diagnosis,
    message: applied ? "reconciled" : "already_consistent",
  };
}
