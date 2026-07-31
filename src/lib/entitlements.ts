/**
 * Prompt 4A — Contratos e funções puras de entitlement multiplataforma.
 *
 * Objetivo arquitetural:
 *   compra ou concessão → entitlement → plano efetivo → recursos e quotas
 *
 * O plano efetivo NÃO deve depender diretamente do Mercado Pago. Qualquer
 * origem (web, App Store, Google Play, manual, admin, trial) produz um
 * entitlement com o mesmo formato, e o plano efetivo é derivado dele.
 *
 * Módulo puro (sem banco, sem rede, sem secrets) — client-safe.
 * Nesta fase NÃO altera plano de ninguém: apenas fornece os contratos e o
 * resolvedor determinístico usado por testes e pelas próximas etapas.
 */

export type EntitlementOrigin =
  | "mercado_pago_web"
  | "apple_app_store"
  | "google_play"
  | "manual"
  | "admin"
  | "trial"
  | "legacy_unknown";

export type EntitlementState = "active" | "grace" | "cancelled_scheduled" | "expired" | "revoked";

export interface Entitlement {
  origin: EntitlementOrigin;
  planKey: string;
  state: EntitlementState;
  /** ISO. null = sem prazo (concessão administrativa perene). */
  validUntil: string | null;
  /** Precedência quando há múltiplas origens simultâneas. */
  priority?: number;
  environment?: "production" | "sandbox" | "legacy_unknown";
}

export interface EffectivePlanResult {
  planKey: string;
  origin: EntitlementOrigin;
  state: EntitlementState;
  validUntil: string | null;
  /** Motivo sanitizado da decisão. */
  reason: string;
}

const ORIGIN_PRIORITY: Record<EntitlementOrigin, number> = {
  admin: 100,
  manual: 90,
  apple_app_store: 50,
  google_play: 50,
  mercado_pago_web: 50,
  trial: 10,
  legacy_unknown: 1,
};

const PLAN_RANK: Record<string, number> = {
  sem_assinatura: 0,
  free: 0,
  free_ads: 0.5,
  pessoal_manual: 1,
  pessoal_premium: 2,
  mei_essencial: 3,
  mei_inteligente: 4,
  empresa: 5,
  admin_master: 99,
};

export function isEntitlementLive(e: Entitlement, now: Date = new Date()): boolean {
  if (e.state === "revoked" || e.state === "expired") return false;
  if (!e.validUntil) return true;
  const t = new Date(e.validUntil).getTime();
  if (!Number.isFinite(t)) return false;
  return t > now.getTime();
}

/**
 * Plano efetivo a partir do conjunto de entitlements.
 *
 * Regras:
 *   - `admin_master` nunca é rebaixado por evento de pagamento;
 *   - concessão administrativa/manual tem precedência sobre compra;
 *   - entre origens de mesma prioridade, ganha o plano de maior nível;
 *   - `cancelled_scheduled` continua valendo até `validUntil`;
 *   - sem entitlement vivo → `free_ads` (padrão do projeto).
 */
export function resolveEffectivePlan(
  entitlements: ReadonlyArray<Entitlement>,
  options: { isAdminMaster?: boolean; now?: Date; fallbackPlan?: string } = {},
): EffectivePlanResult {
  const now = options.now ?? new Date();
  const fallback = options.fallbackPlan ?? "free_ads";

  if (options.isAdminMaster) {
    return {
      planKey: "admin_master",
      origin: "admin",
      state: "active",
      validUntil: null,
      reason: "admin_master_immune",
    };
  }

  const live = entitlements.filter((e) => isEntitlementLive(e, now));
  if (live.length === 0) {
    return {
      planKey: fallback,
      origin: "legacy_unknown",
      state: "expired",
      validUntil: null,
      reason: "no_live_entitlement",
    };
  }

  const best = [...live].sort((a, b) => {
    const pa = a.priority ?? ORIGIN_PRIORITY[a.origin] ?? 0;
    const pb = b.priority ?? ORIGIN_PRIORITY[b.origin] ?? 0;
    if (pa !== pb) return pb - pa;
    const ra = PLAN_RANK[a.planKey] ?? 0;
    const rb = PLAN_RANK[b.planKey] ?? 0;
    if (ra !== rb) return rb - ra;
    const ta = a.validUntil ? new Date(a.validUntil).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.validUntil ? new Date(b.validUntil).getTime() : Number.POSITIVE_INFINITY;
    return tb - ta;
  })[0]!;

  return {
    planKey: best.planKey,
    origin: best.origin,
    state: best.state,
    validUntil: best.validUntil,
    reason: `selected_${best.origin}`,
  };
}
