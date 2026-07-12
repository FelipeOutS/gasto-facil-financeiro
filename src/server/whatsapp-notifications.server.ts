/**
 * WA-C8 — Infraestrutura de notificações outbound do WhatsApp.
 *
 * Camada server-side reutilizável: enfileirar, deduplicar, claim atômico para
 * worker, marcar resultado e cancelar. Não envia mensagens reais; envio fica
 * para WA-C9 atrás da flag `WHATSAPP_DISPATCH_ENABLED`.
 *
 * Regras de logging/PII (consistentes com WA-C7.x):
 *  - Nunca persistir nem logar: texto pronto, telefone, Pix, CPF/CNPJ,
 *    descrição completa, nome de favorecido.
 *  - `payload` é JSONB estruturado (IDs, valores em centavos, datas). O texto
 *    final é renderizado pelo dispatcher a partir do template em tempo de envio.
 */
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
}

const BACKOFF_MINUTES = [1, 5, 30, 120, 720]; // 1m, 5m, 30m, 2h, 12h

function backoffFor(attempt: number): Date {
  const idx = Math.min(Math.max(attempt, 0), BACKOFF_MINUTES.length - 1);
  return new Date(Date.now() + BACKOFF_MINUTES[idx] * 60_000);
}

export interface NotificationsDeps {
  client?: typeof supabaseAdmin;
  now?: () => Date;
}

function client(deps?: NotificationsDeps) {
  return deps?.client ?? supabaseAdmin;
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

  // ON CONFLICT (user_id, dedupe_key) DO NOTHING via upsert + ignoreDuplicates.
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
 * Este contrato é aplicado em `listDuePending` (listagem) e revalidado
 * atomicamente em `claimForProcessing` (UPDATE condicional). Isso protege
 * contra:
 *  - chamada direta de claim por ID conhecido;
 *  - mudança de estado entre listagem e claim;
 *  - retry antecipado durante backoff futuro;
 *  - reagendamento por quiet hours (scheduled_at futuro);
 *  - reabertura de estado terminal (sent/failed/cancelled/skipped/processing).
 *
 * Ordenação: `scheduled_at ASC` — determinístico e servido pelo índice parcial
 * `idx_wa_notif_due (scheduled_at) WHERE status='pending'`. O filtro extra
 * sobre `next_attempt_at` é recheck barato pós-index (conjunto pending é
 * pequeno em regime saudável).
 */

/**
 * Claim atômico: marca como `processing` apenas se todas as condições de
 * elegibilidade forem verdadeiras no instante do UPDATE.
 * Retorna a linha clamada ou null (race, backoff futuro, scheduled futuro,
 * terminal, etc.). Não incrementa attempt_count, preserva dedupe_key,
 * scheduled_at e next_attempt_at.
 */
export async function claimForProcessing(
  id: string,
  deps?: NotificationsDeps,
): Promise<NotificationRow | null> {
  const c = client(deps);
  const now = (deps?.now?.() ?? new Date()).toISOString();
  const { data, error } = await c
    .from("whatsapp_notifications")
    .update({ status: "processing" })
    .eq("id", id)
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
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
 * Lista pendentes elegíveis. Não muda status.
 * O dispatcher itera e chama `claimForProcessing` em cada uma, que revalida.
 */
export async function listDuePending(
  limit = 50,
  deps?: NotificationsDeps,
): Promise<NotificationRow[]> {
  const c = client(deps);
  const now = (deps?.now?.() ?? new Date()).toISOString();
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


export async function markSent(
  id: string,
  providerMessageId: string,
  deps?: NotificationsDeps,
): Promise<void> {
  const c = client(deps);
  await c
    .from("whatsapp_notifications")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      provider_message_id: providerMessageId,
    })
    .eq("id", id);
}

export async function markSkipped(
  id: string,
  reason: SkippedReason,
  deps?: NotificationsDeps,
): Promise<void> {
  const c = client(deps);
  await c
    .from("whatsapp_notifications")
    .update({
      status: "skipped",
      skipped_reason: reason,
    })
    .eq("id", id);
}

export async function markFailed(
  id: string,
  errorCode: string,
  options: { retryable: boolean; currentAttempt: number; maxAttempts: number },
  deps?: NotificationsDeps,
): Promise<{ scheduledRetry: boolean }> {
  const c = client(deps);
  const nextAttempt = options.currentAttempt + 1;
  const canRetry = options.retryable && nextAttempt < options.maxAttempts;
  const patch: Record<string, unknown> = {
    last_error_code: errorCode,
    attempt_count: nextAttempt,
  };
  if (canRetry) {
    patch.status = "pending";
    patch.next_attempt_at = backoffFor(nextAttempt - 1).toISOString();
  } else {
    patch.status = "failed";
    patch.failed_at = new Date().toISOString();
  }
  // WA-C9.1 — nunca ressuscita notificação que outro caminho já invalidou.
  // O filtro `.in("status", ["pending", "processing", "failed"])` garante
  // que `cancelled`/`skipped`/`sent` permaneçam terminais.
  await c
    .from("whatsapp_notifications")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(patch as any)
    .eq("id", id)
    .in("status", ["pending", "processing", "failed"]);
  return { scheduledRetry: canRetry };
}

/**
 * WA-C8.1 — Resultado do reagendamento por quiet hours.
 *
 * Diferencia race (`state_changed`) de erro real de banco/rede (`error`).
 * O dispatcher usa esta discriminação para decidir se tenta recuperação
 * persistente e nunca esconde erro como simples `false`.
 */
export type QuietHoursRescheduleResult =
  | { ok: true; status: "rescheduled" }
  | { ok: false; status: "state_changed" }
  | { ok: false; status: "error"; error: unknown };

/**
 * WA-C8.1 — Reagendamento seguro para quiet hours.
 *
 * Ao contrário de `markSkipped`, quiet_hours é um bloqueio TEMPORÁRIO:
 *  - a mesma linha volta a `pending` com `scheduled_at = nextAllowedAt`;
 *  - `next_attempt_at` é sempre limpo (metadata antiga de retry não pertence
 *    ao próximo agendamento);
 *  - `attempt_count`, `dedupe_key` e `created_at` permanecem;
 *  - `skipped_reason` é limpo;
 *  - só reagenda se ainda estiver em `processing` (protege race com
 *    cancelamento/pagamento/skip concorrentes — estados terminais não
 *    são reabertos).
 *
 * Retorna uma união discriminada:
 *  - `rescheduled` (ok=true)  → exatamente 1 linha `processing → pending`.
 *  - `state_changed` (ok=false) → 0 linhas, sem erro do banco (race).
 *  - `error` (ok=false)         → Supabase retornou erro ou throw.
 *
 * Nunca envia mensagem, nunca marca `sent`, nunca cria nova linha, nunca
 * loga PII (só `id`, códigos e nomes técnicos).
 */
export async function rescheduleForQuietHours(
  id: string,
  nextAllowedAt: Date,
  deps?: NotificationsDeps,
): Promise<QuietHoursRescheduleResult> {
  const c = client(deps);
  try {
    const { data, error } = await c
      .from("whatsapp_notifications")
      .update({
        status: "pending",
        scheduled_at: nextAllowedAt.toISOString(),
        next_attempt_at: null,
        skipped_reason: null,
      })
      .eq("id", id)
      .eq("status", "processing")
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
 * WA-C8.1 — Recuperação conservadora após falha do UPDATE inicial.
 *
 * Mesma semântica de `rescheduleForQuietHours` (processing → pending com
 * `next_attempt_at=NULL`), executada como segunda tentativa persistente
 * para evitar deixar a linha presa em `processing` quando o primeiro
 * UPDATE falhou por erro transitório de banco/rede.
 *
 * Aplica o mesmo filtro `status = 'processing'`: se nesse meio-tempo o
 * status virou terminal ou já foi reagendado por outro worker, retorna
 * `state_changed`. Nunca envia, nunca faz `markSkipped`.
 */
export async function recoverStuckReschedule(
  id: string,
  nextAllowedAt: Date,
  deps?: NotificationsDeps,
): Promise<QuietHoursRescheduleResult> {
  return rescheduleForQuietHours(id, nextAllowedAt, deps);
}

/** Cancela uma notificação pendente. Filtra por user_id (não toca a de outro user). */
export async function cancelByDedupe(
  userId: string,
  dedupeKey: string,
  deps?: NotificationsDeps,
): Promise<number> {
  const c = client(deps);
  const { data } = await c
    .from("whatsapp_notifications")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
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
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .in("status", ["pending"])
    .select("id");
  return (data ?? []).length;
}
