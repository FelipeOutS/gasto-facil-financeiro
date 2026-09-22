import { getEffectiveUserPlan, type PlanTier, type SubscriptionStatus } from "./plans";

export type SubscriptionAccessInput = {
  storedPlan: string | null;
  status: string | null;
  trialPlan?: string | null;
  trialEndsAt?: string | null;
  cancelledAt?: string | null;
  accessUntil?: string | null;
  currentPeriodEnd?: string | null;
};

/** Interpreta dados já resolvidos pelo servidor; não autentica nem substitui RLS.
 * access_until é o término efetivo do cancelamento, inclusive quando imediato.
 * Não usar current_period_end como fallback: isso prorrogaria acesso revogado.
 * Limites são exclusivos, como nas funções SQL de acesso.
 */
export function resolveSubscriptionAccess(input: SubscriptionAccessInput, now = Date.now()) {
  const storedPlan = getEffectiveUserPlan(null, input.storedPlan);
  const trialPlan = getEffectiveUserPlan(null, input.trialPlan);
  const status = (input.status ?? "").trim().toLowerCase();
  let plan: PlanTier = storedPlan;
  let active = false;
  let effectiveStatus: SubscriptionStatus = "sem_assinatura";
  let expiresAt: string | null = null;
  const hasPlan = storedPlan !== "sem_assinatura" && storedPlan !== "free";

  if (storedPlan === "admin_master") {
    active = true;
    effectiveStatus = "ativo";
  } else if (status === "cancelado") {
    expiresAt = input.accessUntil ?? null;
    active = hasPlan && !!expiresAt && Date.parse(expiresAt) > now;
    effectiveStatus = active ? "cancelado" : "expirado";
  } else if (status === "teste") {
    expiresAt = input.trialEndsAt ?? null;
    plan = trialPlan !== "sem_assinatura" && trialPlan !== "free" ? trialPlan : storedPlan;
    active =
      plan !== "sem_assinatura" && plan !== "free" && !!expiresAt && Date.parse(expiresAt) > now;
    effectiveStatus = active ? "teste" : "expirado";
  } else if (status === "ativo") {
    expiresAt = input.currentPeriodEnd ?? null;
    // Legado e free_ads admitem período sem data final no banco.
    active = hasPlan && (expiresAt === null || Date.parse(expiresAt) > now);
    effectiveStatus = active ? "ativo" : hasPlan ? "expirado" : "sem_assinatura";
  } else if (status === "aguardando_pagamento" || status === "expirado") {
    effectiveStatus = status;
  }

  return {
    active,
    plan: active ? plan : ("sem_assinatura" as PlanTier),
    status: effectiveStatus,
    isTrialActive: active && effectiveStatus === "teste",
    isCancelled: active && effectiveStatus === "cancelado",
    expiresAt,
  };
}
