import { supabase } from "@/integrations/supabase/client";
import { isPlanAvailableForNewSubscriptions, type PlanTier, type Periodicidade } from "@/lib/plans";

/**
 * Cria uma cobrança no Mercado Pago para o plano + periodicidade escolhidos.
 * - method "pix": devolve QR Code para pagar dentro do app.
 * - method "card": devolve `init_point` para redirecionar ao Checkout Pro
 *   seguro do Mercado Pago (o app não armazena dados do cartão).
 *
 * A liberação efetiva acontece via webhook
 * (/api/public/webhooks/mercadopago) — nunca pelo retorno deste fetch.
 */
export type CheckoutResult =
  | {
      ok: true;
      pendingIntegration: false;
      method: "pix";
      payment: {
        id: string;
        qr_code: string | null;
        qr_code_base64: string | null;
        ticket_url: string | null;
        status: string;
      };
    }
  | {
      ok: true;
      pendingIntegration: false;
      method: "card";
      payment: {
        id: string;
        status: string;
        init_point: string;
        ticket_url: string | null;
      };
    }
  | { ok: true; pendingIntegration: true; message: string }
  | { ok: false; reason: string };

export async function criarCheckout(
  plano: PlanTier,
  opts: { periodicidade: Periodicidade; method: "pix" | "card" },
): Promise<CheckoutResult> {
  if (!isPlanAvailableForNewSubscriptions(plano)) {
    return { ok: false, reason: "Este plano não está mais disponível para novas assinaturas." };
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, reason: "Faça login novamente para continuar." };

  try {
    const res = await fetch("/api/checkout/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plano, method: opts.method, periodicidade: opts.periodicidade }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        reason: (json.detail as string) ?? (json.error as string) ?? "Falha ao gerar cobrança.",
      };
    }
    if (json.pendingIntegration) {
      return {
        ok: true,
        pendingIntegration: true,
        message: (json.message as string) ?? "Integração de pagamento pendente.",
      };
    }
    const method = (json.method as "pix" | "card") ?? opts.method;
    return {
      ok: true,
      pendingIntegration: false,
      method,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payment: json.payment as any,
    };
  } catch {
    return { ok: false, reason: "Erro de conexão ao iniciar pagamento." };
  }
}

/** @deprecated — usar `criarCheckout`. Mantido para compatibilidade. */
export async function criarCheckoutPix(plano: PlanTier): Promise<CheckoutResult> {
  return criarCheckout(plano, { periodicidade: "mensal", method: "pix" });
}

/* ===========================================================
 * Cancelamento (sem chamar API de subscription do MP)
 * - Marca user_plans com cancelled_at e access_until.
 * - Mantém o acesso até o fim do período pago (trial_ends_at quando
 *   for trial; fim do mês corrente caso contrário).
 * =========================================================== */

function endOfCurrentMonthISO(): string {
  const now = new Date();
  // Último dia do mês atual às 23:59:59 local — usamos UTC para storage.
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return end.toISOString();
}

export async function cancelarAssinatura(
  userId: string,
): Promise<{ ok: true; accessUntil: string } | { ok: false; reason: string }> {
  // Lê estado atual
  const { data: row, error: readErr } = await supabase
    .from("user_plans")
    .select("trial_ends_at, paid_at:created_at, access_until")
    .eq("user_id", userId)
    .maybeSingle();
  if (readErr) return { ok: false, reason: readErr.message };

  // Mantém o access_until existente se já houver, senão calcula.
  const trialEnd = (row as { trial_ends_at?: string | null } | null)?.trial_ends_at ?? null;
  const existing = (row as { access_until?: string | null } | null)?.access_until ?? null;

  const accessUntil =
    existing ??
    (trialEnd && new Date(trialEnd).getTime() > Date.now() ? trialEnd : endOfCurrentMonthISO());

  const { error } = await supabase
    .from("user_plans")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ cancelled_at: new Date().toISOString(), access_until: accessUntil } as any)
    .eq("user_id", userId);
  if (error) return { ok: false, reason: error.message };
  return { ok: true, accessUntil };
}

/* ===========================================================
 * Histórico de pagamentos
 * =========================================================== */

export type PaymentHistoryRow = {
  id: string;
  plano: string;
  amount_cents: number;
  method: string;
  status: string;
  paid_at: string | null;
  created_at: string;
  periodicidade?: string | null;
  months?: number | null;
  discount_percent?: number | null;
};

export async function listarPagamentos(userId: string): Promise<PaymentHistoryRow[]> {
  const { data, error } = await supabase
    .from("subscription_payments")
    .select(
      "id, plano, amount_cents, method, status, paid_at, created_at, periodicidade, months, discount_percent",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return [];
  return (data ?? []) as PaymentHistoryRow[];
}

export function statusLabelMP(status: string): {
  label: string;
  tone: "ok" | "warn" | "danger" | "muted";
} {
  const s = status.toLowerCase();
  if (["approved", "authorized", "paid", "ativo"].includes(s))
    return { label: "Aprovado", tone: "ok" };
  if (["pending", "in_process", "in_mediation", "aguardando_pagamento"].includes(s))
    return { label: "Pendente", tone: "warn" };
  if (["rejected", "cancelled", "refunded", "charged_back", "expired"].includes(s))
    return {
      label: status === "rejected" ? "Recusado" : status === "expired" ? "Vencido" : "Cancelado",
      tone: "danger",
    };
  return { label: status, tone: "muted" };
}

/* ===========================================================
 * Verificar pagamento manualmente (botão "Já paguei")
 * =========================================================== */
export type VerifyResult =
  | { ok: true; status: "approved"; plano: string }
  | { ok: true; status: "pending" | "rejected" | "cancelled" | "expired" | string }
  | { ok: false; reason: string };

export async function verificarPagamento(paymentId: string): Promise<VerifyResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, reason: "Faça login novamente." };
  try {
    const res = await fetch("/api/checkout/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ paymentId }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, reason: (json.error as string) ?? "Falha ao verificar." };
    const status = String(json.status ?? "pending");
    if (status === "approved") {
      return { ok: true, status: "approved", plano: String(json.plano ?? "") };
    }
    return { ok: true, status };
  } catch {
    return { ok: false, reason: "Erro de conexão." };
  }
}
