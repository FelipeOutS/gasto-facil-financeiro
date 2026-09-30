/**
 * Rastreabilidade das respostas enviadas pelo WhatsApp (outbound).
 * SERVER-ONLY.
 *
 * Fluxo: sendWhatsAppRaw → Meta → `messages[0].id` → `whatsapp_outbound_messages`
 * → callback de status (persistido em `whatsapp_notification_status_events`)
 * → `reconcileOutboundStatus` atualiza a linha sem regredir.
 *
 * Privacidade: NÃO grava texto nem telefone em claro — apenas hash do
 * telefone, últimos 4 dígitos, hash e tamanho do conteúdo.
 * Toda falha aqui é best-effort: nunca impede nem duplica o envio.
 */
import { createHash } from "crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OutboundClient = { from: (t: string) => any };

export type OutboundStatus = "accepted" | "send_failed" | "sent" | "delivered" | "read" | "failed";

export interface RecordOutboundInput {
  to: string;
  messageType: "text" | "interactive";
  source?: string;
  content: string;
  ok: boolean;
  httpStatus: number | null;
  responseBody: string | null;
  userId?: string | null;
}

export interface RecordOutboundResult {
  recorded: boolean;
  metaMessageId: string | null;
  status: OutboundStatus;
}

const digitsOnly = (v: string) => String(v ?? "").replace(/\D/g, "");

export function hashRecipient(phone: string): string {
  return createHash("sha256").update(digitsOnly(phone)).digest("hex").slice(0, 32);
}

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

/** Remove sequências longas de dígitos (telefones) e limita tamanho. */
export function sanitizeErrorText(v: unknown, max = 200): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  return v
    .replace(/\d{8,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function parseMetaSendResponse(body: string | null): {
  metaMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
} {
  if (!body) return { metaMessageId: null, errorCode: null, errorMessage: null };
  try {
    const j = JSON.parse(body) as {
      messages?: Array<{ id?: unknown }>;
      error?: { code?: unknown; error_subcode?: unknown; message?: unknown };
    };
    const id = j?.messages?.[0]?.id;
    const metaMessageId = typeof id === "string" && id.length > 0 && id.length <= 256 ? id : null;
    const code = j?.error?.code;
    return {
      metaMessageId,
      errorCode: code === undefined || code === null ? null : String(code).slice(0, 32),
      errorMessage: sanitizeErrorText(j?.error?.message),
    };
  } catch {
    return { metaMessageId: null, errorCode: null, errorMessage: null };
  }
}

async function resolveUserIdByPhone(to: string, client: OutboundClient): Promise<string | null> {
  const d = digitsOnly(to);
  if (d.length < 10) return null;
  const candidates = [d, d.startsWith("55") ? d.slice(2) : `55${d}`];
  try {
    const { data } = await client
      .from("whatsapp_links")
      .select("user_id")
      .in("telefone", candidates)
      .limit(1)
      .maybeSingle();
    return (data?.user_id as string | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function recordOutboundSend(
  input: RecordOutboundInput,
  client: OutboundClient,
): Promise<RecordOutboundResult> {
  const parsed = parseMetaSendResponse(input.responseBody);
  const accepted = input.ok && !!parsed.metaMessageId;
  const status: OutboundStatus = accepted ? "accepted" : "send_failed";
  const now = new Date().toISOString();
  try {
    const userId = input.userId ?? (await resolveUserIdByPhone(input.to, client));
    const d = digitsOnly(input.to);
    const row = {
      user_id: userId,
      recipient_hash: hashRecipient(input.to),
      recipient_last4: d.length >= 4 ? d.slice(-4) : null,
      message_type: input.messageType,
      source: (input.source ?? "reply").slice(0, 64),
      content_sha256: sha256(input.content ?? ""),
      content_length: (input.content ?? "").length,
      meta_message_id: parsed.metaMessageId,
      status,
      http_status: input.httpStatus,
      error_code: accepted ? null : parsed.errorCode,
      error_message: accepted ? null : parsed.errorMessage,
      accepted_at: accepted ? now : null,
      failed_at: accepted ? null : now,
    };
    const { error } = parsed.metaMessageId
      ? await client
          .from("whatsapp_outbound_messages")
          .upsert(row, { onConflict: "meta_message_id", ignoreDuplicates: true })
      : await client.from("whatsapp_outbound_messages").insert(row);
    if (error) {
      console.error({ event: "wa_outbound_log_failed", code: error.code ?? "db_error" });
      return { recorded: false, metaMessageId: parsed.metaMessageId, status };
    }
    // Callback pode ter chegado antes do registro: aplica eventos já salvos.
    if (parsed.metaMessageId) await reconcileOutboundStatus(parsed.metaMessageId, client);
    return { recorded: true, metaMessageId: parsed.metaMessageId, status };
  } catch (e) {
    console.error({
      event: "wa_outbound_log_failed",
      errorName: e instanceof Error ? e.name : "unknown",
    });
    return { recorded: false, metaMessageId: parsed.metaMessageId, status };
  }
}

interface StoredEvent {
  event_status: string;
  event_at: string;
  error_code: string | null;
  error_message: string | null;
}

interface OutboundRow {
  id: string;
  status: OutboundStatus;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  error_code: string | null;
  error_message: string | null;
}

const earliest = (a: string | null, b: string | null) => (!a ? b : !b ? a : a <= b ? a : b);

/** Redutor puro: nunca regride e preserva timestamps já estabelecidos. */
export function reduceOutboundStatus(
  row: Omit<OutboundRow, "id">,
  events: ReadonlyArray<StoredEvent>,
): Omit<OutboundRow, "id"> {
  let sent = row.sent_at;
  let delivered = row.delivered_at;
  let read = row.read_at;
  let failed = row.failed_at;
  let errCode = row.error_code;
  let errMsg = row.error_message;
  let latestFailed: string | null = null;
  for (const ev of events) {
    if (ev.event_status === "sent") sent = earliest(sent, ev.event_at);
    else if (ev.event_status === "delivered") delivered = earliest(delivered, ev.event_at);
    else if (ev.event_status === "read") read = earliest(read, ev.event_at);
    else if (ev.event_status === "failed") {
      failed = earliest(failed, ev.event_at);
      if (!latestFailed || ev.event_at >= latestFailed) {
        latestFailed = ev.event_at;
        errCode = ev.error_code ?? errCode;
        errMsg = sanitizeErrorText(ev.error_message) ?? errMsg;
      }
    }
  }
  let status: OutboundStatus = row.status;
  if (read) status = "read";
  else if (delivered) status = "delivered";
  else if (failed && (row.status !== "send_failed" || latestFailed)) status = "failed";
  else if (sent) status = "sent";
  return {
    status,
    sent_at: sent,
    delivered_at: delivered,
    read_at: read,
    failed_at: failed,
    error_code: errCode,
    error_message: errMsg,
  };
}

/** Relê todos os eventos do message_id e aplica na linha outbound. Idempotente. */
export async function reconcileOutboundStatus(
  metaMessageId: string,
  client: OutboundClient,
): Promise<{ matched: boolean; changed: boolean }> {
  try {
    const { data: row, error: rowErr } = await client
      .from("whatsapp_outbound_messages")
      .select("id, status, sent_at, delivered_at, read_at, failed_at, error_code, error_message")
      .eq("meta_message_id", metaMessageId)
      .maybeSingle();
    if (rowErr || !row) return { matched: false, changed: false };
    const { data: events, error: evErr } = await client
      .from("whatsapp_notification_status_events")
      .select("event_status, event_at, error_code, error_message")
      .eq("provider_message_id", metaMessageId);
    if (evErr || !Array.isArray(events) || events.length === 0) {
      return { matched: true, changed: false };
    }
    const current = row as OutboundRow;
    const next = reduceOutboundStatus(current, events as StoredEvent[]);
    const changed = (Object.keys(next) as Array<keyof typeof next>).some(
      (k) => next[k] !== current[k],
    );
    if (!changed) return { matched: true, changed: false };
    const { error: upErr } = await client
      .from("whatsapp_outbound_messages")
      .update({ ...next, updated_at: new Date().toISOString() })
      .eq("id", current.id);
    if (upErr) return { matched: true, changed: false };
    return { matched: true, changed: true };
  } catch {
    return { matched: false, changed: false };
  }
}
