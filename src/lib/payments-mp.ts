import { supabase } from "@/integrations/supabase/client";
import type { PlanTier } from "@/lib/plans";

/**
 * Cria uma cobrança Pix no Mercado Pago para o plano informado, chamando a
 * rota interna /api/checkout/create. A liberação efetiva do plano acontece
 * apenas via webhook (/api/public/webhooks/mercadopago) — nunca com base no
 * retorno deste fetch.
 */
export type CheckoutResult =
  | {
      ok: true;
      pendingIntegration: false;
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
      pendingIntegration: true;
      message: string;
    }
  | {
      ok: false;
      reason: string;
    };

export async function criarCheckoutPix(plano: PlanTier): Promise<CheckoutResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, reason: "Faça login novamente para continuar." };

  try {
    const res = await fetch("/api/checkout/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ plano, method: "pix" }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, reason: (json.detail as string) ?? (json.error as string) ?? "Falha ao gerar cobrança." };
    }
    if (json.pendingIntegration) {
      return {
        ok: true,
        pendingIntegration: true,
        message: (json.message as string) ?? "Integração de pagamento pendente.",
      };
    }
    return {
      ok: true,
      pendingIntegration: false,
      payment: json.payment as CheckoutResult extends { payment: infer P } ? P : never,
    };
  } catch {
    return { ok: false, reason: "Erro de conexão ao iniciar pagamento." };
  }
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

export async function cancelarAssinatura(userId: string): Promise<
  { ok: true; accessUntil: string } | { ok: false; reason: string }
> {
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
    (trialEnd && new Date(trialEnd).getTime() > Date.now()
      ? trialEnd
      : endOfCurrentMonthISO());

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
};

export async function listarPagamentos(userId: string): Promise<PaymentHistoryRow[]> {
  const { data, error } = await supabase
    .from("subscription_payments")
    .select("id, plano, amount_cents, method, status, paid_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return [];
  return (data ?? []) as PaymentHistoryRow[];
}

export function statusLabelMP(status: string): { label: string; tone: "ok" | "warn" | "danger" | "muted" } {
  const s = status.toLowerCase();
  if (["approved", "authorized", "paid", "ativo"].includes(s))
    return { label: "Aprovado", tone: "ok" };
  if (["pending", "in_process", "in_mediation", "aguardando_pagamento"].includes(s))
    return { label: "Pendente", tone: "warn" };
  if (["rejected", "cancelled", "refunded", "charged_back", "expired"].includes(s))
    return { label: status === "rejected" ? "Recusado" : status === "expired" ? "Vencido" : "Cancelado", tone: "danger" };
  return { label: status, tone: "muted" };
}
