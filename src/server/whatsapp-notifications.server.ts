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
 * ── Máquina de estados (Fase B) ────────────────────────────────────────────
 *
 *   pending ──claim──▶ processing (grava claim_token, claimed_at, lease_expires_at)
 *
 *   processing ──markSent(token)──▶ sent           (limpa claim fields)
 *   processing ──markFailed(token, retry)──▶ pending  (limpa claim fields, seta next_attempt_at)
 *   processing ──markFailed(token, terminal)──▶ failed (limpa claim fields)
 *   processing ──markSkipped(token)──▶ skipped     (limpa claim fields)
 *   processing ──reschedule quiet(token)──▶ pending (limpa claim fields, scheduled_at futuro, next_attempt_at=NULL)
 *   processing ──dry-run revert(token)──▶ pending  (limpa claim fields)
 *   processing ──lease expira + recovery──▶ pending (limpa claim fields, next_attempt_at=+5min, last_error=processing_timeout)
 *   processing ──cancelByEntity/Dedupe──▶ cancelled (limpa claim fields; sem token: operação externa legítima)
 *
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
  | "payable_not_found";

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
 * WA-C9.2 Fase B — Marca como `sent`.
 * Exige `claimToken` correto e `status='processing'`. Limpa campos de claim.
 * Retorna `true` se exatamente 1 linha foi atualizada; `false` em race /
 * token inválido / estado terminal (não reabre nada).
 */
export async function markSent(
  id: string,
  providerMessageId: string,
  claimToken: string,
  deps?: NotificationsDeps,
): Promise<boolean> {
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
 * Quando `claimToken` é uma string, exige `status='processing'` e ownership
 * (uso pelo worker após o claim). Quando `claimToken=null`, mantém semântica
 * legada (transições administrativas que não vieram do claim).
 * Em ambos os casos limpa campos de claim (defesa em profundidade).
 */
export async function markSkipped(
  id: string,
  reason: SkippedReason,
  claimToken: string | null,
  deps?: NotificationsDeps,
): Promise<boolean> {
  const c = client(deps);
  const q = c
    .from("whatsapp_notifications")
    .update({
      status: "skipped",
      skipped_reason: reason,
      ...CLAIM_CLEAR,
    })
    .eq("id", id);
  const filtered =
    claimToken != null
      ? q.eq("status", "processing").eq("claim_token", claimToken)
      : q;
  const { data } = await filtered.select("id");
  return (data ?? []).length > 0;
}

/**
 * WA-C9.2 Fase B — Marca falha (com retry ou terminal).
 * Quando `claimToken` é uma string, exige ownership e `status='processing'`.
 * Sempre limpa campos de claim, pois toda saída de processing zera o lease.
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
  let q = c
    .from("whatsapp_notifications")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(patch as any)
    .eq("id", id);
  if (claimToken != null) {
    q = q.eq("status", "processing").eq("claim_token", claimToken);
  } else {
    // Semântica legada: mantém retry a partir de pending/processing/failed,
    // sem reabrir cancelled/skipped/sent.
    q = q.in("status", ["pending", "processing", "failed"]);
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
 * Exige ownership por `claimToken` e `status='processing'`. Limpa campos de
 * claim ao voltar para pending com `scheduled_at=nextAllowedAt`.
 */
export async function rescheduleForQuietHours(
  id: string,
  nextAllowedAt: Date,
  claimToken: string | null,
  deps?: NotificationsDeps,
): Promise<QuietHoursRescheduleResult> {
  const c = client(deps);
  try {
    let q = c
      .from("whatsapp_notifications")
      .update({
        status: "pending",
        scheduled_at: nextAllowedAt.toISOString(),
        next_attempt_at: null,
        skipped_reason: null,
        ...CLAIM_CLEAR,
      })
      .eq("id", id)
      .eq("status", "processing");
    if (claimToken != null) {
      q = q.eq("claim_token", claimToken);
    }
    const { data, error } = await q.select("id");
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
 * hours. Semanticamente idêntica; token de ownership continua obrigatório.
 * Papel distinto de `recoverStuckProcessing` (lease geral expirado).
 */
export async function recoverStuckReschedule(
  id: string,
  nextAllowedAt: Date,
  claimToken: string | null,
  deps?: NotificationsDeps,
): Promise<QuietHoursRescheduleResult> {
  return rescheduleForQuietHours(id, nextAllowedAt, claimToken, deps);
}

/**
 * WA-C9.2 Fase B — Reverte processing → pending como dry-run.
 * Exige ownership por `claimToken`. Preserva scheduled_at, next_attempt_at,
 * attempt_count, dedupe_key. Limpa campos de claim.
 * Retorna `true` em caso de update; `false` em race / token inválido.
 */
export async function revertProcessingToPending(
  id: string,
  claimToken: string,
  deps?: NotificationsDeps,
): Promise<boolean> {
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
 * Exige ownership. Preserva claimed_at, attempt_count, dedupe_key,
 * scheduled_at, next_attempt_at. Só atualiza `lease_expires_at`.
 * Retorna `true` se renovado; `false` se estado terminal, token errado,
 * ou lease já recuperado por outro worker.
 */
export async function renewProcessingLease(
  id: string,
  claimToken: string,
  deps?: NotificationsDeps,
): Promise<boolean> {
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
      // Filtro por claim_token original (protege race worker↔recovery e
      // dois recoveries simultâneos). Se claim_token for null (linha legada),
      // usa `is null` — mas Fase B espera token setado no claim.
      if (row.claim_token != null) {
        q = q.eq("claim_token", row.claim_token);
      } else {
        // linha legada sem token: não recuperar automaticamente nesta fase.
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
