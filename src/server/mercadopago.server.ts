import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logAuditEvent } from "./logs.server";
import { recordPaymentEventIdempotent } from "./mercadopago-diagnostics.server";

/**
 * Reconciliação de pagamentos por cartão pendentes.
 *
 * Para cada subscription_payment com method='card' e status='pending',
 * consulta o Mercado Pago (preference -> merchant_orders -> payments) e,
 * se encontrar um pagamento aprovado, marca como 'approved' com paid_at.
 * O trigger sync_user_plan_from_payment cuida de ativar user_plans.
 *
 * Retorna a quantidade de pagamentos efetivamente atualizados.
 */
export async function reconcilePendingCardPaymentsForUser(userId: string): Promise<number> {
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!accessToken) return 0;

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data: pending } = await supabaseAdmin
    .from("subscription_payments")
    .select("id, user_id, method, status, provider_payment_id, created_at")
    .eq("user_id", userId)
    .eq("provider", "mercadopago")
    .eq("method", "card")
    .eq("status", "pending")
    .gte("created_at", threeDaysAgo)
    .order("created_at", { ascending: false })
    .limit(5);

  if (!pending?.length) return 0;
  let updated = 0;

  for (const row of pending) {
    const preferenceId = (row as { provider_payment_id?: string | null }).provider_payment_id;
    if (!preferenceId) continue;
    try {
      const moRes = await fetch(
        `https://api.mercadopago.com/merchant_orders/search?preference_id=${encodeURIComponent(preferenceId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!moRes.ok) continue;
      const moData = (await moRes.json()) as {
        elements?: Array<{ payments?: Array<{ id?: number | string; status?: string }> }>;
      };
      const payments = moData.elements?.[0]?.payments ?? [];
      const approved = payments.find((p) => (p.status ?? "").toLowerCase() === "approved");
      if (!approved?.id) continue;

      const pRes = await fetch(`https://api.mercadopago.com/v1/payments/${approved.id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!pRes.ok) continue;
      const payment = (await pRes.json()) as { id?: number | string; status?: string };
      const status = (payment.status ?? "").toLowerCase();
      if (status !== "approved" && status !== "authorized" && status !== "paid") continue;

      await supabaseAdmin
        .from("subscription_payments")
        .update({
          status: "approved",
          paid_at: new Date().toISOString(),
          provider_payment_id: String(payment.id ?? approved.id),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          payload: payment as any,
        })
        .eq("id", row.id);
      updated += 1;
      await logAuditEvent({
        actor_user_id: null,
        action: "payment_marked_paid",
        target_user_id: userId,
        entity_type: "payment",
        entity_id: row.id,
        new_data: { status: "approved", provider_payment_id: String(payment.id ?? approved.id) },
        metadata: { source: "reconcile_pending_card_payments" },
      });
    } catch (err) {
      console.warn("[reconcilePendingCardPaymentsForUser] erro", err);
    }
  }
  return updated;
}
