import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * POST /api/checkout/create
 *
 * Cria uma cobrança Pix no Mercado Pago para o plano escolhido e
 * registra a tentativa em `subscription_payments` (status 'pending').
 *
 * Também marca `user_plans.status = 'aguardando_pagamento'` e
 * `user_plans.plano = <plano escolhido>`.
 *
 * Se `MERCADO_PAGO_ACCESS_TOKEN` ainda não estiver configurado, devolve
 * `{ pendingIntegration: true }` — a UI mostra "Integração de pagamento
 * pendente" sem quebrar o app.
 *
 * Body: { plano: string, method?: 'pix' | 'card' }
 */

type Plano =
  | "pessoal_manual"
  | "pessoal_premium"
  | "mei_essencial"
  | "mei_inteligente"
  | "empresa";

const PLAN_PRICES: Record<Plano, { cents: number; name: string }> = {
  pessoal_manual: { cents: 2500, name: "Pessoa Física Manual" },
  pessoal_premium: { cents: 5000, name: "Pessoa Física Premium" },
  mei_essencial: { cents: 3990, name: "MEI Essencial" },
  mei_inteligente: { cents: 7000, name: "MEI Inteligente" },
  empresa: { cents: 15000, name: "Empresa" },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

export const Route = createFileRoute("/api/checkout/create")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getUserFromRequest(request);
        if (!user) return json({ error: "unauthorized" }, 401);

        let body: { plano?: string; method?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "invalid_body" }, 400);
        }
        const plano = body.plano as Plano | undefined;
        const method = (body.method as "pix" | "card") ?? "pix";
        if (!plano || !(plano in PLAN_PRICES)) {
          return json({ error: "invalid_plan" }, 400);
        }
        const info = PLAN_PRICES[plano];

        // Atualiza/insere o registro de plano do usuário como aguardando_pagamento
        await supabaseAdmin
          .from("user_plans")
          .upsert(
            {
              user_id: user.id,
              plano,
              status: "aguardando_pagamento",
            },
            { onConflict: "user_id" },
          );

        const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
        if (!accessToken) {
          // Estrutura pronta — falta a chave do gateway.
          const { data: row } = await supabaseAdmin
            .from("subscription_payments")
            .insert({
              user_id: user.id,
              plano,
              amount_cents: info.cents,
              method,
              provider: "mercadopago",
              status: "pending",
              payload: { note: "missing_access_token" },
            })
            .select("id")
            .single();
          return json({
            pendingIntegration: true,
            paymentId: row?.id ?? null,
            message:
              "Integração de pagamento pendente. Configure o gateway para finalizar a cobrança.",
          });
        }

        // Cria pagamento Pix no Mercado Pago
        const idempotencyKey = `${user.id}-${plano}-${Date.now()}`;
        const mpRes = await fetch("https://api.mercadopago.com/v1/payments", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            "X-Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            transaction_amount: info.cents / 100,
            description: `Assinatura — ${info.name}`,
            payment_method_id: method === "pix" ? "pix" : undefined,
            payer: { email: user.email ?? `user-${user.id}@example.com` },
            metadata: { user_id: user.id, plano },
          }),
        });

        const mpData = (await mpRes.json().catch(() => ({}))) as {
          id?: number | string;
          status?: string;
          point_of_interaction?: {
            transaction_data?: {
              qr_code?: string;
              qr_code_base64?: string;
              ticket_url?: string;
            };
          };
          message?: string;
        };

        if (!mpRes.ok) {
          await supabaseAdmin.from("subscription_payments").insert({
            user_id: user.id,
            plano,
            amount_cents: info.cents,
            method,
            provider: "mercadopago",
            status: "rejected",
            payload: mpData,
          });
          return json(
            {
              error: "gateway_error",
              detail: mpData.message ?? "Falha ao criar cobrança",
            },
            502,
          );
        }

        const tx = mpData.point_of_interaction?.transaction_data;
        const { data: row, error } = await supabaseAdmin
          .from("subscription_payments")
          .insert({
            user_id: user.id,
            plano,
            amount_cents: info.cents,
            method,
            provider: "mercadopago",
            provider_payment_id: mpData.id ? String(mpData.id) : null,
            status: mpData.status ?? "pending",
            qr_code: tx?.qr_code ?? null,
            qr_code_base64: tx?.qr_code_base64 ?? null,
            ticket_url: tx?.ticket_url ?? null,
            payload: mpData,
          })
          .select("id, qr_code, qr_code_base64, ticket_url, status")
          .single();

        if (error) return json({ error: "db_error" }, 500);
        return json({ pendingIntegration: false, payment: row });
      },
    },
  },
});
