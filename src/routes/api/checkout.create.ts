import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isPlanAvailableForNewSubscriptions, type PlanTier } from "@/lib/plans";
import {
  environmentForPersistence,
  resolveMercadoPagoConfig,
} from "@/server/mercadopago-config.server";
import { resolveCatalogOffer } from "@/server/mercadopago-plan-catalog.server";
import {
  attachProviderIdsToSession,
  createCheckoutSession,
} from "@/server/mercadopago-checkout-session.server";

/**
 * POST /api/checkout/create
 *
 * Prompt 4A — endurecido:
 *   - ambiente resolvido pelo módulo central (`mercadopago-config.server`);
 *     sandbox nunca usa credencial de produção e vice-versa;
 *   - preço/periodicidade/moeda/duração vêm do catálogo SERVER-SIDE
 *     (`mercadopago-plan-catalog.server`) — o cliente só escolhe plan_key;
 *   - `external_reference` é OPACA e persistida em `payment_checkout_sessions`;
 *   - `notification_url` explícita, derivada do ambiente;
 *   - expiração calculada no servidor, enviada ao provedor e persistida.
 *
 * Body: { plano: PlanTier, periodicidade?: 'mensal'|'trimestral'|'semestral'|'anual', method?: 'pix' | 'card' }
 */

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

        const method = (body.method as "pix" | "card") ?? "pix";
        if (method !== "pix" && method !== "card") return json({ error: "invalid_method" }, 400);

        // ---- Catálogo server-side: única fonte de preço/moeda/duração ----
        const resolved = resolveCatalogOffer({
          planKey: body.plano,
          periodicity: body.periodicidade ?? "mensal",
        });
        if (!resolved.ok) {
          if (resolved.error === "invalid_plan") return json({ error: "invalid_plan" }, 400);
          if (resolved.error === "invalid_period") return json({ error: "invalid_period" }, 400);
          return json(
            {
              error: "plan_unavailable",
              detail: "Este plano não está mais disponível para novas assinaturas.",
            },
            410,
          );
        }
        const offer = resolved.offer;
        if (!isPlanAvailableForNewSubscriptions(offer.planKey as PlanTier)) {
          return json(
            {
              error: "plan_unavailable",
              detail: "Este plano não está mais disponível para novas assinaturas.",
            },
            410,
          );
        }

        // ---- Ambiente fail-closed ----
        const cfg = resolveMercadoPagoConfig();
        if (!cfg.allowNewCheckouts || !cfg.accessToken || !cfg.notificationUrl) {
          console.warn("[checkout/create] bloqueado por configuração", {
            state: cfg.state,
            environment: cfg.environment,
            messages: cfg.diagnostics,
          });
          return json(
            {
              error: "payment_environment_not_configured",
              detail: "Pagamentos temporariamente indisponíveis. Configuração pendente.",
              state: cfg.state,
            },
            503,
          );
        }
        if (cfg.legacyFallbackUsed) {
          console.warn(
            "[checkout/create] usando credenciais LEGADAS de produção (fallback documentado)",
          );
        }
        const environment = environmentForPersistence(cfg);

        // ---- Marca o plano como aguardando pagamento (sem rebaixar ativo) ----
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
          plano: offer.planKey as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          status: (isCurrentlyActive ? "ativo" : "aguardando_pagamento") as any,
          periodicidade: offer.periodicity,
          months: offer.months,
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

        // ---- Sessão interna de checkout (referência opaca + expiração) ----
        const created = await createCheckoutSession({
          userId: user.id,
          offer,
          method,
          config: cfg,
        });
        if (!created.ok) {
          console.error("[checkout/create] falha ao criar sessão interna", created.error);
          return json({ error: "checkout_session_error" }, 503);
        }
        const { session, externalReference, expiresAt } = created;

        const paymentInsertBase = {
          user_id: user.id,
          plano: offer.planKey,
          amount_cents: offer.amountCents,
          currency: offer.currency,
          method,
          periodicidade: offer.periodicity,
          months: offer.months,
          discount_percent: offer.discountPercent,
          provider: "mercadopago",
          environment,
          purchase_origin: "mercado_pago_web",
          checkout_session_id: session.id,
        };

        // Metadata do provedor — sem PII adicional; a resolução autoritativa
        // acontece pela referência opaca, não por este metadata.
        const metadata = {
          checkout_session_id: session.id,
          plan_key: offer.planKey,
          periodicidade: offer.periodicity,
          months: offer.months,
          environment,
          source: "gasto_inteligente",
        };

        // ============================================================
        // Cartão — Checkout Pro (preference)
        // ============================================================
        if (method === "card") {
          const idempotencyKey = `${session.id}-card`;
          const backBase = cfg.siteBaseUrl ?? "";
          const prefRes = await fetch(`${cfg.apiBaseUrl}/checkout/preferences`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${cfg.accessToken}`,
              "X-Idempotency-Key": idempotencyKey,
            },
            body: JSON.stringify({
              items: [
                {
                  id: `${offer.planKey}-${offer.periodicity}`,
                  title: offer.description,
                  description: offer.description,
                  quantity: 1,
                  currency_id: offer.currency,
                  unit_price: offer.amountCents / 100,
                },
              ],
              payer: { email: user.email ?? `user-${user.id}@example.com` },
              metadata,
              external_reference: externalReference,
              notification_url: cfg.notificationUrl,
              expires: true,
              expiration_date_to: expiresAt.toISOString(),
              back_urls: {
                success: `${backBase}/meu-plano?status=success`,
                pending: `${backBase}/meu-plano?status=pending`,
                failure: `${backBase}/meu-plano?status=failure`,
              },
              auto_return: "approved",
              binary_mode: false,
              statement_descriptor: "GastoInteligente",
              payment_methods: {
                excluded_payment_types: [{ id: "ticket" }, { id: "atm" }],
                installments: 12,
              },
            }),
          });
          const prefData = (await prefRes.json().catch(() => ({}))) as {
            id?: string;
            init_point?: string;
            message?: string;
          };
          if (!prefRes.ok || !prefData.init_point) {
            await supabaseAdmin.from("subscription_payments").insert({
              ...paymentInsertBase,
              status: "rejected",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              payload: { error: "preference_error" } as any,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
            await attachProviderIdsToSession({ sessionId: session.id, status: "rejected" });
            return json(
              { error: "gateway_error", detail: prefData.message ?? "Falha ao criar checkout." },
              502,
            );
          }
          await attachProviderIdsToSession({
            sessionId: session.id,
            preferenceId: prefData.id ?? null,
            status: "pending",
          });
          const { data: row, error } = await supabaseAdmin
            .from("subscription_payments")
            .insert({
              ...paymentInsertBase,
              provider_payment_id: prefData.id ?? null,
              status: "pending",
              ticket_url: prefData.init_point ?? null,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              payload: { preference_id: prefData.id ?? null } as any,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any)
            .select("id, status, ticket_url")
            .single();
          if (error) return json({ error: "db_error" }, 500);
          return json({
            pendingIntegration: false,
            method: "card",
            expiresAt: expiresAt.toISOString(),
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
        // Pix — pagamento direto
        // ============================================================
        const mpRes = await fetch(`${cfg.apiBaseUrl}/v1/payments`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cfg.accessToken}`,
            "X-Idempotency-Key": `${session.id}-pix`,
          },
          body: JSON.stringify({
            transaction_amount: offer.amountCents / 100,
            description: offer.description,
            payment_method_id: "pix",
            payer: { email: user.email ?? `user-${user.id}@example.com` },
            metadata,
            external_reference: externalReference,
            notification_url: cfg.notificationUrl,
            date_of_expiration: expiresAt.toISOString(),
          }),
        });

        const mpData = (await mpRes.json().catch(() => ({}))) as {
          id?: number | string;
          status?: string;
          point_of_interaction?: {
            transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string };
          };
          message?: string;
        };

        if (!mpRes.ok) {
          await supabaseAdmin.from("subscription_payments").insert({
            ...paymentInsertBase,
            status: "rejected",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            payload: { error: "payment_error" } as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any);
          await attachProviderIdsToSession({ sessionId: session.id, status: "rejected" });
          return json(
            { error: "gateway_error", detail: mpData.message ?? "Falha ao criar cobrança" },
            502,
          );
        }

        await attachProviderIdsToSession({
          sessionId: session.id,
          paymentId: mpData.id ? String(mpData.id) : null,
          status: "pending",
        });

        const tx = mpData.point_of_interaction?.transaction_data;
        const { data: row, error } = await supabaseAdmin
          .from("subscription_payments")
          .insert({
            ...paymentInsertBase,
            provider_payment_id: mpData.id ? String(mpData.id) : null,
            status: mpData.status ?? "pending",
            qr_code: tx?.qr_code ?? null,
            qr_code_base64: tx?.qr_code_base64 ?? null,
            ticket_url: tx?.ticket_url ?? null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            payload: { id: mpData.id ?? null, status: mpData.status ?? null } as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any)
          .select("id, qr_code, qr_code_base64, ticket_url, status")
          .single();

        if (error) return json({ error: "db_error" }, 500);
        return json({
          pendingIntegration: false,
          method: "pix",
          expiresAt: expiresAt.toISOString(),
          payment: row,
        });
      },
    },
  },
});
