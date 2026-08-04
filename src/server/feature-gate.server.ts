/**
 * Helper centralizado para validação server-side de planos em createServerFn.
 *
 * Uso típico em um handler com requireSupabaseAuth:
 *
 *   await assertFeatureAccess(context.userId, "whatsapp");
 *
 * Lança Response 403 com payload `{ error: "feature_locked", message }` quando
 * o plano efetivo do usuário não permite o recurso. Admin Master sempre passa.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getSubscriptionForUserIdentity } from "./subscription.server";
import { planAllowsFeature, type FeatureKey, type PlanTier } from "@/lib/plans";
import { hasAdminMasterRole } from "@/server/admin-master.server";

function lockedResponse(message: string): Response {
  return new Response(
    JSON.stringify({
      error: "feature_locked",
      message,
    }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}

function unauthorizedResponse(message = "Você precisa estar logado."): Response {
  return new Response(JSON.stringify({ error: "unauthorized", message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export type FeatureAccessResult =
  | { ok: true; plan: PlanTier; isAdmin: boolean }
  | { ok: false; reason: string; status: 401 | 403 };

/**
 * Valida acesso a uma feature considerando: assinatura ativa, plano efetivo,
 * Admin Master (bypass por e-mail). Não lança — retorna resultado.
 */
export async function checkFeatureAccess(
  userId: string | null | undefined,
  feature: FeatureKey,
): Promise<FeatureAccessResult> {
  if (!userId) {
    return { ok: false, reason: "Você precisa estar logado.", status: 401 };
  }
  try {
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    const isAdmin = await hasAdminMasterRole(userId);
    if (isAdmin) {
      return { ok: true, plan: "admin_master", isAdmin: true };
    }

    const sub = await getSubscriptionForUserIdentity({
      userId,
      email: data.user?.email ?? null,
      repairLink: false,
    });

    if (!sub.active) {
      return {
        ok: false,
        status: 403,
        reason: "Sua assinatura não está ativa. Acesse Meu plano para liberar este recurso.",
      };
    }
    if (!planAllowsFeature(sub.plan, feature)) {
      return {
        ok: false,
        status: 403,
        reason:
          "Este recurso está disponível apenas em planos superiores. Faça upgrade em Meu plano.",
      };
    }
    return { ok: true, plan: sub.plan, isAdmin: false };
  } catch (err) {
    console.error("[checkFeatureAccess] erro", { feature, err });
    return {
      ok: false,
      status: 403,
      reason: "Não foi possível validar seu plano. Tente novamente.",
    };
  }
}

/**
 * Versão que lança Response — uso direto em handlers de createServerFn.
 *
 *   const { plan } = await assertFeatureAccess(context.userId, "whatsapp");
 */
export async function assertFeatureAccess(
  userId: string | null | undefined,
  feature: FeatureKey,
): Promise<{ plan: PlanTier; isAdmin: boolean }> {
  const r = await checkFeatureAccess(userId, feature);
  if (!r.ok) {
    if (r.status === 401) throw unauthorizedResponse(r.reason);
    throw lockedResponse(r.reason);
  }
  return { plan: r.plan, isAdmin: r.isAdmin };
}
