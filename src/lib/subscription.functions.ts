import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getCurrentUserSubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getSubscriptionForUserIdentity } = await import("@/server/subscription.server");
    const { reconcilePendingCardPaymentsForUser } = await import("@/server/mercadopago.server");
    const { userId } = context;
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    // Reconcilia pagamentos por cartão pendentes antes de avaliar o estado.
    // Garante que pagamentos aprovados no Mercado Pago ativem o plano mesmo
    // quando o webhook não chega (caso real da usuária Andrea).
    try {
      await reconcilePendingCardPaymentsForUser(userId);
    } catch (err) {
      console.warn("[getCurrentUserSubscription] reconcile falhou", err);
    }
    const sub = await getSubscriptionForUserIdentity({
      userId,
      email: data.user?.email ?? null,
      repairLink: true,
    });
    console.info("[getCurrentUserSubscription]", sub.debug);
    return sub;
  });

/**
 * Fase 1E-B2K — Ativa voluntariamente o plano "Gratuito com anúncios"
 * (free_ads) para o usuário autenticado.
 *
 * Regras:
 * - Sempre opera sobre auth.uid() — nunca recebe user_id do client.
 * - Admin Master nunca é alterado.
 * - Usuário com plano pago ATIVO (não free_ads / não free / não sem_assinatura)
 *   dentro do período corrente NÃO é rebaixado: retorna erro amigável.
 * - Idempotente para quem já está em free_ads / ativo.
 * - sem_assinatura, free legado, pago expirado/cancelado/inativo: vira free_ads ativo.
 * - NÃO toca em checkout, Mercado Pago, last_payment_id, periodicidade ou trial.
 */
export const chooseFreeAdsPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    // 1. Admin Master — nunca alterar.
    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = (userData?.user?.email ?? "").toLowerCase().trim();
    const ADMIN_EMAILS = new Set([
      "felipe.out.silva@outlook.com",
      "michael@medeiroscenografia.com.br",
    ]);
    if (email && ADMIN_EMAILS.has(email)) {
      return { ok: false as const, reason: "admin_master" as const };
    }

    // 2. Estado atual.
    const { data: current, error: selErr } = await supabaseAdmin
      .from("user_plans")
      .select(
        "plano, status, current_period_end, cancelled_at, access_until, trial_ends_at",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (selErr) {
      console.warn("[chooseFreeAdsPlan] select falhou", selErr);
      return { ok: false as const, reason: "db_error" as const };
    }

    const now = new Date();
    const periodEndMs = current?.current_period_end
      ? new Date(current.current_period_end).getTime()
      : 0;
    const periodStillActive =
      !current?.current_period_end || periodEndMs > now.getTime();

    const isPaidPlan =
      !!current?.plano &&
      current.plano !== "free" &&
      current.plano !== "sem_assinatura" &&
      current.plano !== "free_ads";

    const isPaidActive =
      isPaidPlan && current?.status === "ativo" && periodStillActive;

    if (isPaidActive) {
      return { ok: false as const, reason: "paid_plan_active" as const };
    }

    // 3. Idempotente — já está em free_ads ativo.
    if (current?.plano === "free_ads" && current?.status === "ativo") {
      return {
        ok: true as const,
        idempotent: true,
        previousPlan: current.plano,
      };
    }

    const previousPlan = current?.plano ?? null;
    const nowIso = now.toISOString();

    // 4. Upsert sem tocar em campos de pagamento histórico (last_payment_id,
    //    periodicidade, months, trial_*). Só limpa cancelado/expiração e
    //    define free_ads como vigente sem fim previsto.
    const patch = {
      plano: "free_ads",
      status: "ativo",
      current_period_start: nowIso,
      current_period_end: null,
      cancelled_at: null,
      access_until: null,
    } as const;

    if (current) {
      const { error } = await supabaseAdmin
        .from("user_plans")
        .update(patch)
        .eq("user_id", userId);
      if (error) {
        console.warn("[chooseFreeAdsPlan] update falhou", error);
        return { ok: false as const, reason: "db_error" as const };
      }
    } else {
      const { error } = await supabaseAdmin
        .from("user_plans")
        .insert({ user_id: userId, ...patch });
      if (error) {
        console.warn("[chooseFreeAdsPlan] insert falhou", error);
        return { ok: false as const, reason: "db_error" as const };
      }
    }

    // 5. Audit (best-effort, sem dados sensíveis).
    try {
      await supabaseAdmin.from("audit_logs").insert({
        actor_user_id: userId,
        target_user_id: userId,
        action: "choose_free_ads_plan",
        entity_type: "user_plans",
        entity_id: userId,
        old_data: { plano: previousPlan, status: current?.status ?? null },
        new_data: { plano: "free_ads", status: "ativo" },
      });
    } catch (err) {
      console.warn("[chooseFreeAdsPlan] audit falhou", err);
    }

    return {
      ok: true as const,
      idempotent: false,
      previousPlan,
    };
  });
