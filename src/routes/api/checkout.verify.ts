import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * POST /api/checkout/verify
 *
 * Botão "Já paguei, verificar pagamento". Recebe { paymentId } e:
 * 1) busca o registro em subscription_payments (garantindo que pertence
 *    ao usuário autenticado) para descobrir provider_payment_id;
 * 2) consulta o status real direto na API do Mercado Pago;
 * 3) se aprovado, ativa o plano (mesma lógica do webhook): grava
 *    user_plans.status='ativo', plano, current_period_start/end (30 dias),
 *    last_payment_id, e marca subscription_payments como aprovado.
 * 4) Se rejected/cancelled/expired, marca pagamento e mantém plano atual.
 * 5) Se pending, devolve "pending" para a UI.
 *
 * Retorna sempre { status, plano? } para a UI atualizar a tela.
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const APPROVED = new Set(["approved", "authorized"]);
const FAILED = new Set(["rejected", "cancelled", "refunded", "charged_back", "expired"]);
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function getUserFromRequest(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anon =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    "";
  if (!url) return null;
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await sb.auth.getUser(token);
  return data.user ?? null;
}

export const Route = createFileRoute("/api/checkout/verify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getUserFromRequest(request);
        if (!user) return json({ error: "unauthorized" }, 401);

        let body: { paymentId?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "invalid_body" }, 400);
        }
        const paymentRowId = body.paymentId;
        if (!paymentRowId) return json({ error: "missing_payment_id" }, 400);

        // Busca registro local (escopado ao usuário)
        const { data: row, error: readErr } = await supabaseAdmin
          .from("subscription_payments")
          .select("id, user_id, plano, amount_cents, provider, provider_payment_id, status")
          .eq("id", paymentRowId)
          .eq("user_id", user.id)
          .maybeSingle();
        if (readErr || !row) return json({ error: "not_found" }, 404);
        if (!row.provider_payment_id) {
          return json({ status: row.status ?? "pending" });
        }

        const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
        if (!accessToken) {
          return json({ status: row.status ?? "pending", note: "no_token" });
        }

        // Consulta o pagamento na API do Mercado Pago
        const res = await fetch(
          `https://api.mercadopago.com/v1/payments/${row.provider_payment_id}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!res.ok) return json({ error: "mp_fetch_failed" }, 502);
        const payment = (await res.json()) as {
          id?: number | string;
          status?: string;
          metadata?: { user_id?: string; plano?: string };
        };
        const status = (payment.status ?? "pending").toLowerCase();

        // Atualiza pagamento local
        await supabaseAdmin
          .from("subscription_payments")
          .update({
            status,
            payload: payment,
            paid_at: APPROVED.has(status) ? new Date().toISOString() : null,
          })
          .eq("id", row.id);

        if (APPROVED.has(status)) {
          const startISO = new Date().toISOString();
          const endISO = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();
          const { data: existing } = await supabaseAdmin
            .from("user_plans")
            .select("user_id")
            .eq("user_id", user.id)
            .maybeSingle();
          const update = {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            plano: row.plano as any,
            status: "ativo",
            cancelled_at: null,
            access_until: null,
            current_period_start: startISO,
            current_period_end: endISO,
            last_payment_id: String(payment.id ?? row.provider_payment_id),
          };
          if (existing) {
            await supabaseAdmin
              .from("user_plans")
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .update(update as any)
              .eq("user_id", user.id);
          } else {
            await supabaseAdmin
              .from("user_plans")
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .insert({ user_id: user.id, ...update } as any);
          }
          return json({ status: "approved", plano: row.plano });
        }

        if (FAILED.has(status)) {
          return json({ status });
        }
        return json({ status: "pending" });
      },
    },
  },
});
