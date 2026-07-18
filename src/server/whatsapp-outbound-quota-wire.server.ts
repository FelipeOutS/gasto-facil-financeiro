/**
 * WA-C11 FASE 3B.2.D — Wiring de quota outbound no dispatcher.
 *
 * SERVER-ONLY. Este módulo é o ÚNICO ponto que combina:
 *   loadPlan → resolveCycle → reserveOutboundQuota
 *     → runOutboundForNotification (que já revalida gates e chama transport)
 *     → commit | release | mark ambiguous
 *
 * ═══════════════════════════════════════════════════════════════════════
 * AUDITORIA DE MIGRATION (Sub-bloco D.2)
 * ═══════════════════════════════════════════════════════════════════════
 * Necessidade avaliada de criar `whatsapp_outbound_reservations`:
 * *NÃO NECESSÁRIA*. O ledger `whatsapp_usage_events` da Fase 3A já cobre:
 *   - uma reservation por notification: unique(idempotency_key) com
 *     chave estável `outbound:<notification_id>`;
 *   - ownership: coluna `user_id`;
 *   - ciclo: coluna `cycle_start`;
 *   - estados: `reserved` | `committed` | `ambiguous` | `released`;
 *   - idempotency: dedupe atômica na RPC reserve;
 *   - transições atômicas: `pg_advisory_xact_lock` na RPC;
 *   - correlação com PMID: parâmetro `p_provider_message_id` no commit;
 *   - concorrência: advisory lock + estado check inline;
 *   - auditoria de commit/release/ambiguous: linhas separadas em
 *     `whatsapp_usage_events` referenciam o event de reserve por
 *     idempotency_key.
 * Reutilizamos, portanto, o ledger existente. Nenhuma tabela nova.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Ordem por notification:
 *   1) Runtime + entitlement + revalidate (já executados pelo dispatcher).
 *   2) Loader de plano + resolução de ciclo.
 *   3) Reserva outbound (idempotente por notification_id).
 *   4) `runOutboundForNotification` (que reavalia dupla-trava e transporta).
 *   5) Finalização:
 *      - accepted → commit
 *      - rejected → release ("definitive_not_accepted")
 *      - ambiguous → nenhum release/commit (a reservation permanece
 *        `ambiguous` pelo RPC atômico do adapter D.2A — a reserva é
 *        marcada como `ambiguous` explicitamente aqui via release-guarded
 *        RPC? NÃO: `release` recusa reservas ambiguous. Sinalizamos via
 *        commitOutboundQuota? NÃO: `commit` só encerra em accepted. Assim:
 *        deixamos a reservation em `reserved`; o recovery de quota é
 *        responsabilidade de reconciliação futura. Para a semântica
 *        D.2, entretanto, chamamos o `markReservationAmbiguous` interno
 *        via a mesma RPC de reserve com reason específico? Ver adiante.)
 *      - local pré-HTTP (invalid_recipient, invalid_template, state_changed,
 *        active_attempt_exists, quarantined, database_error, no_recipient,
 *        no_template, transport_unavailable, gated) → release.
 *
 * Semântica de ambiguous:
 *   O adapter D.2A já move o *attempt* para `ambiguous`. A reservation
 *   permanece `reserved` (não pode ir a released, e commit requer PMID).
 *   Isso satisfaz o requisito: quota consumida (não devolvida) sem commit
 *   final; reconciliação por callback (WA-C9.2 Fase B.2.e) fará
 *   transição para committed ao receber PMID em `sent` tardio, ou
 *   permanecerá em `reserved` até expiração de ciclo (aceito como custo
 *   determinístico de zero-perda-de-integridade). O gate `runOutboundWithQuota`
 *   NUNCA libera reservation após transport ambiguous.
 */
import type { NotificationRow } from "@/server/whatsapp-notifications.server";
import {
  reserveOutboundQuota,
  commitOutboundQuota,
  releaseOutboundQuota,
  type QuotaReserveResult,
  type QuotaFinalizeResult,
  type CycleWindow,
} from "@/server/whatsapp-quota.server";
import {
  resolveCycleForPlan,
  type PlanRow,
  type Cycle,
} from "@/server/whatsapp-cycle-resolver.server";
import {
  runOutboundForNotification,
  type RunOutboundOutcome,
  type RunOutboundDeps,
} from "@/server/whatsapp-dispatcher-outbound.server";
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = _supabaseAdmin as any;

// ─────────────────────────────────────────────────────────────────────────────
// Tipos

export type OutboundWireOutcome =
  | { kind: "plan_load_failed" }
  | { kind: "cycle_invalid"; planCode: string | null }
  | { kind: "quota_denied"; reason: string; planCode: string; duplicate: boolean }
  | { kind: "reserved_then_gated"; released: boolean; released_reason: string | null }
  | { kind: "reserved_then_local_error"; run_kind: RunOutboundOutcome["kind"]; released: boolean }
  | { kind: "committed"; providerMessageId: string; commit_outcome: string }
  | { kind: "released_after_reject"; reason: string; release_outcome: string }
  | { kind: "left_ambiguous"; reason: string }
  | { kind: "state_changed"; released: boolean };

export interface OutboundWireDeps extends RunOutboundDeps {
  /** Carregador de plano do usuário (default: user_plans). */
  loadPlan?: (userId: string) => Promise<PlanRow | null>;
  /** Reserve override para testes. */
  reserveQuota?: typeof reserveOutboundQuota;
  /** Commit override para testes. */
  commitQuota?: typeof commitOutboundQuota;
  /** Release override para testes. */
  releaseQuota?: typeof releaseOutboundQuota;
  /** Executor injetável (default: `runOutboundForNotification`). */
  runOutbound?: typeof runOutboundForNotification;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

async function defaultLoadPlan(userId: string): Promise<PlanRow | null> {
  try {
    const { data } = await sb
      .from("user_plans")
      .select("plano, status, current_period_start, current_period_end, access_until")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return null;
    const r = data as Record<string, unknown>;
    return {
      plano: typeof r.plano === "string" ? r.plano : null,
      status: typeof r.status === "string" ? r.status : null,
      current_period_start:
        typeof r.current_period_start === "string" ? r.current_period_start : null,
      current_period_end:
        typeof r.current_period_end === "string" ? r.current_period_end : null,
      access_until: typeof r.access_until === "string" ? r.access_until : null,
    };
  } catch {
    return null;
  }
}

function safeLog(event: string, extra: Record<string, unknown>): void {
  try {
    console.info("[wa-outbound-wire]", JSON.stringify({ event, ...extra }));
  } catch {
    // no-op
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Orquestrador

/**
 * Orquestra reserva → transport → commit/release, com semântica de
 * ambiguous preservada (nenhum release/commit em resultado inconclusivo).
 *
 * Idempotência garantida pela RPC de reserve (unique idempotency_key
 * `outbound:<notification_id>`): chamadas repetidas retornam `duplicate=true`
 * com a mesma reservation e não incrementam contador.
 */
export async function runOutboundWithQuota(
  notification: Pick<NotificationRow, "id" | "user_id" | "notification_type" | "payload">,
  claimToken: string,
  deps: OutboundWireDeps = {},
): Promise<OutboundWireOutcome> {
  const loadPlan = deps.loadPlan ?? defaultLoadPlan;
  const reserve = deps.reserveQuota ?? reserveOutboundQuota;
  const commit = deps.commitQuota ?? commitOutboundQuota;
  const release = deps.releaseQuota ?? releaseOutboundQuota;
  const run = deps.runOutbound ?? runOutboundForNotification;
  const now = deps.now?.() ?? new Date();

  // 1) Carrega plano
  const plan = await loadPlan(notification.user_id);
  const planCode = plan?.plano ?? "free_ads";

  // 2) Resolve ciclo
  const cycle: Cycle = resolveCycleForPlan(plan, now);
  if (cycle.source === "invalid") {
    safeLog("cycle_invalid", { n: notification.id.slice(0, 8) });
    return { kind: "cycle_invalid", planCode };
  }
  const window: CycleWindow = { cycleStart: cycle.cycleStart, cycleEnd: cycle.cycleEnd };

  // 3) Reserve (idempotente por notification_id)
  const reserved: QuotaReserveResult = await reserve({
    userId: notification.user_id,
    notificationId: notification.id,
    planCode,
    cycle: window,
    now,
  });

  if (!reserved.allowed) {
    safeLog("quota_denied", {
      n: notification.id.slice(0, 8),
      reason: reserved.reason,
      plan: planCode,
    });
    return {
      kind: "quota_denied",
      reason: reserved.reason ?? "unknown",
      planCode,
      duplicate: reserved.duplicate,
    };
  }

  // Se duplicate + state committed/ambiguous, não chamamos transport (já foi).
  if (reserved.duplicate && (reserved.state === "committed" || reserved.state === "ambiguous")) {
    safeLog("reservation_terminal", {
      n: notification.id.slice(0, 8),
      state: reserved.state,
    });
    if (reserved.state === "ambiguous") {
      return { kind: "left_ambiguous", reason: "reservation_already_ambiguous" };
    }
    return { kind: "committed", providerMessageId: "", commit_outcome: "already_committed" };
  }

  // 4) Executa transport (que já revalida runtime/entitlement/rollout/link)
  const outcome: RunOutboundOutcome = await run(notification, claimToken, deps);

  // 5) Finaliza reservation conforme outcome
  switch (outcome.kind) {
    case "gated": {
      // Runtime/entitlement/rollout/link revogados entre reserve e transport.
      // NENHUM HTTP disparou → seguro liberar.
      const rel = await release({
        userId: notification.user_id,
        notificationId: notification.id,
        reason: "gated_after_reserve",
        now,
      });
      return {
        kind: "reserved_then_gated",
        released: rel.outcome === "released" || rel.outcome === "already_released",
        released_reason: rel.outcome,
      };
    }
    case "no_recipient":
    case "no_template":
    case "transport_unavailable": {
      // Falha local ANTES do HTTP → seguro liberar.
      const rel = await release({
        userId: notification.user_id,
        notificationId: notification.id,
        reason: `local_pre_http:${outcome.kind}`,
        now,
      });
      return {
        kind: "reserved_then_local_error",
        run_kind: outcome.kind,
        released: rel.outcome === "released" || rel.outcome === "already_released",
      };
    }
    case "executed": {
      const r = outcome.result;
      switch (r.kind) {
        case "accepted": {
          const c: QuotaFinalizeResult = await commit({
            userId: notification.user_id,
            notificationId: notification.id,
            providerMessageId: r.providerMessageId,
            now,
          });
          return {
            kind: "committed",
            providerMessageId: r.providerMessageId,
            commit_outcome: c.outcome,
          };
        }
        case "rejected": {
          // Rejeição definitiva do provider (não-retryable) → release documentado.
          // Nota: rejeições retryable ainda são release aqui porque nenhuma
          // mensagem foi aceita; o retry (fase futura) precisa reservar de novo.
          const rel = await release({
            userId: notification.user_id,
            notificationId: notification.id,
            reason: `provider_rejected:${r.errorCode ?? "unknown"}`,
            now,
          });
          return {
            kind: "released_after_reject",
            reason: r.errorCode ?? "unknown",
            release_outcome: rel.outcome,
          };
        }
        case "ambiguous": {
          // NUNCA liberar. NUNCA commitar. Reservation permanece `reserved`
          // até reconciliação por callback (fase B.2.e). Nenhum retry.
          safeLog("left_ambiguous", {
            n: notification.id.slice(0, 8),
            reason: r.reason,
          });
          return { kind: "left_ambiguous", reason: r.reason };
        }
        case "invalid_recipient":
        case "invalid_template":
        case "invalid_template_language":
        case "active_attempt_exists":
        case "quarantined":
        case "database_error": {
          // Pré-HTTP local. Seguro liberar (nada foi transportado).
          const rel = await release({
            userId: notification.user_id,
            notificationId: notification.id,
            reason: `local_pre_http:${r.kind}`,
            now,
          });
          return {
            kind: "reserved_then_local_error",
            run_kind: outcome.kind,
            released: rel.outcome === "released" || rel.outcome === "already_released",
          };
        }
        case "state_changed": {
          // Claim/lease perdido ANTES do sendTemplate (markAttemptSending
          // falhou). Nenhum HTTP → seguro liberar.
          const rel = await release({
            userId: notification.user_id,
            notificationId: notification.id,
            reason: "state_changed_pre_http",
            now,
          });
          return {
            kind: "state_changed",
            released: rel.outcome === "released" || rel.outcome === "already_released",
          };
        }
      }
      // Exhaustive
      return { kind: "left_ambiguous", reason: "unknown_execute_kind" };
    }
  }
}
