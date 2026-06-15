import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isPlanAvailableForNewSubscriptions, type PlanTier } from "@/lib/plans";

/**
 * POST /api/checkout/create
 *
 * Cria uma cobrança no Mercado Pago para o plano + periodicidade escolhidos
 * e registra a tentativa em `subscription_payments` (status 'pending').
 *
 * - method = "pix": cria pagamento Pix direto (`/v1/payments`) e devolve QR Code.
 * - method = "card": cria preferência (`/checkout/preferences`) com Pix + cartão
 *   habilitados e devolve `init_point` para redirecionar ao Checkout Pro.
 *
 * Também marca `user_plans.status = 'aguardando_pagamento'`, plano e periodicidade.
 *
 * Body: { plano: PlanTier, periodicidade?: 'mensal'|'trimestral'|'semestral'|'anual', method?: 'pix' | 'card' }
 */

type Plano =
  | "pessoal_manual"
  | "pessoal_premium"
  | "mei_essencial"
  | "mei_inteligente"
  | "empresa";

type Periodicidade = "mensal" | "trimestral" | "semestral" | "anual";

const PLAN_BASE: Record<Plano, { cents: number; name: string }> = {
  pessoal_manual: { cents: 2500, name: "Controle Simples Pessoal" },
  pessoal_premium: { cents: 5000, name: "Controle Completo Pessoal" },
  mei_essencial: { cents: 3990, name: "Essencial para MEI" },
  mei_inteligente: { cents: 9000, name: "MEI Completo" },
  empresa: { cents: 18000, name: "Empresa" },
};

const PERIOD_INFO: Record<Periodicidade, { months: number; discount: number; label: string }> = {
  mensal: { months: 1, discount: 0, label: "Mensal" },
  trimestral: { months: 3, discount: 5, label: "Trimestral" },
  semestral: { months: 6, discount: 10, label: "Semestral" },
  anual: { months: 12, discount: 20, label: "Anual" },
};

function priceForPeriod(plano: Plano, period: Periodicidade): number {
  const base = PLAN_BASE[plano].cents * PERIOD_INFO[period].months;
  return Math.round(base * (1 - PERIOD_INFO[period].discount / 100));
}

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

        let body: { plano?: string; method?: string; periodicidade?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "invalid_body" }, 400);
        }
        const plano = body.plano as Plano | undefined;
        const method = (body.method as "pix" | "card") ?? "pix";
        const periodicidade = (body.periodicidade as Periodicidade) ?? "mensal";
        if (!plano || !(plano in PLAN_BASE)) return json({ error: "invalid_plan" }, 400);
        if (!isPlanAvailableForNewSubscriptions(plano as PlanTier)) {
          return json(
            {
              error: "plan_unavailable",
              detail: "Este plano não está mais disponível para novas assinaturas.",
            },
            410,
          );
        }
        if (!(periodicidade in PERIOD_INFO)) return json({ error: "invalid_period" }, 400);
        if (method !== "pix" && method !== "card") return json({ error: "invalid_method" }, 400);

        const info = PLAN_BASE[plano];
        const periodInfo = PERIOD_INFO[periodicidade];
        const totalCents = priceForPeriod(plano, periodicidade);
        const description = `Assinatura ${info.name} — ${periodInfo.label}`;

        // Atualiza/insere o registro de plano do usuário como aguardando_pagamento.
        // IMPORTANTE: nunca rebaixar um plano que já está ativo dentro do período pago.
        // Isso evita que abrir um novo checkout (ex.: tentar mudar de plano) marque
        // o usuário como "aguardando_pagamento" e suma o badge "Plano ativo".
        const { data: existingPlan } = await supabaseAdmin
          .from("user_plans")
          .select("user_id, status, current_period_end, plano")
          .eq("user_id", user.id)
          .maybeSingle();
        const isCurrentlyActive =
          !!existingPlan &&
          (existingPlan.status as string) === "ativo" &&
          (!existingPlan.current_period_end ||
            new Date(existingPlan.current_period_end as string).getTime() > Date.now());
        const planUpdate = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          plano: plano as any,
          // Mantém "ativo" se já estiver ativo no período pago; caso contrário
          // marca como aguardando_pagamento até o webhook/verify confirmar.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          status: (isCurrentlyActive ? "ativo" : "aguardando_pagamento") as any,
          periodicidade,
          months: periodInfo.months,
        };
        if (existingPlan) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await supabaseAdmin.from("user_plans").update(planUpdate as any).eq("user_id", user.id);
        } else {
          await supabaseAdmin
            .from("user_plans")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .insert({ user_id: user.id, ...planUpdate } as any);
        }

        const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
        if (!accessToken) {
          const { data: row } = await supabaseAdmin
            .from("subscription_payments")
            .insert({
              user_id: user.id,
              plano,
              amount_cents: totalCents,
              method,
              periodicidade,
              months: periodInfo.months,
              discount_percent: periodInfo.discount,
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

        const metadata = {
          user_id: user.id,
          plano,
          plan_type: plano,
          plan_name: info.name,
          periodicidade,
          months: periodInfo.months,
          discount_percent: periodInfo.discount,
          amount: totalCents / 100,
          source: "gasto_inteligente",
        };

        // ============================================================
        // Cartão (e Pix opcional dentro do mesmo checkout): usa Checkout Pro
        // (preference). O usuário é redirecionado para o ambiente seguro do
        // Mercado Pago para inserir os dados do cartão.
        // ============================================================
        if (method === "card") {
          const origin =
            request.headers.get("origin") ??
            (() => {
              try { return new URL(request.url).origin; } catch { return ""; }
            })();
          const idempotencyKey = `${user.id}-${plano}-${periodicidade}-${Date.now()}`;
          const prefRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
              "X-Idempotency-Key": idempotencyKey,
            },
            body: JSON.stringify({
              items: [
                {
                  id: `${plano}-${periodicidade}`,
                  title: description,
                  description,
                  quantity: 1,
                  currency_id: "BRL",
                  unit_price: totalCents / 100,
                },
              ],
              payer: { email: user.email ?? `user-${user.id}@example.com` },
              metadata,
              external_reference: `${user.id}:${plano}:${periodicidade}`,
              back_urls: {
                success: `${origin}/meu-plano?status=success`,
                pending: `${origin}/meu-plano?status=pending`,
                failure: `${origin}/meu-plano?status=failure`,
              },
              auto_return: "approved",
              binary_mode: false,
              statement_descriptor: "GastoInteligente",
              payment_methods: {
                // Cartão DEVE estar liberado. Excluímos apenas boleto explicitamente.
                excluded_payment_types: [{ id: "ticket" }, { id: "atm" }],
                installments: 12,
              },
            }),
          });
          const prefData = (await prefRes.json().catch(() => ({}))) as {
            id?: string;
            init_point?: string;
            sandbox_init_point?: string;
            message?: string;
          };
          if (!prefRes.ok || !prefData.init_point) {
            await supabaseAdmin.from("subscription_payments").insert({
              user_id: user.id,
              plano,
              amount_cents: totalCents,
              method,
              periodicidade,
              months: periodInfo.months,
              discount_percent: periodInfo.discount,
              provider: "mercadopago",
              status: "rejected",
              payload: prefData,
            });
            return json(
              { error: "gateway_error", detail: prefData.message ?? "Falha ao criar checkout." },
              502,
            );
          }
          const { data: row, error } = await supabaseAdmin
            .from("subscription_payments")
            .insert({
              user_id: user.id,
              plano,
              amount_cents: totalCents,
              method,
              periodicidade,
              months: periodInfo.months,
              discount_percent: periodInfo.discount,
              provider: "mercadopago",
              provider_payment_id: prefData.id ?? null,
              status: "pending",
              ticket_url: prefData.init_point ?? null,
              payload: prefData,
            })
            .select("id, status, ticket_url")
            .single();
          if (error) return json({ error: "db_error" }, 500);
          return json({
            pendingIntegration: false,
            method: "card",
            payment: {
              id: row.id,
              status: row.status,
              init_point: prefData.init_point,
              ticket_url: row.ticket_url,
              qr_code: null,
              qr_code_base64: null,
            },
          });
        }

        // ============================================================
        // Pix (fluxo já existente — preservado). Cria pagamento direto.
        // ============================================================
        const idempotencyKey = `${user.id}-${plano}-${periodicidade}-${Date.now()}`;
        const mpRes = await fetch("https://api.mercadopago.com/v1/payments", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            "X-Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            transaction_amount: totalCents / 100,
            description,
            payment_method_id: "pix",
            payer: { email: user.email ?? `user-${user.id}@example.com` },
            metadata,
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
            amount_cents: totalCents,
            method,
            periodicidade,
            months: periodInfo.months,
            discount_percent: periodInfo.discount,
            provider: "mercadopago",
            status: "rejected",
            payload: mpData,
          });
          return json(
            { error: "gateway_error", detail: mpData.message ?? "Falha ao criar cobrança" },
            502,
          );
        }

        const tx = mpData.point_of_interaction?.transaction_data;
        const { data: row, error } = await supabaseAdmin
          .from("subscription_payments")
          .insert({
            user_id: user.id,
            plano,
            amount_cents: totalCents,
            method,
            periodicidade,
            months: periodInfo.months,
            discount_percent: periodInfo.discount,
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
        return json({ pendingIntegration: false, method: "pix", payment: row });
      },
    },
  },
});
