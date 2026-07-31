import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveMercadoPagoConfig } from "@/server/mercadopago-config.server";

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
          .select(
            "id, user_id, plano, amount_cents, provider, provider_payment_id, status, method, periodicidade, months",
          )
          .eq("id", paymentRowId)
          .eq("user_id", user.id)
          .maybeSingle();
        if (readErr || !row) return json({ error: "not_found" }, 404);

        // Prompt 4A: token e ambiente vêm do módulo central fail-closed.
        // Verificação de pagamentos históricos é permitida mesmo quando novos
        // checkouts estão bloqueados.
        const cfg = resolveMercadoPagoConfig();
        const accessToken = cfg.allowHistoricalVerification ? cfg.accessToken : null;
        if (!accessToken) {
          return json({ status: row.status ?? "pending", note: "no_token" });
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = row as any;
        const months = Number(r.months ?? 1) || 1;
        const periodicidade = String(r.periodicidade ?? "mensal");

        let providerPaymentId: string | null = r.provider_payment_id ?? null;
        let status: string = (r.status ?? "pending").toLowerCase();
        let payment: { id?: number | string; status?: string } = {};

        if (r.method === "card") {
          // Para cartão (Checkout Pro) o provider_payment_id armazenado é a
          // preference_id. Precisamos consultar merchant_orders para descobrir
          // o paymentId real e seu status.
          const moRes = await fetch(
            `https://api.mercadopago.com/merchant_orders/search?preference_id=${encodeURIComponent(
              providerPaymentId ?? "",
            )}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          if (moRes.ok) {
            const moData = (await moRes.json()) as {
              elements?: Array<{
                payments?: Array<{ id?: number | string; status?: string }>;
              }>;
            };
            const payments = moData.elements?.[0]?.payments ?? [];
            const approved = payments.find((p) => (p.status ?? "").toLowerCase() === "approved");
            const target = approved ?? payments[payments.length - 1];
            if (target?.id) {
              const pRes = await fetch(
                `https://api.mercadopago.com/v1/payments/${target.id}`,
                { headers: { Authorization: `Bearer ${accessToken}` } },
              );
              if (pRes.ok) {
                payment = (await pRes.json()) as typeof payment;
                status = (payment.status ?? status).toLowerCase();
                providerPaymentId = String(payment.id ?? target.id);
              }
            }
          }
        } else {
          // Pix — provider_payment_id é o paymentId direto.
          const res = await fetch(
            `https://api.mercadopago.com/v1/payments/${providerPaymentId}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          if (!res.ok) return json({ error: "mp_fetch_failed" }, 502);
          payment = (await res.json()) as typeof payment;
          status = (payment.status ?? "pending").toLowerCase();
        }

        // Atualiza pagamento local
        await supabaseAdmin
          .from("subscription_payments")
          .update({
            status,
            payload: payment,
            provider_payment_id: providerPaymentId,
            paid_at: APPROVED.has(status) ? new Date().toISOString() : null,
          })
          .eq("id", row.id);

        if (APPROVED.has(status)) {
          const startISO = new Date().toISOString();
          const end = new Date();
          end.setMonth(end.getMonth() + months);
          const endISO = end.toISOString();
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
            periodicidade,
            months,
            current_period_start: startISO,
            current_period_end: endISO,
            last_payment_id: String(payment.id ?? providerPaymentId ?? ""),
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
