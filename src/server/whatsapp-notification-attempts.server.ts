/**
 * WA-C9.2 Fase D.2A — Wrappers server-only para as RPCs atômicas de attempts.
 *
 * Encapsula as 5 RPCs SECURITY DEFINER aplicadas em produção:
 *   1. whatsapp_attempt_finalize_accepted_atomic
 *   2. whatsapp_attempt_finalize_rejected_atomic
 *   3. whatsapp_attempt_finalize_ambiguous_atomic
 *   4. whatsapp_attempt_reconcile_callback_atomic
 *   5. whatsapp_notification_recover_with_attempt_atomic
 *
 * Regras invioláveis:
 *   - server-only; nunca importado no bundle client;
 *   - EXCLUSIVAMENTE via supabaseAdmin (service_role); anon/authenticated são
 *     rejeitados pela própria RPC (guarda `auth.role() = 'service_role'`);
 *   - argumentos são validados ANTES da RPC; retorno é mapeado para união
 *     discriminada com fail-closed em outcome desconhecido;
 *   - nenhum retry interno; nenhuma chamada duplicada;
 *   - nenhuma alteração de linha em TypeScript — a RPC é dona da transição.
 */

import type { SupabaseLike } from "@/server/whatsapp-outbound-adapter.server";

// ─────────────────────────────────────────────────────────────────────────────
// Client factory (lazy import — evita vazamento p/ bundle client de rota).

async function admin(): Promise<SupabaseLike> {
  const mod = await import("@/integrations/supabase/client.server");
  return mod.supabaseAdmin as unknown as SupabaseLike;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validadores mínimos (defesa em profundidade; RPC valida também).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const MAX_PMID = 256;
const MAX_ERROR_CODE = 128;
const MAX_ERROR_CATEGORY = 64;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}
function isCleanText(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max && !CTRL_RE.test(v);
}
function sanitize(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const cleaned = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

// ─────────────────────────────────────────────────────────────────────────────
// União discriminada: outcome desconhecido = fail-closed.

export type FinalizeAcceptedOutcome =
  | "accepted"
  | "accepted_idempotent"
  | "conflict_pmid"
  | "conflict_state"
  | "state_changed"
  | "not_found"
  | "notification_missing";
const FINALIZE_ACCEPTED_OUTCOMES: ReadonlySet<string> = new Set<FinalizeAcceptedOutcome>([
  "accepted",
  "accepted_idempotent",
  "conflict_pmid",
  "conflict_state",
  "state_changed",
  "not_found",
  "notification_missing",
]);

export type FinalizeRejectedOutcome =
  | "rejected"
  | "rejected_idempotent"
  | "state_changed"
  | "not_found";
const FINALIZE_REJECTED_OUTCOMES: ReadonlySet<string> = new Set<FinalizeRejectedOutcome>([
  "rejected",
  "rejected_idempotent",
  "state_changed",
  "not_found",
]);

export type FinalizeAmbiguousOutcome =
  | "ambiguous"
  | "ambiguous_idempotent"
  | "state_changed"
  | "not_found";
const FINALIZE_AMBIGUOUS_OUTCOMES: ReadonlySet<string> = new Set<FinalizeAmbiguousOutcome>([
  "ambiguous",
  "ambiguous_idempotent",
  "state_changed",
  "not_found",
]);

export type ReconcileOutcome =
  | "reconciled"
  | "unmatched"
  | "notification_missing"
  | "conflict_pmid"
  | "conflict_state";
const RECONCILE_OUTCOMES: ReadonlySet<string> = new Set<ReconcileOutcome>([
  "reconciled",
  "unmatched",
  "notification_missing",
  "conflict_pmid",
  "conflict_state",
]);

export type RecoverOutcome =
  | "not_found"
  | "noop"
  | "lease_valid"
  | "recovered_without_attempt"
  | "planned_cancelled"
  | "sending_ambiguous"
  | "ambiguous_quarantined"
  | "accepted_repaired"
  | "rejected_preserved"
  | "cancelled_repending";
const RECOVER_OUTCOMES: ReadonlySet<string> = new Set<RecoverOutcome>([
  "not_found",
  "noop",
  "lease_valid",
  "recovered_without_attempt",
  "planned_cancelled",
  "sending_ambiguous",
  "ambiguous_quarantined",
  "accepted_repaired",
  "rejected_preserved",
  "cancelled_repending",
]);

export type WrapperResult<T extends string> =
  | { ok: true; outcome: T; attemptId?: string | null; notificationId?: string | null }
  | { ok: false; reason: "invalid_input" | "database_error" | "unknown_outcome"; detail?: string };

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de log estruturado (sem PII).

function logStructured(entry: Record<string, unknown>): void {
  try {
    console.log(JSON.stringify({ module: "wa-notif-attempts-d2a", ...entry }));
  } catch {
    // no-op
  }
}

function maskId(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.slice(0, 8) + "…";
}

// ─────────────────────────────────────────────────────────────────────────────
// Wrapper: accepted

export interface FinalizeAcceptedInput {
  attemptId: string;
  attemptToken: string;
  providerMessageId: string;
  httpStatus: number;
  finishedAt?: string; // ISO
}

export async function finalizeAttemptAccepted(
  input: FinalizeAcceptedInput,
  clientOverride?: SupabaseLike,
): Promise<WrapperResult<FinalizeAcceptedOutcome>> {
  if (!isUuid(input.attemptId) || !isUuid(input.attemptToken)) {
    return { ok: false, reason: "invalid_input", detail: "attempt_ids" };
  }
  if (!isCleanText(input.providerMessageId, MAX_PMID)) {
    return { ok: false, reason: "invalid_input", detail: "provider_message_id" };
  }
  if (!Number.isInteger(input.httpStatus) || input.httpStatus < 200 || input.httpStatus > 299) {
    return { ok: false, reason: "invalid_input", detail: "http_status" };
  }
  if (input.finishedAt != null && Number.isNaN(Date.parse(input.finishedAt))) {
    return { ok: false, reason: "invalid_input", detail: "finished_at" };
  }

  const c = (clientOverride ?? (await admin())) as unknown as {
    rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  };
  try {
    const rpc = await c.rpc("whatsapp_attempt_finalize_accepted_atomic", {
      p_attempt_id: input.attemptId,
      p_attempt_token: input.attemptToken,
      p_provider_message_id: input.providerMessageId,
      p_http_status: input.httpStatus,
      p_finished_at: input.finishedAt ?? new Date().toISOString(),
    });
    if (rpc.error) return { ok: false, reason: "database_error" };
    const outcome = extractOutcome(rpc.data);
    if (!outcome || !FINALIZE_ACCEPTED_OUTCOMES.has(outcome)) {
      logStructured({ event: "attempt_finalize_accepted_unknown_outcome", attempt_id: maskId(input.attemptId) });
      return { ok: false, reason: "unknown_outcome" };
    }
    logStructured({
      event: outcome === "accepted" || outcome === "accepted_idempotent"
        ? "attempt_finalize_accepted"
        : `attempt_finalize_${outcome}`,
      attempt_id: maskId(input.attemptId),
      http_status: input.httpStatus,
    });
    return { ok: true, outcome: outcome as FinalizeAcceptedOutcome };
  } catch {
    return { ok: false, reason: "database_error" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wrapper: rejected

export interface FinalizeRejectedInput {
  attemptId: string;
  attemptToken: string;
  httpStatus: number;
  errorCode: string;
  errorCategory: string;
  retryable: boolean;
  finishedAt?: string;
}

export async function finalizeAttemptRejected(
  input: FinalizeRejectedInput,
  clientOverride?: SupabaseLike,
): Promise<WrapperResult<FinalizeRejectedOutcome>> {
  if (!isUuid(input.attemptId) || !isUuid(input.attemptToken)) {
    return { ok: false, reason: "invalid_input", detail: "attempt_ids" };
  }
  if (!Number.isInteger(input.httpStatus) || input.httpStatus < 0 || input.httpStatus > 999) {
    return { ok: false, reason: "invalid_input", detail: "http_status" };
  }
  if (typeof input.retryable !== "boolean") {
    return { ok: false, reason: "invalid_input", detail: "retryable" };
  }
  const errCode = sanitize(input.errorCode, MAX_ERROR_CODE);
  const errCat = sanitize(input.errorCategory, MAX_ERROR_CATEGORY) || "rejected";

  const c = (clientOverride ?? (await admin())) as unknown as {
    rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  };
  try {
    const rpc = await c.rpc("whatsapp_attempt_finalize_rejected_atomic", {
      p_attempt_id: input.attemptId,
      p_attempt_token: input.attemptToken,
      p_http_status: input.httpStatus,
      p_error_code: errCode,
      p_error_category: errCat,
      p_retryable: input.retryable,
      p_finished_at: input.finishedAt ?? new Date().toISOString(),
    });
    if (rpc.error) return { ok: false, reason: "database_error" };
    const outcome = extractOutcome(rpc.data);
    if (!outcome || !FINALIZE_REJECTED_OUTCOMES.has(outcome)) {
      logStructured({ event: "attempt_finalize_rejected_unknown_outcome", attempt_id: maskId(input.attemptId) });
      return { ok: false, reason: "unknown_outcome" };
    }
    logStructured({
      event: outcome === "rejected" || outcome === "rejected_idempotent"
        ? "attempt_finalize_rejected"
        : `attempt_finalize_${outcome}`,
      attempt_id: maskId(input.attemptId),
      http_status: input.httpStatus,
      error_category: errCat,
      retryable: input.retryable,
    });
    return { ok: true, outcome: outcome as FinalizeRejectedOutcome };
  } catch {
    return { ok: false, reason: "database_error" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wrapper: ambiguous

export interface FinalizeAmbiguousInput {
  attemptId: string;
  attemptToken: string;
  errorCode: string;
  httpStatus?: number;
  finishedAt?: string;
}

export async function finalizeAttemptAmbiguous(
  input: FinalizeAmbiguousInput,
  clientOverride?: SupabaseLike,
): Promise<WrapperResult<FinalizeAmbiguousOutcome>> {
  if (!isUuid(input.attemptId) || !isUuid(input.attemptToken)) {
    return { ok: false, reason: "invalid_input", detail: "attempt_ids" };
  }
  const errCode = sanitize(input.errorCode, MAX_ERROR_CODE) || "send_ambiguous";
  const httpStatus = input.httpStatus == null ? 0 : input.httpStatus;
  if (!Number.isInteger(httpStatus) || httpStatus < 0 || httpStatus > 999) {
    return { ok: false, reason: "invalid_input", detail: "http_status" };
  }

  const c = (clientOverride ?? (await admin())) as unknown as {
    rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  };
  try {
    const rpc = await c.rpc("whatsapp_attempt_finalize_ambiguous_atomic", {
      p_attempt_id: input.attemptId,
      p_attempt_token: input.attemptToken,
      p_error_code: errCode,
      p_http_status: httpStatus,
      p_finished_at: input.finishedAt ?? new Date().toISOString(),
    });
    if (rpc.error) return { ok: false, reason: "database_error" };
    const outcome = extractOutcome(rpc.data);
    if (!outcome || !FINALIZE_AMBIGUOUS_OUTCOMES.has(outcome)) {
      logStructured({ event: "attempt_finalize_ambiguous_unknown_outcome", attempt_id: maskId(input.attemptId) });
      return { ok: false, reason: "unknown_outcome" };
    }
    logStructured({
      event: outcome === "ambiguous" || outcome === "ambiguous_idempotent"
        ? "attempt_finalize_ambiguous"
        : `attempt_finalize_${outcome}`,
      attempt_id: maskId(input.attemptId),
      error_code: errCode,
    });
    return { ok: true, outcome: outcome as FinalizeAmbiguousOutcome };
  } catch {
    return { ok: false, reason: "database_error" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wrapper: reconcile callback

export interface ReconcileCallbackInput {
  providerMessageId: string;
  eventStatus: "sent" | "delivered" | "read" | "failed";
  clientReference?: string | null;
  eventAt?: string;
}

export async function reconcileAttemptFromCallback(
  input: ReconcileCallbackInput,
  clientOverride?: SupabaseLike,
): Promise<WrapperResult<ReconcileOutcome>> {
  if (!isCleanText(input.providerMessageId, MAX_PMID)) {
    return { ok: false, reason: "invalid_input", detail: "provider_message_id" };
  }
  const allowed = ["sent", "delivered", "read", "failed"] as const;
  if (!allowed.includes(input.eventStatus)) {
    return { ok: false, reason: "invalid_input", detail: "event_status" };
  }
  const cref =
    typeof input.clientReference === "string" && isCleanText(input.clientReference, MAX_PMID)
      ? input.clientReference
      : "";

  const c = (clientOverride ?? (await admin())) as unknown as {
    rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  };
  try {
    const rpc = await c.rpc("whatsapp_attempt_reconcile_callback_atomic", {
      p_client_reference: cref,
      p_provider_message_id: input.providerMessageId,
      p_event_status: input.eventStatus,
      p_event_at: input.eventAt ?? new Date().toISOString(),
    });
    if (rpc.error) return { ok: false, reason: "database_error" };
    const rows = Array.isArray(rpc.data) ? rpc.data : rpc.data ? [rpc.data] : [];
    const first = (rows[0] ?? {}) as { outcome?: string; attempt_id?: string | null; notification_id?: string | null };
    const outcome = typeof first.outcome === "string" ? first.outcome : null;
    if (!outcome || !RECONCILE_OUTCOMES.has(outcome)) {
      logStructured({ event: "callback_attempt_unknown_outcome" });
      return { ok: false, reason: "unknown_outcome" };
    }
    const eventNameMap: Record<ReconcileOutcome, string> = {
      reconciled: "callback_attempt_reconciled",
      unmatched: "callback_attempt_unmatched",
      notification_missing: "callback_attempt_anomaly",
      conflict_pmid: "callback_attempt_conflict",
      conflict_state: "callback_attempt_conflict",
    };
    logStructured({
      event: eventNameMap[outcome as ReconcileOutcome],
      attempt_id: maskId(first.attempt_id ?? null),
      notification_id: maskId(first.notification_id ?? null),
      event_status: input.eventStatus,
    });
    return {
      ok: true,
      outcome: outcome as ReconcileOutcome,
      attemptId: first.attempt_id ?? null,
      notificationId: first.notification_id ?? null,
    };
  } catch {
    return { ok: false, reason: "database_error" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wrapper: recovery consciente

export interface RecoverWithAttemptInput {
  notificationId: string;
  now?: string;
  backoffInterval?: string; // Postgres interval literal, ex.: '00:05:00'
}

export async function recoverNotificationWithAttempt(
  input: RecoverWithAttemptInput,
  clientOverride?: SupabaseLike,
): Promise<WrapperResult<RecoverOutcome>> {
  if (!isUuid(input.notificationId)) {
    return { ok: false, reason: "invalid_input", detail: "notification_id" };
  }
  const backoff = typeof input.backoffInterval === "string" && input.backoffInterval.length <= 32
    ? input.backoffInterval
    : "00:05:00";

  const c = (clientOverride ?? (await admin())) as unknown as {
    rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  };
  try {
    const rpc = await c.rpc("whatsapp_notification_recover_with_attempt_atomic", {
      p_notification_id: input.notificationId,
      p_now: input.now ?? new Date().toISOString(),
      p_backoff: backoff,
    });
    if (rpc.error) return { ok: false, reason: "database_error" };
    const outcome = extractOutcome(rpc.data);
    if (!outcome || !RECOVER_OUTCOMES.has(outcome)) {
      logStructured({ event: "recovery_unknown_outcome", notification_id: maskId(input.notificationId) });
      return { ok: false, reason: "unknown_outcome" };
    }
    const eventNameMap: Record<RecoverOutcome, string> = {
      not_found: "recovery_not_found",
      noop: "recovery_noop",
      lease_valid: "recovery_lease_valid",
      recovered_without_attempt: "recovery_without_attempt",
      planned_cancelled: "recovery_planned_cancelled",
      sending_ambiguous: "recovery_sending_ambiguous",
      ambiguous_quarantined: "recovery_ambiguous_quarantined",
      accepted_repaired: "recovery_accepted_repaired",
      rejected_preserved: "recovery_rejected_preserved",
      cancelled_repending: "recovery_cancelled_requeued",
    };
    logStructured({
      event: eventNameMap[outcome as RecoverOutcome],
      notification_id: maskId(input.notificationId),
    });
    return { ok: true, outcome: outcome as RecoverOutcome };
  } catch {
    return { ok: false, reason: "database_error" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitário: extrai `outcome` do retorno da RPC (RETURNS TABLE(outcome text)).

function extractOutcome(data: unknown): string | null {
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const first = rows[0] as { outcome?: unknown } | undefined;
  if (!first || typeof first.outcome !== "string") return null;
  return first.outcome;
}
