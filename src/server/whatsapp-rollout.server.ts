/**
 * WA-C11 FASE 3B — Rollout determinístico
 *
 * SERVER-ONLY. Combina:
 *   - env (`WHATSAPP_ENABLED`, `WHATSAPP_CANARY_ENABLED`, `WHATSAPP_DISPATCH_ENABLED`);
 *   - runtime singleton (`global_enabled`, `rollout_enabled`, `rollout_percentage`);
 *   - beta access do usuário (`canUseWhatsApp`);
 *   - plano elegível (não pode ser gratuito);
 *   - bucket determinístico via RPC `whatsapp_user_in_rollout`.
 *
 * Regras invioláveis:
 *   - env false > runtime true (precedência aplicada em cima).
 *   - Plano gratuito (`free`, `free_ads`, `sem_assinatura`, `pessoal_manual`)
 *     nunca entra no rollout.
 *   - Admin Master: caller decide se aplica bypass (documentado em cada gate).
 *     Este helper devolve apenas a decisão do rollout de usuário comum.
 *   - Percentual 0 bloqueia todos. 100 inclui todos que passam nos demais gates.
 */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = _supabaseAdmin as any;

const FREE_PLAN_CODES = new Set(["free", "free_ads", "sem_assinatura", "pessoal_manual"]);

export function isPaidPlan(planCode: string | null | undefined): boolean {
  if (!planCode) return false;
  return !FREE_PLAN_CODES.has(planCode);
}

export type RolloutDenyReason =
  | "plan_free_or_manual"
  | "beta_denied"
  | "rollout_disabled"
  | "percentage_zero"
  | "bucket_out"
  | "runtime_read_failed";

export interface RolloutDecision {
  allowed: boolean;
  reason: RolloutDenyReason | null;
}

export interface RolloutInputs {
  userId: string;
  planCode: string | null;
  betaAllowed: boolean;
  rolloutEnabled: boolean;
  rolloutPercentage: number;
}

/**
 * Consulta o bucket determinístico via RPC. Fail-closed em erro.
 */
export async function userInRollout(
  userId: string,
  percentage: number,
  client: unknown = sb,
): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    const { data, error } = await c.rpc("whatsapp_user_in_rollout", {
      _user_id: userId,
      _pct: percentage,
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

/**
 * Decisão pura (sem I/O) — usada em testes e por callers que já têm
 * o bucket resolvido. Para uso normal, prefira `evaluateRollout` que
 * consulta o bucket via RPC.
 */
export function evaluateRolloutSync(
  inputs: RolloutInputs & { bucketIn: boolean },
): RolloutDecision {
  if (!isPaidPlan(inputs.planCode)) return { allowed: false, reason: "plan_free_or_manual" };
  if (!inputs.betaAllowed) return { allowed: false, reason: "beta_denied" };
  if (!inputs.rolloutEnabled) return { allowed: false, reason: "rollout_disabled" };
  if (inputs.rolloutPercentage <= 0) return { allowed: false, reason: "percentage_zero" };
  if (!inputs.bucketIn) return { allowed: false, reason: "bucket_out" };
  return { allowed: true, reason: null };
}

export async function evaluateRollout(
  inputs: RolloutInputs,
  client: unknown = sb,
): Promise<RolloutDecision> {
  if (!isPaidPlan(inputs.planCode)) return { allowed: false, reason: "plan_free_or_manual" };
  if (!inputs.betaAllowed) return { allowed: false, reason: "beta_denied" };
  if (!inputs.rolloutEnabled) return { allowed: false, reason: "rollout_disabled" };
  if (inputs.rolloutPercentage <= 0) return { allowed: false, reason: "percentage_zero" };
  const bucketIn = await userInRollout(inputs.userId, inputs.rolloutPercentage, client);
  if (!bucketIn) return { allowed: false, reason: "bucket_out" };
  return { allowed: true, reason: null };
}
