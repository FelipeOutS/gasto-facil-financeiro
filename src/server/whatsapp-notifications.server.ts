/**
 * WA-C8 — Infraestrutura de notificações outbound do WhatsApp.
 * WA-C9.2 Fase B — Lease temporário + token de ownership + recuperação.
 *
 * Camada server-side reutilizável: enfileirar, deduplicar, claim atômico com
 * ownership token, marcar resultado, renovar lease, recuperar processing preso
 * e cancelar. Não envia mensagens reais; envio real fica para etapa futura,
 * atrás da flag `WHATSAPP_DISPATCH_ENABLED`.
 *
 * Regras de logging/PII (consistentes com WA-C7.x):
 *  - Nunca persistir nem logar: texto pronto, telefone, Pix, CPF/CNPJ,
 *    descrição completa, nome de favorecido.
 *  - `payload` é JSONB estruturado (IDs, valores em centavos, datas). O texto
 *    final é renderizado pelo dispatcher a partir do template em tempo de envio.
 *
 * ── Máquina de estados (Fase B — ownership estrito) ───────────────────────
 *
 *   pending ──claim──▶ processing (grava claim_token, claimed_at, lease_expires_at)
 *
 *   Caminho WORKER (exige claim_token não-vazio + status='processing'):
 *     processing ──markSent(token)──▶ sent
 *     processing ──markFailed(token, retry)──▶ pending  (next_attempt_at=backoff)
 *     processing ──markFailed(token, terminal)──▶ failed
 *     processing ──markSkipped(token)──▶ skipped
 *     processing ──rescheduleForQuietHours(token)──▶ pending (scheduled_at futuro)
 *     processing ──recoverStuckReschedule(token)──▶ pending
 *     processing ──revertProcessingToPending(token)──▶ pending
 *     processing ──renewProcessingLease(token)──▶ processing (só estende lease)
 *
 *   Caminho ADMINISTRATIVO (claimToken=null):
 *     markFailed / markSkipped com token=null NUNCA tocam processing:
 *       admin path só atua sobre status='pending'.
 *     Reservado a fluxos onde não houve claim (ex.: falha síncrona ao enqueuar,
 *     invalidação da entidade antes do dispatch).
 *
 *   Caminho RECOVERY (sem token do worker, mas atômico):
 *     processing (lease vencido) ──recoverStuckProcessing──▶ pending
 *       (filtra por claim_token original + lease_expires_at<=now; race-safe)
 *
 *   Caminho CANCELAMENTO EXTERNO (cancelByDedupe/cancelByEntity):
 *     opera SOMENTE sobre status='pending'; nunca toca processing.
 *
 *   Todas as saídas de processing limpam (claim_token, claimed_at, lease_expires_at).
 *   Estados terminais (sent, failed, cancelled, skipped) NUNCA são reabertos.
 */
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type NotificationCategory =
  | "contas_a_pagar"
  | "recorrencias"
  | "metas"
  | "orcamento"
  | "ia_insights"
  | "mercado"
  | "avisos_sistema";

export type NotificationStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "cancelled"
  | "skipped";

export type NotificationPriority = "baixa" | "media" | "alta" | "critica";

export type SkippedReason =
  | "channel_revoked"
  | "channel_not_optedin"
  | "category_opt_out"
  | "quiet_hours"
  | "no_session_window"
  | "template_missing"
  | "user_disabled"
  // WA-C9.1 — motivos de invalidação da entidade vinculada (contas a pagar).
  | "payable_paid"
  | "payable_cancelled"
  | "payable_changed"
  | "payable_not_found"
  // WA-C11 Fase 1 — entitlement revogado entre criação e envio (downgrade,
  // cancelamento, expiração, beta revogado, link/opt-in perdido).
  | "entitlement_revoked";

export interface EnqueueInput {
  userId: string;
  type: string; // = templates.key
  category: NotificationCategory;
  scheduledAt: Date;
  dedupeKey: string;
  payload?: Record<string, unknown>;
  priority?: NotificationPriority;
  entityType?: string | null;
  entityId?: string | null;
  payloadVersion?: number;
  maxAttempts?: number;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  notification_type: string;
  category: NotificationCategory;
  status: NotificationStatus;
  priority: NotificationPriority;
  scheduled_at: string;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | null;
  payload: Record<string, unknown>;
  payload_version: number;
  dedupe_key: string;
  entity_type: string | null;
  entity_id: string | null;
  sent_at: string | null;
  failed_at: string | null;
  cancelled_at: string | null;
  skipped_reason: string | null;
  provider_message_id: string | null;
  last_error_code: string | null;
  // WA-C9.2 Fase B — Ownership / lease.
  claimed_at: string | null;
  lease_expires_at: string | null;
  claim_token: string | null;
}

const BACKOFF_MINUTES = [1, 5, 30, 120, 720]; // 1m, 5m, 30m, 2h, 12h

/** WA-C9.2 Fase B — Duração inicial do lease de processamento (10 min). */
export const LEASE_DURATION_MS = 10 * 60_000;

/** WA-C9.2 Fase B — Backoff aplicado quando recovery devolve para pending (5 min). */
export const RECOVERY_BACKOFF_MS = 5 * 60_000;

function backoffFor(attempt: number): Date {
  const idx = Math.min(Math.max(attempt, 0), BACKOFF_MINUTES.length - 1);
  return new Date(Date.now() + BACKOFF_MINUTES[idx] * 60_000);
}

export interface NotificationsDeps {
  client?: typeof supabaseAdmin;
  now?: () => Date;
  /** Injeção para testes de concorrência / determinismo. */
  randomUUID?: () => string;
  /**
   * D.2A HARDENING — opt-in EXPLÍCITO para testes de Fase B que usam fakes
   * sem `.rpc`. Nunca setado em produção. Nunca inferido do runtime. Nunca
   * lido de env. Default false ⇒ ausência de `.rpc` é fail-closed.
   */
  allowLegacyFakePath?: boolean;
}

function client(deps?: NotificationsDeps) {
  return deps?.client ?? supabaseAdmin;
}

function nowOf(deps?: NotificationsDeps): Date {
  return deps?.now?.() ?? new Date();
}

function newToken(deps?: NotificationsDeps): string {
  return deps?.randomUUID?.() ?? randomUUID();
}

/**
 * Enfileira uma notificação. Idempotente por (user_id, dedupe_key).
 * Retorna a linha existente ou recém-criada (ou null em falha não-recuperável).
 *
 * Autorização por plano/beta é feita nos call-sites (ex.: contas-lembretes)
 * via `getWhatsAppEntitlement`. O dispatcher revalida no envio como defesa
 * em profundidade.
 */
export async function enqueueNotification(
  input: EnqueueInput,
  deps?: NotificationsDeps,
): Promise<NotificationRow | null> {
  const c = client(deps);



  const row = {
    user_id: input.userId,
    notification_type: input.type,
    category: input.category,
    scheduled_at: input.scheduledAt.toISOString(),
    dedupe_key: input.dedupeKey,
    payload: input.payload ?? {},
    payload_version: input.payloadVersion ?? 1,
    priority: input.priority ?? "media",
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    max_attempts: input.maxAttempts ?? 5,
    status: "pending" as NotificationStatus,
  };

  const { error } = await c
    .from("whatsapp_notifications")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .upsert(row as any, {
      onConflict: "user_id,dedupe_key",
      ignoreDuplicates: true,
    });
  if (error) {
    console.error("[wa-notif] enqueue failed", error.code, error.message);
    return null;
  }

  const { data } = await c
    .from("whatsapp_notifications")
    .select("*")
    .eq("user_id", input.userId)
    .eq("dedupe_key", input.dedupeKey)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any) ?? null;
}

/**
 * WA-C9.2 Fase A — Contrato de elegibilidade unificado.
 *
 * Uma notificação SÓ é elegível para dispatch quando:
 *   status = 'pending'
 *   AND scheduled_at <= now
 *   AND (next_attempt_at IS NULL OR next_attempt_at <= now)
 *
 * WA-C9.2 Fase B — Claim atômico agora grava também:
 *   claim_token = novo UUID
 *   claimed_at = now
 *   lease_expires_at = now + LEASE_DURATION_MS
 *
 * O claim não incrementa attempt_count, preserva dedupe_key, scheduled_at,
 * next_attempt_at, payload, created_at.
 */
export async function claimForProcessing(
  id: string,
  deps?: NotificationsDeps,
): Promise<NotificationRow | null> {
  const c = client(deps);
  const now = nowOf(deps);
  const nowIso = now.toISOString();
  const token = newToken(deps);
  const leaseIso = new Date(now.getTime() + LEASE_DURATION_MS).toISOString();
  const { data, error } = await c
    .from("whatsapp_notifications")
    .update({
      status: "processing",
      claim_token: token,
      claimed_at: nowIso,
      lease_expires_at: leaseIso,
    })
    .eq("id", id)
    .eq("status", "pending")
    .lte("scheduled_at", nowIso)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .select("*")
    .maybeSingle();
  if (error) {
    console.error("[wa-notif] claim failed", (error as { code?: string }).code);
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any) ?? null;
}

/**
 * Lista pendentes elegíveis (não muda status). Ordena por scheduled_at ASC —
 * servido pelo índice parcial `idx_wa_notif_due`.
 */
export async function listDuePending(
  limit = 50,
  deps?: NotificationsDeps,
): Promise<NotificationRow[]> {
  const c = client(deps);
  const now = nowOf(deps).toISOString();
  const { data, error } = await c
    .from("whatsapp_notifications")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (error) {
    console.error("[wa-notif] listDue failed", error.code);
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any) ?? [];
}

/**
 * Campos de claim limpos em toda transição que sai de `processing`.
 */
const CLAIM_CLEAR = {
  claim_token: null as string | null,
  claimed_at: null as string | null,
  lease_expires_at: null as string | null,
};

/**
 * Validador de token de ownership. Aceita apenas string não-vazia (trim).
 * `undefined`, `null`, `""` ou whitespace-only → false.
 */
function isValidClaimToken(t: unknown): t is string {
  return typeof t === "string" && t.trim().length > 0;
}

/**
 * WA-C9.2 Fase B — Marca como `sent`.
 * WORKER-ONLY: exige `claimToken` string não-vazia + `status='processing'` +
 * match exato em `claim_token`. Limpa campos de claim. Retorna `true` se
 * exatamente 1 linha foi atualizada; `false` em race / token inválido /
 * estado terminal (não reabre nada).
 */
export async function markSent(
  id: string,
  providerMessageId: string,
  claimToken: string,
  deps?: NotificationsDeps,
): Promise<boolean> {
  if (!isValidClaimToken(claimToken)) return false;
  const c = client(deps);
  const { data } = await c
    .from("whatsapp_notifications")
    .update({
      status: "sent",
      sent_at: nowOf(deps).toISOString(),
      provider_message_id: providerMessageId,
      ...CLAIM_CLEAR,
    })
    .eq("id", id)
    .eq("status", "processing")
    .eq("claim_token", claimToken)
    .select("id");
  return (data ?? []).length > 0;
}

/**
 * WA-C9.2 Fase B — Marca como `skipped`.
 * Dois caminhos discriminados por `claimToken`:
 *  - WORKER (token string não-vazia): exige `status='processing'` + ownership.
 *  - ADMIN (token=null): opera SOMENTE sobre `status='pending'`. NUNCA toca
 *    processing/terminal. Reservado para invalidações pré-claim.
 * Em ambos limpa campos de claim (defesa em profundidade).
 */
export async function markSkipped(
  id: string,
  reason: SkippedReason,
  claimToken: string | null,
  deps?: NotificationsDeps,
): Promise<boolean> {
  const c = client(deps);
  const base = c
    .from("whatsapp_notifications")
    .update({
      status: "skipped",
      skipped_reason: reason,
      ...CLAIM_CLEAR,
    })
    .eq("id", id);
  if (claimToken === null) {
    // Admin path — só toca pending; nunca reabre processing/terminal.
    const { data } = await base.eq("status", "pending").select("id");
    return (data ?? []).length > 0;
  }
  if (!isValidClaimToken(claimToken)) return false;
  const { data } = await base
    .eq("status", "processing")
    .eq("claim_token", claimToken)
    .select("id");
  return (data ?? []).length > 0;
}

/**
 * WA-C9.2 Fase B — Marca falha (com retry ou terminal).
 * Dois caminhos discriminados por `claimToken`:
 *  - WORKER (token string não-vazia): exige `status='processing'` + ownership.
 *  - ADMIN (token=null): opera SOMENTE sobre `status='pending'`. NUNCA toca
 *    processing nem reabre terminal.
 * Sempre limpa campos de claim.
 */
export async function markFailed(
  id: string,
  errorCode: string,
  options: { retryable: boolean; currentAttempt: number; maxAttempts: number },
  claimToken: string | null,
  deps?: NotificationsDeps,
): Promise<{ scheduledRetry: boolean; updated: boolean }> {
  const c = client(deps);
  const nextAttempt = options.currentAttempt + 1;
  const canRetry = options.retryable && nextAttempt < options.maxAttempts;
  const patch: Record<string, unknown> = {
    last_error_code: errorCode,
    attempt_count: nextAttempt,
    ...CLAIM_CLEAR,
  };
  if (canRetry) {
    patch.status = "pending";
    patch.next_attempt_at = backoffFor(nextAttempt - 1).toISOString();
  } else {
    patch.status = "failed";
    patch.failed_at = nowOf(deps).toISOString();
  }
  const base = c
    .from("whatsapp_notifications")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(patch as any)
    .eq("id", id);
  let q;
  if (claimToken === null) {
    // Admin path — só toca pending. Não altera processing nem terminal.
    q = base.eq("status", "pending");
  } else {
    if (!isValidClaimToken(claimToken)) {
      return { scheduledRetry: canRetry, updated: false };
    }
    q = base.eq("status", "processing").eq("claim_token", claimToken);
  }
  const { data } = await q.select("id");
  return { scheduledRetry: canRetry, updated: (data ?? []).length > 0 };
}

/**
 * WA-C8.1 — Resultado do reagendamento por quiet hours.
 */
export type QuietHoursRescheduleResult =
  | { ok: true; status: "rescheduled" }
  | { ok: false; status: "state_changed" }
  | { ok: false; status: "error"; error: unknown };

/**
 * WA-C8.1 + WA-C9.2 Fase B — Reagendamento seguro para quiet hours.
 * WORKER-ONLY: exige `claimToken` string não-vazia + `status='processing'` +
 * ownership. Sem caminho administrativo com null. Limpa campos de claim ao
 * voltar para pending com `scheduled_at=nextAllowedAt`, `next_attempt_at=null`.
 */
export async function rescheduleForQuietHours(
  id: string,
  nextAllowedAt: Date,
  claimToken: string,
  deps?: NotificationsDeps,
): Promise<QuietHoursRescheduleResult> {
  if (!isValidClaimToken(claimToken)) {
    return { ok: false, status: "state_changed" };
  }
  const c = client(deps);
  try {
    const { data, error } = await c
      .from("whatsapp_notifications")
      .update({
        status: "pending",
        scheduled_at: nextAllowedAt.toISOString(),
        next_attempt_at: null,
        skipped_reason: null,
        ...CLAIM_CLEAR,
      })
      .eq("id", id)
      .eq("status", "processing")
      .eq("claim_token", claimToken)
      .select("id");
    if (error) {
      console.error(
        "[wa-notif] reschedule quiet_hours db_error",
        JSON.stringify({ id, code: (error as { code?: string }).code ?? null }),
      );
      return { ok: false, status: "error", error };
    }
    if ((data ?? []).length > 0) {
      return { ok: true, status: "rescheduled" };
    }
    return { ok: false, status: "state_changed" };
  } catch (err) {
    console.error("[wa-notif] reschedule quiet_hours threw", JSON.stringify({ id }));
    return { ok: false, status: "error", error: err };
  }
}

/**
 * WA-C8.1 — Recuperação conservadora após falha do UPDATE inicial de quiet
 * hours. Semanticamente idêntica; token de ownership obrigatório.
 * Papel distinto de `recoverStuckProcessing` (lease geral expirado).
 */
export async function recoverStuckReschedule(
  id: string,
  nextAllowedAt: Date,
  claimToken: string,
  deps?: NotificationsDeps,
): Promise<QuietHoursRescheduleResult> {
  return rescheduleForQuietHours(id, nextAllowedAt, claimToken, deps);
}

/**
 * WA-C9.2 Fase B — Reverte processing → pending como dry-run.
 * WORKER-ONLY: exige ownership por `claimToken` não-vazio. Preserva
 * scheduled_at, next_attempt_at, attempt_count, dedupe_key. Limpa claim.
 */
export async function revertProcessingToPending(
  id: string,
  claimToken: string,
  deps?: NotificationsDeps,
): Promise<boolean> {
  if (!isValidClaimToken(claimToken)) return false;
  const c = client(deps);
  const { data } = await c
    .from("whatsapp_notifications")
    .update({ status: "pending", ...CLAIM_CLEAR })
    .eq("id", id)
    .eq("status", "processing")
    .eq("claim_token", claimToken)
    .select("id");
  return (data ?? []).length > 0;
}

/**
 * WA-C9.2 Fase B — Renova o lease de uma notificação em processing.
 * WORKER-ONLY: exige ownership por `claimToken` não-vazio. Só atualiza
 * `lease_expires_at`. Retorna `true` se renovado; `false` se estado terminal,
 * token errado, ou lease já recuperado por outro worker.
 */
export async function renewProcessingLease(
  id: string,
  claimToken: string,
  deps?: NotificationsDeps,
): Promise<boolean> {
  if (!isValidClaimToken(claimToken)) return false;
  const c = client(deps);
  const nextLease = new Date(nowOf(deps).getTime() + LEASE_DURATION_MS).toISOString();
  const { data } = await c
    .from("whatsapp_notifications")
    .update({ lease_expires_at: nextLease })
    .eq("id", id)
    .eq("status", "processing")
    .eq("claim_token", claimToken)
    .select("id");
  return (data ?? []).length > 0;
}

export interface RecoverStuckProcessingSummary {
  recovered: number;
  state_changed: number;
  errors: number;
}

/**
 * WA-C9.2 Fase B — Recupera notificações presas em `status='processing'`
 * com lease vencido.
 *
 * Fluxo:
 *  1. seleciona até `limit` linhas com status='processing' e
 *     lease_expires_at <= now, ordenadas por lease_expires_at ASC;
 *  2. para cada, executa UPDATE atômico filtrando por id + status='processing'
 *     + claim_token original + lease_expires_at <= now. Race-safe:
 *      - se worker renovou → filtro falha, nada muda;
 *      - se outro recovery já pegou → claim_token não bate, nada muda;
 *      - se transicionou para sent/failed/skipped/cancelled → status não bate.
 *
 * Efeitos por linha recuperada:
 *   status = pending
 *   next_attempt_at = now + RECOVERY_BACKOFF_MS (5 min)
 *   last_error_code = 'processing_timeout'
 *   claim_token, claimed_at, lease_expires_at → NULL
 *   skipped_reason → NULL
 *   attempt_count PRESERVADO (lease expirado não comprova chamada real Meta)
 *
 * Erros de linha individual não derrubam o lote. Erro global de seleção
 * incrementa `errors` e retorna resumo.
 */
export async function recoverStuckProcessing(
  limit = 50,
  deps?: NotificationsDeps,
): Promise<RecoverStuckProcessingSummary> {
  const c = client(deps);
  const now = nowOf(deps);
  const nowIso = now.toISOString();
  const summary: RecoverStuckProcessingSummary = {
    recovered: 0,
    state_changed: 0,
    errors: 0,
  };

  // 1) Seleciona candidatos por lease vencido.
  //    (Legacy path filtra por claim_token; RPC path apenas por id.)
  const { data: candidates, error: selErr } = await c
    .from("whatsapp_notifications")
    .select("id, claim_token")
    .eq("status", "processing")
    .lte("lease_expires_at", nowIso)
    .order("lease_expires_at", { ascending: true })
    .limit(limit);
  if (selErr) {
    console.error(
      "[wa-notif] recoverStuckProcessing select_failed",
      JSON.stringify({ code: (selErr as { code?: string }).code ?? null }),
    );
    summary.errors++;
    return summary;
  }

  const list = (candidates ?? []) as Array<{ id: string; claim_token: string | null }>;
  if (list.length === 0) return summary;

  // 2) Preferência: RPC consciente de attempts
  //    (`whatsapp_notification_recover_with_attempt_atomic`).
  //    D.2A HARDENING: em produção `supabaseAdmin.rpc` SEMPRE existe. A
  //    ausência de `.rpc` é erro de infraestrutura, NUNCA sinal de downgrade.
  //    O caminho legado (UPDATE) só é acionado quando o teste passa
  //    `allowLegacyFakePath: true` EXPLICITAMENTE. Sem esse opt-in explícito,
  //    a ausência de `.rpc` retorna erro discriminado sem tocar em linhas.
  const hasRpc = typeof (c as unknown as { rpc?: unknown }).rpc === "function";
  const allowLegacy = deps?.allowLegacyFakePath === true;
  if (!hasRpc && !allowLegacy) {
    console.error(
      "[wa-notif] recoverStuckProcessing rpc_unavailable",
      JSON.stringify({
        detail: "supabase client missing .rpc and no explicit legacy opt-in",
        candidates: list.length,
      }),
    );
    summary.errors++;
    return summary;
  }
  if (hasRpc) {
    const attemptsMod = await import(
      "@/server/whatsapp-notification-attempts.server"
    );
    const outcomesRepairedOrRequeued: ReadonlySet<string> = new Set([
      "recovered_without_attempt",
      "accepted_repaired",
      "cancelled_repending",
      "planned_cancelled",
    ]);
    const outcomesStateChangedNoop: ReadonlySet<string> = new Set([
      "noop",
      "lease_valid",
      "rejected_preserved",
      "sending_ambiguous",
      "not_found",
      // E.4C: ambiguous não reconciliada NÃO é retentável — guarda atômica na RPC.
      "ambiguous_skipped",
      // Retrocompatibilidade: quarentena legacy também é noop na contabilidade.
      "ambiguous_quarantined",
    ]);
    for (const row of list) {
      try {
        const rr = await attemptsMod.recoverNotificationWithAttempt(
          {
            notificationId: row.id,
            now: nowIso,
            backoffInterval: "00:05:00",
          },
          c as unknown as import("@/server/whatsapp-outbound-adapter.server").SupabaseLike,
        );
        if (!rr.ok) {
          summary.errors++;
          continue;
        }
        if (outcomesRepairedOrRequeued.has(rr.outcome)) {
          summary.recovered++;
        } else if (outcomesStateChangedNoop.has(rr.outcome)) {
          summary.state_changed++;
        } else {
          summary.state_changed++;
        }
      } catch (err) {
        summary.errors++;
        console.error(
          "[wa-notif] recoverStuckProcessing row_threw",
          JSON.stringify({ id: row.id }),
        );
        void err;
      }
    }
    return summary;
  }

  // 3) Legacy fallback (Fase B) — SOMENTE quando `allowLegacyFakePath: true`
  //    é passado explicitamente pelo teste. Nunca ativado em produção.
  const nextAttemptIso = new Date(now.getTime() + RECOVERY_BACKOFF_MS).toISOString();
  for (const row of list) {
    try {
      let q = c
        .from("whatsapp_notifications")
        .update({
          status: "pending",
          next_attempt_at: nextAttemptIso,
          last_error_code: "processing_timeout",
          skipped_reason: null,
          ...CLAIM_CLEAR,
        })
        .eq("id", row.id)
        .eq("status", "processing")
        .lte("lease_expires_at", nowIso);
      if (row.claim_token != null) {
        q = q.eq("claim_token", row.claim_token);
      } else {
        summary.state_changed++;
        continue;
      }
      const { data, error } = await q.select("id");
      if (error) {
        summary.errors++;
        console.error(
          "[wa-notif] recoverStuckProcessing row_failed",
          JSON.stringify({ id: row.id, code: (error as { code?: string }).code ?? null }),
        );
        continue;
      }
      if ((data ?? []).length > 0) {
        summary.recovered++;
      } else {
        summary.state_changed++;
      }
    } catch (err) {
      summary.errors++;
      console.error(
        "[wa-notif] recoverStuckProcessing row_threw",
        JSON.stringify({ id: row.id }),
      );
      void err;
    }
  }
  return summary;
}


/** Cancela por dedupe (operação externa; toca apenas linhas `pending`). */
export async function cancelByDedupe(
  userId: string,
  dedupeKey: string,
  deps?: NotificationsDeps,
): Promise<number> {
  const c = client(deps);
  const { data } = await c
    .from("whatsapp_notifications")
    .update({ status: "cancelled", cancelled_at: nowOf(deps).toISOString(), ...CLAIM_CLEAR })
    .eq("user_id", userId)
    .eq("dedupe_key", dedupeKey)
    .in("status", ["pending"])
    .select("id");
  return (data ?? []).length;
}

export async function cancelByEntity(
  userId: string,
  entityType: string,
  entityId: string,
  deps?: NotificationsDeps,
): Promise<number> {
  const c = client(deps);
  const { data } = await c
    .from("whatsapp_notifications")
    .update({ status: "cancelled", cancelled_at: nowOf(deps).toISOString(), ...CLAIM_CLEAR })
    .eq("user_id", userId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .in("status", ["pending"])
    .select("id");
  return (data ?? []).length;
}
