/**
 * Server-side logging helpers for webhook events and admin/audit actions.
 *
 * These helpers persist into `webhook_logs` and `audit_logs`. They are
 * intentionally tolerant: any failure to write a log is swallowed (logged
 * to console) and never breaks the main flow.
 *
 * Sensitive headers (Authorization, Cookie, x-signature, token, etc.) are
 * always redacted before persistence.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SENSITIVE_HEADER_KEYS = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-signature",
  "x-hub-signature",
  "x-hub-signature-256",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "api-key",
  "x-api-key",
  "apikey",
];

const REDACTED = "[REDACTED]";

export function redactHeaders(
  headers: Headers | Record<string, string> | null | undefined,
): Record<string, string> | null {
  if (!headers) return null;
  const out: Record<string, string> = {};
  const entries: Array<[string, string]> =
    headers instanceof Headers ? Array.from(headers.entries()) : Object.entries(headers);
  for (const [rawKey, value] of entries) {
    const key = String(rawKey).toLowerCase();
    if (SENSITIVE_HEADER_KEYS.includes(key)) {
      out[key] = REDACTED;
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

/**
 * Recursively redacts sensitive keys from arbitrary JSON-like bodies.
 * Caps size to avoid storing huge payloads.
 */
export function redactBody(body: unknown): unknown {
  if (body == null) return body;
  try {
    const json = JSON.parse(JSON.stringify(body));
    const walk = (node: unknown): unknown => {
      if (!node || typeof node !== "object") return node;
      if (Array.isArray(node)) return node.map(walk);
      const obj = node as Record<string, unknown>;
      for (const k of Object.keys(obj)) {
        if (SENSITIVE_HEADER_KEYS.includes(k.toLowerCase())) {
          obj[k] = REDACTED;
        } else {
          obj[k] = walk(obj[k]);
        }
      }
      return obj;
    };
    const sanitized = walk(json);
    // Cap stringified size at ~64KB.
    const str = JSON.stringify(sanitized);
    if (str.length > 64_000) {
      return { _truncated: true, preview: str.slice(0, 4000) };
    }
    return sanitized;
  } catch {
    return { _unserializable: true };
  }
}

export type WebhookLogStatus = "received" | "processed" | "ignored" | "failed";

export interface WebhookLogInput {
  provider: string;
  event_type?: string | null;
  external_id?: string | null;
  user_id?: string | null;
  related_email?: string | null;
  status: WebhookLogStatus;
  http_status?: number | null;
  request_headers?: Headers | Record<string, string> | null;
  request_body?: unknown;
  response_body?: unknown;
  error_message?: string | null;
  processing_time_ms?: number | null;
  idempotency_key?: string | null;
}

/**
 * Persists a webhook event. Returns the generated id (or null on failure).
 * Never throws.
 */
export async function logWebhookEvent(input: WebhookLogInput): Promise<string | null> {
  try {
    const row = {
      provider: input.provider,
      event_type: input.event_type ?? null,
      external_id: input.external_id ?? null,
      user_id: input.user_id ?? null,
      related_email: input.related_email ?? null,
      status: input.status,
      http_status: input.http_status ?? null,
      request_headers: redactHeaders(input.request_headers ?? null),
      request_body: redactBody(input.request_body) ?? null,
      response_body: redactBody(input.response_body) ?? null,
      error_message: input.error_message ?? null,
      processing_time_ms: input.processing_time_ms ?? null,
      idempotency_key: input.idempotency_key ?? null,
    };
    const { data, error } = await supabaseAdmin
      .from("webhook_logs")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(row as any)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[logWebhookEvent] insert failed", error.message);
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as any)?.id ?? null;
  } catch (err) {
    console.error("[logWebhookEvent] threw", err);
    return null;
  }
}

/**
 * Updates an existing webhook log row (e.g. mark "received" → "processed").
 * Never throws.
 */
export async function updateWebhookLog(id: string, patch: Partial<WebhookLogInput>): Promise<void> {
  if (!id) return;
  try {
    const update: Record<string, unknown> = {};
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.event_type !== undefined) update.event_type = patch.event_type;
    if (patch.external_id !== undefined) update.external_id = patch.external_id;
    if (patch.user_id !== undefined) update.user_id = patch.user_id;
    if (patch.related_email !== undefined) update.related_email = patch.related_email;
    if (patch.http_status !== undefined) update.http_status = patch.http_status;
    if (patch.response_body !== undefined) update.response_body = redactBody(patch.response_body);
    if (patch.error_message !== undefined) update.error_message = patch.error_message;
    if (patch.processing_time_ms !== undefined)
      update.processing_time_ms = patch.processing_time_ms;

    const { error } = await supabaseAdmin
      .from("webhook_logs")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(update as any)
      .eq("id", id);
    if (error) console.error("[updateWebhookLog] failed", error.message);
  } catch (err) {
    console.error("[updateWebhookLog] threw", err);
  }
}

export interface AuditLogInput {
  actor_user_id?: string | null;
  actor_email?: string | null;
  action: string;
  target_user_id?: string | null;
  target_email?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  old_data?: unknown;
  new_data?: unknown;
  metadata?: unknown;
  ip_address?: string | null;
  user_agent?: string | null;
}

/**
 * Persists an admin/audit event. Never throws.
 */
export async function logAuditEvent(input: AuditLogInput): Promise<void> {
  try {
    const row = {
      actor_user_id: input.actor_user_id ?? null,
      actor_email: input.actor_email ?? null,
      action: input.action,
      target_user_id: input.target_user_id ?? null,
      target_email: input.target_email ?? null,
      entity_type: input.entity_type ?? null,
      entity_id: input.entity_id ?? null,
      old_data: redactBody(input.old_data) ?? null,
      new_data: redactBody(input.new_data) ?? null,
      metadata: redactBody(input.metadata) ?? null,
      ip_address: input.ip_address ?? null,
      user_agent: input.user_agent ?? null,
    };
    const { error } = await supabaseAdmin
      .from("audit_logs")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(row as any);
    if (error) console.error("[logAuditEvent] insert failed", error.message);
  } catch (err) {
    console.error("[logAuditEvent] threw", err);
  }
}
