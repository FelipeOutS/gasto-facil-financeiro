/**
 * WA-C11 FASE 3B — Quota Helper
 *
 * SERVER-ONLY. Wrappers finos sobre as RPCs `SECURITY DEFINER` da Fase 3A.
 * Todas as RPCs têm ACL restrita a `service_role`, então este módulo usa
 * `supabaseAdmin`.
 *
 * Regras invioláveis:
 *   - Idempotência: chave `idempotency_key` estável derivada do evento
 *     (inbound_message_id, notification_id + tipo). RPC deduplica.
 *   - `ambiguous` NUNCA libera reserva. Retorna outcome=`ambiguous_preserved`.
 *   - Contador nunca negativo (constraint no banco + advisory lock na RPC).
 *   - Logs sanitizados: nunca vaza telefone, payload, secret.
 *   - Fail-closed: erro de RPC → allowed=false / outcome="db_error".
 */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = _supabaseAdmin as any;

// ─────────────────────────────────────────────────────────────────────────────
// Tipos

export interface QuotaConsumeResult {
  allowed: boolean;
  reason: string | null;
  limit: number;
  used: number;
  remaining: number;
  duplicate: boolean;
  state: string | null;
}

export interface QuotaReserveResult extends QuotaConsumeResult {
  reservationId: string | null;
}

export interface QuotaFinalizeResult {
  outcome: string;
  state: string | null;
}

export interface QuotaSnapshot {
  planCode: string;
  inboundLimit: number;
  inboundUsed: number;
  outboundLimit: number;
  outboundReserved: number;
  outboundCommitted: number;
  financialLimit: number;
  financialUsed: number;
  dailyInboundLimit: number;
  dailyInboundUsed: number;
  dailyOutboundLimit: number;
  dailyOutboundUsed: number;
  cycleStart: string;
  cycleEnd: string;
}

export interface CycleWindow {
  cycleStart: Date;
  cycleEnd: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

function toIso(d: Date): string {
  return d.toISOString();
}

function safeLog(event: string, extra: Record<string, unknown>): void {
  try {
    console.log(JSON.stringify({ module: "wa-quota", event, ...extra }));
  } catch {
    // no-op
  }
}

function denied(reason: string): QuotaConsumeResult {
  return { allowed: false, reason, limit: 0, used: 0, remaining: 0, duplicate: false, state: null };
}

function normalizeConsume(row: unknown): QuotaConsumeResult {
  const r = (row ?? {}) as Record<string, unknown>;
  return {
    allowed: r.allowed === true,
    reason: typeof r.reason === "string" ? r.reason : null,
    limit: typeof r.limit === "number" ? r.limit : 0,
    used: typeof r.used === "number" ? r.used : 0,
    remaining: typeof r.remaining === "number" ? r.remaining : 0,
    duplicate: r.duplicate === true,
    state: typeof r.state === "string" ? r.state : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Inbound

export async function consumeInboundQuota(
  args: {
    userId: string;
    inboundMessageId: string;
    planCode: string;
    cycle: CycleWindow;
    now?: Date;
  },
  client: unknown = sb,
): Promise<QuotaConsumeResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    const { data, error } = await c.rpc("whatsapp_consume_inbound_quota_atomic", {
      p_user_id: args.userId,
      p_inbound_message_id: args.inboundMessageId,
      p_plan_code: args.planCode,
      p_cycle_start: toIso(args.cycle.cycleStart),
      p_cycle_end: toIso(args.cycle.cycleEnd),
      p_now: toIso(args.now ?? new Date()),
    });
    if (error) {
      safeLog("inbound_rpc_error", { code: (error as { code?: unknown })?.code ?? null });
      return denied("db_error");
    }
    const row = Array.isArray(data) ? data[0] : data;
    return normalizeConsume(row);
  } catch {
    safeLog("inbound_exception", {});
    return denied("db_error");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Financial action

export async function consumeFinancialActionQuota(
  args: {
    userId: string;
    idempotencyKey: string;
    planCode: string;
    cycle: CycleWindow;
    now?: Date;
  },
  client: unknown = sb,
): Promise<QuotaConsumeResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    const { data, error } = await c.rpc("whatsapp_consume_financial_action_quota_atomic", {
      p_user_id: args.userId,
      p_idempotency_key: args.idempotencyKey,
      p_plan_code: args.planCode,
      p_cycle_start: toIso(args.cycle.cycleStart),
      p_cycle_end: toIso(args.cycle.cycleEnd),
      p_now: toIso(args.now ?? new Date()),
    });
    if (error) {
      safeLog("financial_rpc_error", { code: (error as { code?: unknown })?.code ?? null });
      return denied("db_error");
    }
    const row = Array.isArray(data) ? data[0] : data;
    return normalizeConsume(row);
  } catch {
    safeLog("financial_exception", {});
    return denied("db_error");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Outbound: reserve / commit / release

export async function reserveOutboundQuota(
  args: {
    userId: string;
    notificationId: string;
    planCode: string;
    cycle: CycleWindow;
    now?: Date;
  },
  client: unknown = sb,
): Promise<QuotaReserveResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    const { data, error } = await c.rpc("whatsapp_reserve_outbound_quota_atomic", {
      p_user_id: args.userId,
      p_notification_id: args.notificationId,
      p_plan_code: args.planCode,
      p_cycle_start: toIso(args.cycle.cycleStart),
      p_cycle_end: toIso(args.cycle.cycleEnd),
      p_now: toIso(args.now ?? new Date()),
    });
    if (error) {
      safeLog("reserve_rpc_error", { code: (error as { code?: unknown })?.code ?? null });
      return { ...denied("db_error"), reservationId: null };
    }
    const row = Array.isArray(data) ? data[0] : data;
    const base = normalizeConsume(row);
    const rr = (row ?? {}) as Record<string, unknown>;
    return { ...base, reservationId: typeof rr.reservation_id === "string" ? rr.reservation_id : null };
  } catch {
    safeLog("reserve_exception", {});
    return { ...denied("db_error"), reservationId: null };
  }
}

/**
 * Commit da reserva. Chamado após aceite Meta + PMID.
 * RPC é idempotente por (user_id, notification_id).
 */
export async function commitOutboundQuota(
  args: {
    userId: string;
    notificationId: string;
    providerMessageId: string;
    now?: Date;
  },
  client: unknown = sb,
): Promise<QuotaFinalizeResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    const { data, error } = await c.rpc("whatsapp_commit_outbound_quota_atomic", {
      p_user_id: args.userId,
      p_notification_id: args.notificationId,
      p_provider_message_id: args.providerMessageId,
      p_now: toIso(args.now ?? new Date()),
    });
    if (error) {
      safeLog("commit_rpc_error", { code: (error as { code?: unknown })?.code ?? null });
      return { outcome: "db_error", state: null };
    }
    const row = Array.isArray(data) ? data[0] : data;
    const rr = (row ?? {}) as Record<string, unknown>;
    return {
      outcome: typeof rr.outcome === "string" ? rr.outcome : "unknown",
      state: typeof rr.state === "string" ? rr.state : null,
    };
  } catch {
    safeLog("commit_exception", {});
    return { outcome: "db_error", state: null };
  }
}

/**
 * Release da reserva. SÓ chamar quando houver prova de que nenhum envio
 * ocorreu. RPC recusa release de reservas `ambiguous`, `committed`,
 * `sent`, `delivered`, `read`.
 */
export async function releaseOutboundQuota(
  args: {
    userId: string;
    notificationId: string;
    reason: string;
    now?: Date;
  },
  client: unknown = sb,
): Promise<QuotaFinalizeResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    const { data, error } = await c.rpc("whatsapp_release_outbound_quota_atomic", {
      p_user_id: args.userId,
      p_notification_id: args.notificationId,
      p_reason: args.reason,
      p_now: toIso(args.now ?? new Date()),
    });
    if (error) {
      safeLog("release_rpc_error", { code: (error as { code?: unknown })?.code ?? null });
      return { outcome: "db_error", state: null };
    }
    const row = Array.isArray(data) ? data[0] : data;
    const rr = (row ?? {}) as Record<string, unknown>;
    return {
      outcome: typeof rr.outcome === "string" ? rr.outcome : "unknown",
      state: typeof rr.state === "string" ? rr.state : null,
    };
  } catch {
    safeLog("release_exception", {});
    return { outcome: "db_error", state: null };
  }
}

/**
 * WA-C11 Fase 3B.2.E — Marca a reserva como ambiguous.
 * Chamado APENAS quando o transport retornou ambiguous (network_error /
 * timeout / server_error 5xx) e nenhuma evidência clara existe. Impede
 * retry produtivo até que um callback com PMID reconcilie.
 * RPC recusa transições fora de `reserved → ambiguous`.
 */
export async function markReservationAmbiguous(
  args: { userId: string; notificationId: string; reason: string; now?: Date },
  client: unknown = sb,
): Promise<QuotaFinalizeResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    const { data, error } = await c.rpc("whatsapp_mark_reservation_ambiguous_atomic", {
      p_user_id: args.userId,
      p_notification_id: args.notificationId,
      p_reason: args.reason,
      p_now: toIso(args.now ?? new Date()),
    });
    if (error) {
      safeLog("mark_ambiguous_rpc_error", { code: (error as { code?: unknown })?.code ?? null });
      return { outcome: "db_error", state: null };
    }
    const row = Array.isArray(data) ? data[0] : data;
    const rr = (row ?? {}) as Record<string, unknown>;
    return {
      outcome: typeof rr.outcome === "string" ? rr.outcome : "unknown",
      state: typeof rr.state === "string" ? rr.state : null,
    };
  } catch {
    safeLog("mark_ambiguous_exception", {});
    return { outcome: "db_error", state: null };
  }
}

/**
 * WA-C11 Fase 3B.2.E — Reconcilia reserva a partir de callback Meta.
 * Callback com PMID válido é evidência de aceite. Promove reservation
 * `reserved` ou `ambiguous` para `committed` de forma idempotente.
 * Nunca cria nova reservation; nunca consome duas vezes.
 */
export async function reconcileReservationFromCallback(
  args: { userId: string; notificationId: string; providerMessageId: string; now?: Date },
  client: unknown = sb,
): Promise<QuotaFinalizeResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    const { data, error } = await c.rpc("whatsapp_reconcile_reservation_from_callback_atomic", {
      p_user_id: args.userId,
      p_notification_id: args.notificationId,
      p_provider_message_id: args.providerMessageId,
      p_now: toIso(args.now ?? new Date()),
    });
    if (error) {
      safeLog("reconcile_rpc_error", { code: (error as { code?: unknown })?.code ?? null });
      return { outcome: "db_error", state: null };
    }
    const row = Array.isArray(data) ? data[0] : data;
    const rr = (row ?? {}) as Record<string, unknown>;
    return {
      outcome: typeof rr.outcome === "string" ? rr.outcome : "unknown",
      state: typeof rr.state === "string" ? rr.state : null,
    };
  } catch {
    safeLog("reconcile_exception", {});
    return { outcome: "db_error", state: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot

export async function getUsageSnapshot(
  args: { userId: string; planCode: string; cycle: CycleWindow },
  client: unknown = sb,
): Promise<QuotaSnapshot | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    const { data, error } = await c.rpc("whatsapp_get_usage_snapshot", {
      p_user_id: args.userId,
      p_plan_code: args.planCode,
      p_cycle_start: toIso(args.cycle.cycleStart),
      p_cycle_end: toIso(args.cycle.cycleEnd),
    });
    if (error || !data) return null;
    const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
    if (!r) return null;
    return {
      planCode: String(r.plan_code ?? args.planCode),
      inboundLimit: Number(r.inbound_limit ?? 0),
      inboundUsed: Number(r.inbound_used ?? 0),
      outboundLimit: Number(r.outbound_limit ?? 0),
      outboundReserved: Number(r.outbound_reserved ?? 0),
      outboundCommitted: Number(r.outbound_committed ?? 0),
      financialLimit: Number(r.financial_limit ?? 0),
      financialUsed: Number(r.financial_used ?? 0),
      dailyInboundLimit: Number(r.daily_inbound_limit ?? 0),
      dailyInboundUsed: Number(r.daily_inbound_used ?? 0),
      dailyOutboundLimit: Number(r.daily_outbound_limit ?? 0),
      dailyOutboundUsed: Number(r.daily_outbound_used ?? 0),
      cycleStart: String(r.cycle_start ?? toIso(args.cycle.cycleStart)),
      cycleEnd: String(r.cycle_end ?? toIso(args.cycle.cycleEnd)),
    };
  } catch {
    return null;
  }
}
