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
  | "user_disabled";

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
 * Claim atômico: marca como `processing` apenas se ainda estiver `pending`.
 * Retorna a linha clamada ou null se outro worker venceu a corrida.
 */
export async function claimForProcessing(
  id: string,
  deps?: NotificationsDeps,
): Promise<NotificationRow | null> {
  const c = client(deps);
  const { data, error } = await c
    .from("whatsapp_notifications")
    .update({ status: "processing" })
    .eq("id", id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) {
    console.error("[wa-notif] claim failed", error.code);
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any) ?? null;
}

/**
 * Lista pendentes vencidas (scheduled_at <= now). Não muda status.
 * O dispatcher itera e chama `claimForProcessing` em cada uma.
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await c.from("whatsapp_notifications").update(patch as any).eq("id", id);
  return { scheduledRetry: canRetry };
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
