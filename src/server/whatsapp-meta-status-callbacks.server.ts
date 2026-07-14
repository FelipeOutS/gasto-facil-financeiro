/**
 * WA-C9.2 Fase C — Callbacks de status da Meta (HARDENED).
 *
 * Este módulo cobre:
 *   1. Parser de `value.statuses[]` a partir do payload já validado pelo webhook.
 *   2. Geração determinística de `event_key` (idempotência).
 *   3. Persistência em `whatsapp_notification_status_events` (dedupe via unique).
 *   4. Redutor puro do estado agregado (sent/delivered/read/failed).
 *   5. Aplicação idempotente e sem regressão em `whatsapp_notifications`
 *      (compare-and-set + auto-heal via re-leitura de todos os eventos do PMID).
 *   6. Reconciliação de eventos "unmatched" (sem notification_id) por PMID.
 *
 * Contrato HTTP para o webhook:
 *   - Eventos inválidos ou permanentes (status desconhecido, PMID ausente, timestamp
 *     inválido, phone_number_id divergente, duplicata plena) → sucesso: não pedem
 *     retry da Meta.
 *   - Falhas transitórias (INSERT/SELECT/UPDATE, timeout, 5xx do PostgREST) →
 *     `requiresWebhookRetry = true`. O webhook deve retornar não-2xx.
 *
 * Não envia mensagens. Não chama Graph API. Não altera cron/canary.
 * A tabela de eventos é interna (RLS fechada, apenas service_role).
 */

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos públicos

export type ProviderStatus = "sent" | "delivered" | "read" | "failed";

export interface ParsedStatusEvent {
  provider_message_id: string;
  event_status: ProviderStatus;
  event_at: string; // ISO UTC
  error_code: string | null;
  error_title: string | null;
  error_message: string | null;
  error_category: ErrorCategory | null;
  conversation_id: string | null;
  pricing_category: string | null;
  phone_number_id: string | null;
  event_key: string;
  /**
   * D.2A — Referência opaca ecoada pela Meta (biz_opaque_callback_data).
   * Nunca participa da event_key. Preservada apenas para lookup auxiliar
   * e persistência. null quando ausente ou inválida.
   */
  client_reference: string | null;
}

export interface RawMetaStatus {
  id?: unknown;
  status?: unknown;
  timestamp?: unknown;
  recipient_id?: unknown;
  conversation?: { id?: unknown } | null;
  pricing?: { category?: unknown } | null;
  errors?: unknown;
  biz_opaque_callback_data?: unknown;
}

export type ErrorCategory =
  | "retryable"
  | "permanent"
  | "authentication"
  | "configuration"
  | "rate_limit"
  | "unknown";

export interface AggregateState {
  status: "sent" | "failed" | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  last_error_code: string | null;
}

export interface CurrentNotification {
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  last_error_code: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constantes

const ALLOWED_STATUS: ReadonlyArray<ProviderStatus> = [
  "sent",
  "delivered",
  "read",
  "failed",
];

const MAX_ERROR_TITLE = 200;
const MAX_ERROR_MESSAGE = 1000;
const MIN_EVENT_MS = Date.UTC(2020, 0, 1);
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

// CAS: até 3 tentativas em update concorrente.
const APPLY_CAS_MAX_ATTEMPTS = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Sanitização de texto (nunca deixa PII vazar em log/DB)

function sanitizeText(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function sanitizeCode(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, 64);
}

// ─────────────────────────────────────────────────────────────────────────────
// Classificação de falhas do driver Supabase/PostgREST.
// A regra é conservadora: qualquer erro que NÃO seja unique_violation nem
// erro permanente conhecido (23514 check_violation, 22P02 invalid_text_repr,
// 23502 not_null_violation) é tratado como transitório e força o retry do webhook.

const PERMANENT_PG_CODES = new Set([
  "23505", // unique_violation (dedupe por event_key — tratado à parte)
  "23514", // check_violation
  "23502", // not_null_violation
  "22P02", // invalid_text_representation
  "22001", // string_data_right_truncation
  "22007", // invalid_datetime_format
  "22008", // datetime_field_overflow
  "42501", // insufficient_privilege — sinaliza bug, não retry
]);

function isTransientDbError(err: unknown): boolean {
  if (!err || typeof err !== "object") return true;
  const anyErr = err as { code?: unknown; message?: unknown; name?: unknown };
  const code = typeof anyErr.code === "string" ? anyErr.code : null;
  if (code === "23505") return false; // duplicata é permanente-idempotente
  if (code && PERMANENT_PG_CODES.has(code)) return false;
  // AbortError / timeout / fetch failed / network / 5xx → transitório
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalização de timestamp

function normalizeTimestampToUtcIso(raw: unknown): string | null {
  if (raw == null) return null;
  let ms: number | null = null;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    ms = raw > 1e12 ? raw : raw * 1000;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) return null;
      ms = n > 1e12 ? n : n * 1000;
    } else {
      const parsed = Date.parse(trimmed);
      if (Number.isNaN(parsed)) return null;
      ms = parsed;
    }
  } else {
    return null;
  }

  if (ms == null || !Number.isFinite(ms)) return null;
  if (ms < MIN_EVENT_MS) return null;
  if (ms > Date.now() + MAX_FUTURE_MS) return null;
  return new Date(ms).toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Event key determinística

export function buildEventKey(input: {
  provider_message_id: string;
  event_status: ProviderStatus;
  event_at: string;
  error_code: string | null;
}): string {
  const canonical = [
    input.provider_message_id,
    input.event_status,
    input.event_at,
    input.error_code ?? "",
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Classificação de erro Meta (Cloud API).

export function classifyMetaError(code: string | null): ErrorCategory | null {
  if (!code) return null;
  const n = Number(code);
  if (!Number.isFinite(n)) return "unknown";
  if (n === 190 || n === 131057 || n === 131047) return "authentication";
  if (n === 130472 || n === 80007) return "rate_limit";
  if (n === 131000 || n === 133000 || n === 131056) return "configuration";
  if (n === 131021 || n === 131026 || n === 131051 || n === 131053) return "permanent";
  if (n === 131016 || n === 131031 || n === 500) return "retryable";
  return "unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser: extrai statuses[] de UM change.value já validado por HMAC.

export interface ParseOutcome {
  events: ParsedStatusEvent[];
  invalid: number;
  unknown_status: number;
  wrong_phone_number: number;
}

export interface ParseOptions {
  expected_phone_number_id?: string | null;
}

export function parseStatusesFromChangeValue(
  changeValue: {
    statuses?: unknown;
    metadata?: unknown;
  },
  opts: ParseOptions = {},
): ParseOutcome {
  const out: ParseOutcome = {
    events: [],
    invalid: 0,
    unknown_status: 0,
    wrong_phone_number: 0,
  };

  const statuses = Array.isArray(changeValue.statuses) ? changeValue.statuses : [];
  if (statuses.length === 0) return out;

  const metaPhoneId =
    changeValue.metadata &&
    typeof changeValue.metadata === "object" &&
    "phone_number_id" in (changeValue.metadata as Record<string, unknown>)
      ? sanitizeCode(
          (changeValue.metadata as Record<string, unknown>).phone_number_id,
        )
      : null;

  if (
    opts.expected_phone_number_id &&
    metaPhoneId &&
    metaPhoneId !== opts.expected_phone_number_id
  ) {
    out.wrong_phone_number = statuses.length;
    return out;
  }

  for (const raw of statuses as RawMetaStatus[]) {
    if (!raw || typeof raw !== "object") {
      out.invalid++;
      continue;
    }

    const pmid = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!pmid || pmid.length > 256) {
      out.invalid++;
      continue;
    }

    const rawStatus = typeof raw.status === "string" ? raw.status.trim().toLowerCase() : "";
    if (!ALLOWED_STATUS.includes(rawStatus as ProviderStatus)) {
      out.unknown_status++;
      continue;
    }
    const event_status = rawStatus as ProviderStatus;

    const event_at = normalizeTimestampToUtcIso(raw.timestamp);
    if (!event_at) {
      out.invalid++;
      continue;
    }

    let error_code: string | null = null;
    let error_title: string | null = null;
    let error_message: string | null = null;
    if (Array.isArray(raw.errors) && raw.errors.length > 0) {
      const err = raw.errors[0] as Record<string, unknown> | null;
      if (err && typeof err === "object") {
        error_code = sanitizeCode(err.code);
        error_title = sanitizeText(err.title, MAX_ERROR_TITLE);
        error_message = sanitizeText(err.message, MAX_ERROR_MESSAGE);
      }
    }

    const conversation_id =
      raw.conversation && typeof raw.conversation === "object"
        ? sanitizeCode((raw.conversation as { id?: unknown }).id)
        : null;
    const pricing_category =
      raw.pricing && typeof raw.pricing === "object"
        ? sanitizeCode((raw.pricing as { category?: unknown }).category)
        : null;

    const event_key = buildEventKey({
      provider_message_id: pmid,
      event_status,
      event_at,
      error_code,
    });

    // D.2A — biz_opaque_callback_data: SOMENTE string; nunca participa de event_key.
    // Strings vazias, com caracteres de controle, ou fora do limite viram null.
    // Trim NÃO é aplicado para transformar valor inválido em válido.
    let client_reference: string | null = null;
    const rawCref = (raw as { biz_opaque_callback_data?: unknown }).biz_opaque_callback_data;
    if (typeof rawCref === "string" && rawCref.length > 0 && rawCref.length <= 256) {
      // eslint-disable-next-line no-control-regex
      if (!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(rawCref)) {
        client_reference = rawCref;
      }
    }

    out.events.push({
      provider_message_id: pmid,
      event_status,
      event_at,
      error_code,
      error_title,
      error_message,
      error_category: classifyMetaError(error_code),
      conversation_id,
      pricing_category,
      phone_number_id: metaPhoneId,
      event_key,
      client_reference,
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Redutor puro. Não toca DB.

export function reduceProviderStatusEvents(
  events: ReadonlyArray<
    Pick<ParsedStatusEvent, "event_status" | "event_at" | "error_code">
  >,
  current: CurrentNotification,
): AggregateState {
  const merged: {
    sent: string | null;
    delivered: string | null;
    read: string | null;
    failed: string | null;
    failedCode: string | null;
  } = {
    sent: current.sent_at,
    delivered: current.delivered_at,
    read: current.read_at,
    failed: current.failed_at,
    failedCode: current.last_error_code,
  };

  const earlier = (a: string | null, b: string) => (a && a <= b ? a : b);

  let latestFailedAt: string | null = current.failed_at;
  let latestFailedCode: string | null = current.last_error_code;

  for (const ev of events) {
    switch (ev.event_status) {
      case "sent":
        merged.sent = earlier(merged.sent, ev.event_at);
        break;
      case "delivered":
        merged.delivered = earlier(merged.delivered, ev.event_at);
        break;
      case "read":
        merged.read = earlier(merged.read, ev.event_at);
        break;
      case "failed":
        merged.failed = earlier(merged.failed, ev.event_at);
        if (!latestFailedAt || ev.event_at >= latestFailedAt) {
          latestFailedAt = ev.event_at;
          latestFailedCode = ev.error_code ?? latestFailedCode;
        }
        break;
    }
  }

  let status: AggregateState["status"] = null;
  let last_error_code: string | null = latestFailedCode;

  const hasDeliveryEvidence = merged.delivered || merged.read;
  if (hasDeliveryEvidence) {
    status = "sent";
    last_error_code = null;
  } else if (merged.sent && merged.failed) {
    if (merged.sent > merged.failed) status = "sent";
    else status = "failed";
  } else if (merged.failed) {
    status = "failed";
  } else if (merged.sent) {
    status = "sent";
  }

  if (status !== "failed") {
    return {
      status,
      sent_at: merged.sent,
      delivered_at: merged.delivered,
      read_at: merged.read,
      failed_at: null,
      last_error_code: null,
    };
  }

  return {
    status,
    sent_at: merged.sent,
    delivered_at: merged.delivered,
    read_at: merged.read,
    failed_at: latestFailedAt,
    last_error_code,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistência

export type PersistOutcome =
  | { kind: "inserted"; id: string }
  | { kind: "duplicate" }
  | { kind: "error"; transient: boolean; reason: string };

export async function persistStatusEvent(
  ev: ParsedStatusEvent,
  notificationId: string | null,
  client: SupabaseLike = supabaseAdmin as unknown as SupabaseLike,
): Promise<PersistOutcome> {
  try {
    const { data, error } = await client
      .from("whatsapp_notification_status_events")
      .insert({
        notification_id: notificationId,
        provider_message_id: ev.provider_message_id,
        event_status: ev.event_status,
        event_at: ev.event_at,
        error_code: ev.error_code,
        error_title: ev.error_title,
        error_message: ev.error_message,
        error_category: ev.error_category,
        conversation_id: ev.conversation_id,
        pricing_category: ev.pricing_category,
        phone_number_id: ev.phone_number_id,
        event_key: ev.event_key,
        client_reference: ev.client_reference,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = (error as any).code;
      const msg = String(error.message || "");
      if (code === "23505" || msg.includes("event_key_uniq")) {
        return { kind: "duplicate" };
      }
      return {
        kind: "error",
        transient: isTransientDbError(error),
        reason: sanitizeCode(msg) ?? "insert_failed",
      };
    }
    if (!data) return { kind: "duplicate" };
    return { kind: "inserted", id: data.id as string };
  } catch (e) {
    return {
      kind: "error",
      transient: true,
      reason: e instanceof Error ? e.name : "unknown",
    };
  }
}

// Interface mínima para permitir mocking em testes.
export interface SupabaseLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (t: string) => any;
}

// ─────────────────────────────────────────────────────────────────────────────
// Aplicação do agregado na notificação (idempotente, sem regressão).

export interface ApplyOutcome {
  ok: boolean;
  changed: boolean;
  transient?: boolean;
  reason?: string;
  new_status?: string;
}

/**
 * Aplica o agregado a UMA notificação identificada pelo `provider_message_id`.
 *
 * HARDENING:
 *   - Auto-heal: relê TODOS os eventos do PMID em `whatsapp_notification_status_events`
 *     (não confia apenas nos eventos do lote atual). Isso repara casos em que
 *     uma persist anterior teve sucesso mas o apply falhou — o replay chega como
 *     duplicata mas ainda reprocessa o agregado.
 *   - Compare-and-set: UPDATE condicionado ao snapshot lido; retry até 3x
 *     quando outra escrita concorrente altera o registro entre SELECT e UPDATE.
 *   - Nunca regride: aplica MIN() para sent_at/delivered_at/read_at existentes.
 *   - delivered/read sempre podem promover `failed` → `sent`; o inverso é bloqueado.
 *   - Estados terminais (cancelled, skipped) não reabrem.
 *   - Callback em `pending` NÃO promove status — apenas registra timestamps ausentes.
 */
export async function applyProviderStatusAggregate(
  provider_message_id: string,
  eventsForPmid: ReadonlyArray<
    Pick<ParsedStatusEvent, "event_status" | "event_at" | "error_code">
  >,
  client: SupabaseLike = supabaseAdmin as unknown as SupabaseLike,
): Promise<ApplyOutcome> {
  // Fonte da verdade: TODOS os eventos persistidos para este PMID +
  // os eventos in-flight do lote atual. União idempotente (dedupe por event_key
  // não é necessário aqui porque o redutor é comutativo e idempotente).
  let persistedEvents: Array<{
    event_status: ProviderStatus;
    event_at: string;
    error_code: string | null;
  }> = [];
  try {
    const { data, error } = await client
      .from("whatsapp_notification_status_events")
      .select("event_status, event_at, error_code")
      .eq("provider_message_id", provider_message_id);
    if (error) {
      return {
        ok: false,
        changed: false,
        transient: isTransientDbError(error),
        reason: "events_select_failed",
      };
    }
    persistedEvents = (data ?? []) as typeof persistedEvents;
  } catch (e) {
    return {
      ok: false,
      changed: false,
      transient: true,
      reason: e instanceof Error ? e.name : "events_select_throw",
    };
  }

  const allEvents = [
    ...persistedEvents,
    ...eventsForPmid.map((e) => ({
      event_status: e.event_status,
      event_at: e.event_at,
      error_code: e.error_code,
    })),
  ];

  for (let attempt = 0; attempt < APPLY_CAS_MAX_ATTEMPTS; attempt++) {
    const { data: notif, error: selErr } = await client
      .from("whatsapp_notifications")
      .select(
        "id, status, sent_at, delivered_at, read_at, failed_at, last_error_code, claim_token, claimed_at, lease_expires_at",
      )
      .eq("provider_message_id", provider_message_id)
      .maybeSingle();

    if (selErr) {
      return {
        ok: false,
        changed: false,
        transient: isTransientDbError(selErr),
        reason: "select_failed",
      };
    }
    if (!notif) return { ok: false, changed: false, reason: "unmatched" };

    const cur: CurrentNotification = {
      status: notif.status as string,
      sent_at: (notif.sent_at as string) ?? null,
      delivered_at: (notif.delivered_at as string) ?? null,
      read_at: (notif.read_at as string) ?? null,
      failed_at: (notif.failed_at as string) ?? null,
      last_error_code: (notif.last_error_code as string) ?? null,
    };

    if (cur.status === "cancelled" || cur.status === "skipped") {
      return {
        ok: true,
        changed: false,
        reason: "terminal_state",
        new_status: cur.status,
      };
    }

    const agg = reduceProviderStatusEvents(allEvents, cur);

    if (agg.status === null) {
      return { ok: true, changed: false, reason: "no_effective_state" };
    }

    // Pending: nunca promove status; apenas preenche timestamps ausentes.
    if (cur.status === "pending") {
      const patchOnly: Record<string, unknown> = {};
      if (cur.sent_at == null && agg.sent_at) patchOnly.sent_at = agg.sent_at;
      if (cur.delivered_at == null && agg.delivered_at)
        patchOnly.delivered_at = agg.delivered_at;
      if (cur.read_at == null && agg.read_at) patchOnly.read_at = agg.read_at;

      if (Object.keys(patchOnly).length === 0) {
        return { ok: true, changed: false, reason: "pending_no_promotion" };
      }
      const { error } = await client
        .from("whatsapp_notifications")
        .update(patchOnly)
        .eq("id", notif.id)
        .eq("status", "pending");
      if (error) {
        return {
          ok: false,
          changed: false,
          transient: isTransientDbError(error),
          reason: "update_failed",
        };
      }
      return {
        ok: true,
        changed: true,
        new_status: "pending",
        reason: "pending_timestamps_only",
      };
    }

    // Compute patch com regra "nunca regride" (MIN() por estágio).
    const nextSent =
      cur.sent_at && agg.sent_at
        ? cur.sent_at <= agg.sent_at
          ? cur.sent_at
          : agg.sent_at
        : (cur.sent_at ?? agg.sent_at);
    const nextDelivered =
      cur.delivered_at && agg.delivered_at
        ? cur.delivered_at <= agg.delivered_at
          ? cur.delivered_at
          : agg.delivered_at
        : (cur.delivered_at ?? agg.delivered_at);
    const nextRead =
      cur.read_at && agg.read_at
        ? cur.read_at <= agg.read_at
          ? cur.read_at
          : agg.read_at
        : (cur.read_at ?? agg.read_at);

    const patch: Record<string, unknown> = {};
    if (nextSent !== cur.sent_at) patch.sent_at = nextSent;
    if (nextDelivered !== cur.delivered_at) patch.delivered_at = nextDelivered;
    if (nextRead !== cur.read_at) patch.read_at = nextRead;

    let newStatus: string = cur.status;
    if (agg.status === "sent") newStatus = "sent";
    else if (agg.status === "failed") {
      // NUNCA rebaixa: se cur já está em `sent` (com prova de entrega prévia),
      // o redutor não deveria devolver failed. Defesa em profundidade:
      if (cur.status === "sent") {
        newStatus = "sent";
      } else {
        newStatus = "failed";
      }
    }
    if (newStatus !== cur.status) patch.status = newStatus;

    if (newStatus === "failed") {
      if (agg.failed_at && cur.failed_at !== agg.failed_at)
        patch.failed_at = agg.failed_at;
      if (agg.last_error_code !== cur.last_error_code)
        patch.last_error_code = agg.last_error_code;
    } else if (newStatus === "sent") {
      if (cur.failed_at) patch.failed_at = null;
      if (cur.last_error_code) patch.last_error_code = null;
    }

    if (
      cur.status === "processing" &&
      (newStatus === "sent" || newStatus === "failed")
    ) {
      patch.claim_token = null;
      patch.claimed_at = null;
      patch.lease_expires_at = null;
    }

    if (Object.keys(patch).length === 0) {
      return { ok: true, changed: false, reason: "no_change", new_status: cur.status };
    }

    // CAS: pin em todas as colunas lidas. Se outro writer avançou o estado,
    // o UPDATE não bate e nós reciclamos com um snapshot fresco.
    let q = client
      .from("whatsapp_notifications")
      .update(patch)
      .eq("id", notif.id)
      .eq("status", cur.status);
    q = cur.sent_at == null ? q.is("sent_at", null) : q.eq("sent_at", cur.sent_at);
    q =
      cur.delivered_at == null
        ? q.is("delivered_at", null)
        : q.eq("delivered_at", cur.delivered_at);
    q =
      cur.read_at == null ? q.is("read_at", null) : q.eq("read_at", cur.read_at);
    q =
      cur.failed_at == null
        ? q.is("failed_at", null)
        : q.eq("failed_at", cur.failed_at);

    const { error: upErr } = await q;
    if (upErr) {
      return {
        ok: false,
        changed: false,
        transient: isTransientDbError(upErr),
        reason: "update_failed",
      };
    }

    // Confirma que o CAS pegou: relê e verifica se o patch está refletido.
    // Se não estiver, outro writer venceu — tentamos de novo com estado fresco.
    const { data: verify } = await client
      .from("whatsapp_notifications")
      .select(
        "status, sent_at, delivered_at, read_at, failed_at, last_error_code",
      )
      .eq("id", notif.id)
      .maybeSingle();
    if (!verify) {
      // Estado corrompido; não reintenta.
      return { ok: true, changed: false, reason: "verify_missing" };
    }
    const matches =
      (patch.status == null || verify.status === patch.status) &&
      (patch.sent_at === undefined || verify.sent_at === patch.sent_at) &&
      (patch.delivered_at === undefined ||
        verify.delivered_at === patch.delivered_at) &&
      (patch.read_at === undefined || verify.read_at === patch.read_at) &&
      (patch.failed_at === undefined || verify.failed_at === patch.failed_at) &&
      (patch.last_error_code === undefined ||
        verify.last_error_code === patch.last_error_code);
    if (matches) {
      return { ok: true, changed: true, new_status: newStatus };
    }
    // Concorrente venceu — próxima iteração.
  }

  // Esgotou CAS. Não é falha permanente do provedor; peça retry.
  return {
    ok: false,
    changed: false,
    transient: true,
    reason: "cas_exhausted",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Persist + apply para UMA lista de eventos parseados (agrupa por PMID).

export interface ProcessOutcome {
  received: number;
  inserted: number;
  duplicates: number;
  matched: number;
  unmatched: number;
  invalid: number;
  updated: number;
  state_changed: number;
  anomalies: number;
  retryableErrors: number;
  permanentErrors: number;
  requiresWebhookRetry: boolean;
  // D.2A — reconciliação attempt via RPC atômica.
  callback_attempts_reconciled?: number;
  callback_attempts_already_reconciled?: number;
  callback_attempts_unmatched?: number;
  callback_attempts_conflict?: number;
  callback_attempts_anomaly?: number;
}

function emptyProcessOutcome(): ProcessOutcome {
  return {
    received: 0,
    inserted: 0,
    duplicates: 0,
    matched: 0,
    unmatched: 0,
    invalid: 0,
    updated: 0,
    state_changed: 0,
    anomalies: 0,
    retryableErrors: 0,
    permanentErrors: 0,
    requiresWebhookRetry: false,
    callback_attempts_reconciled: 0,
    callback_attempts_already_reconciled: 0,
    callback_attempts_unmatched: 0,
    callback_attempts_conflict: 0,
    callback_attempts_anomaly: 0,
  };
}

/**
 * D.2A — Interface injetável para o wrapper de reconciliação attempt.
 * Default: usa `reconcileAttemptFromCallback` do módulo de attempts.
 */
export interface AttemptReconciler {
  reconcile(input: {
    providerMessageId: string;
    eventStatus: ProviderStatus;
    clientReference: string | null;
    eventAt: string;
  }): Promise<{
    ok: boolean;
    outcome: string | null;
    reason?: string;
  }>;
}

/**
 * D.2A HARDENING — reconciler no-op EXPLÍCITO para testes de Fase C que não
 * conhecem attempts. NUNCA é retornado pela default factory; deve ser passado
 * de forma explícita via `persistAndApplyEvents(events, client, reconciler)`
 * ou `processMetaStatusCallbacks(payload, { reconciler })`.
 *
 * Não pode ser ativado por env, por default, nem inferido em runtime pela
 * ausência de `.rpc`. A ausência de `.rpc` em produção é erro de infra e
 * DEVE derivar em `requiresWebhookRetry=true`.
 */
export function createLegacyNoopAttemptReconciler(): AttemptReconciler {
  return {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async reconcile(_input) {
      return { ok: true, outcome: "unmatched" };
    },
  };
}

async function defaultAttemptReconciler(client: SupabaseLike): Promise<AttemptReconciler> {
  const hasRpc =
    typeof (client as unknown as { rpc?: unknown }).rpc === "function";
  if (!hasRpc) {
    // HARDENING: fail-closed. Nenhum downgrade silencioso. Ausência de `.rpc`
    // em produção significa wiring/config quebrada — não pode ser tratada como
    // sucesso. O caller (persistAndApplyEvents) converterá em requiresWebhookRetry.
    console.error(
      JSON.stringify({
        module: "wa-status-callbacks-d2a",
        event: "reconciler_rpc_unavailable",
        detail: "supabase client missing .rpc; refusing silent downgrade",
      }),
    );
    return {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async reconcile(_input) {
        return { ok: false, outcome: null, reason: "rpc_unavailable" };
      },
    };
  }
  const mod = await import("@/server/whatsapp-notification-attempts.server");
  return {
    async reconcile(input) {
      const r = await mod.reconcileAttemptFromCallback(
        {
          providerMessageId: input.providerMessageId,
          eventStatus: input.eventStatus,
          clientReference: input.clientReference,
          eventAt: input.eventAt,
        },
        client,
      );
      if (r.ok) return { ok: true, outcome: r.outcome };
      return { ok: false, outcome: null, reason: r.reason };
    },
  };
}

export async function persistAndApplyEvents(
  events: ReadonlyArray<ParsedStatusEvent>,
  client: SupabaseLike = supabaseAdmin as unknown as SupabaseLike,
  reconciler?: AttemptReconciler,
): Promise<ProcessOutcome> {
  const summary = emptyProcessOutcome();
  summary.received = events.length;
  if (events.length === 0) return summary;

  const byPmid = new Map<string, ParsedStatusEvent[]>();
  for (const ev of events) {
    const arr = byPmid.get(ev.provider_message_id) ?? [];
    arr.push(ev);
    byPmid.set(ev.provider_message_id, arr);
  }

  const rec = reconciler ?? (await defaultAttemptReconciler(client));

  for (const [pmid, list] of byPmid) {
    // 1) Correlaciona.
    let notifId: string | null = null;
    let notifLookupTransientFail = false;
    try {
      const { data, error } = await client
        .from("whatsapp_notifications")
        .select("id")
        .eq("provider_message_id", pmid)
        .maybeSingle();
      if (error) {
        if (isTransientDbError(error)) notifLookupTransientFail = true;
      } else {
        notifId = data?.id ?? null;
      }
    } catch {
      notifLookupTransientFail = true;
    }
    if (notifLookupTransientFail) {
      summary.retryableErrors++;
      summary.requiresWebhookRetry = true;
      // Prossegue tentando persistir eventos (dedupe garante idempotência).
    }
    if (notifId) summary.matched += list.length;
    else summary.unmatched += list.length;

    // 2) Persiste eventos (idempotente via event_key).
    // IMPORTANTE: duplicata NÃO curto-circuita o apply — o apply reprocessa
    // usando TODOS os eventos persistidos (self-heal de partial-write).
    for (const ev of list) {
      const r = await persistStatusEvent(ev, notifId, client);
      if (r.kind === "inserted") summary.inserted++;
      else if (r.kind === "duplicate") summary.duplicates++;
      else {
        // erro
        if (r.transient) {
          summary.retryableErrors++;
          summary.requiresWebhookRetry = true;
        } else {
          summary.permanentErrors++;
          summary.invalid++;
        }
      }
    }

    // 2.5) D.2A — Reconciliação attempt via RPC atômica.
    //      Ordem: PMID primeiro, client_reference como fallback (feito pela RPC).
    //      Uma chamada por PMID; a RPC é idempotente. Erros isolados por PMID.
    const representative = pickRepresentative(list);
    try {
      const rr = await rec.reconcile({
        providerMessageId: pmid,
        eventStatus: representative.event_status,
        clientReference: representative.client_reference ?? null,
        eventAt: representative.event_at,
      });
      if (rr.ok && rr.outcome) {
        switch (rr.outcome) {
          case "reconciled":
            summary.callback_attempts_reconciled =
              (summary.callback_attempts_reconciled ?? 0) + 1;
            break;
          case "unmatched":
            summary.callback_attempts_unmatched =
              (summary.callback_attempts_unmatched ?? 0) + 1;
            break;
          case "conflict_pmid":
          case "conflict_state":
            summary.callback_attempts_conflict =
              (summary.callback_attempts_conflict ?? 0) + 1;
            break;
          case "notification_missing":
            summary.callback_attempts_anomaly =
              (summary.callback_attempts_anomaly ?? 0) + 1;
            break;
        }
      } else {
        // Falha da RPC não derruba o lote; se transitória, pede retry ao webhook.
        summary.retryableErrors++;
        summary.requiresWebhookRetry = true;
      }
    } catch {
      summary.retryableErrors++;
      summary.requiresWebhookRetry = true;
    }

    // 3) Se há notificação (ou surgiu por reconciliação anterior), aplica.
    //    O apply relê TODOS os eventos por PMID, garantindo reparo de replays.
    if (notifId) {
      const applied = await applyProviderStatusAggregate(pmid, list, client);
      if (applied.ok && applied.changed) {
        summary.updated++;
        summary.state_changed++;
      } else if (!applied.ok) {
        if (applied.transient) {
          summary.retryableErrors++;
          summary.requiresWebhookRetry = true;
        } else {
          summary.permanentErrors++;
        }
      } else if (
        applied.reason === "terminal_state" ||
        applied.reason === "pending_no_promotion"
      ) {
        summary.anomalies++;
      }
    }
  }

  return summary;
}

/**
 * Escolhe o evento "representante" do lote por PMID para chamar a RPC de
 * reconciliação uma única vez por PMID. Prioridade: sent > delivered > read > failed
 * (correlação de PMID→attempt não depende do status; usamos o mais autoritativo).
 */
function pickRepresentative(list: ParsedStatusEvent[]): ParsedStatusEvent {
  const priority: Record<ProviderStatus, number> = {
    sent: 4,
    delivered: 3,
    read: 2,
    failed: 1,
  };
  let best = list[0];
  for (const ev of list) {
    if (priority[ev.event_status] > priority[best.event_status]) best = ev;
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliação

export async function reconcileStatusEvents(
  provider_message_id: string,
  client: SupabaseLike = supabaseAdmin as unknown as SupabaseLike,
): Promise<{ associated: number; applied: ApplyOutcome | null }> {
  const { data: notif } = await client
    .from("whatsapp_notifications")
    .select("id")
    .eq("provider_message_id", provider_message_id)
    .maybeSingle();
  if (!notif) return { associated: 0, applied: null };

  const { data: pending } = await client
    .from("whatsapp_notification_status_events")
    .select("id, event_status, event_at, error_code")
    .eq("provider_message_id", provider_message_id)
    .is("notification_id", null);

  const rows = (pending ?? []) as Array<{
    id: string;
    event_status: ProviderStatus;
    event_at: string;
    error_code: string | null;
  }>;

  if (rows.length > 0) {
    await client
      .from("whatsapp_notification_status_events")
      .update({ notification_id: notif.id })
      .eq("provider_message_id", provider_message_id)
      .is("notification_id", null);
  }

  const applied = await applyProviderStatusAggregate(
    provider_message_id,
    [], // apply relê todos os eventos por PMID
    client,
  );

  return { associated: rows.length, applied };
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrada de alto nível (usada pelo webhook).
//
// Contrato: NUNCA lança. O caller deve inspecionar `requiresWebhookRetry` e
// retornar HTTP não-2xx à Meta quando true.

export interface ProcessMetaStatusCallbacksOptions {
  expected_phone_number_id?: string | null;
  client?: SupabaseLike;
  /**
   * D.2A HARDENING — reconciler explícito. Somente para testes que precisam
   * suprimir a reconciliação attempt (Fase C sem attempts). Produção NUNCA
   * passa este campo; o default fail-closed é aplicado.
   */
  reconciler?: AttemptReconciler;
}

export type MetaStatusProcessingResult = ProcessOutcome & {
  unknown_status: number;
  wrong_phone_number: number;
};

export async function processMetaStatusCallbacks(
  payload:
    | {
        entry?: Array<{
          changes?: Array<{
            value?: unknown;
          }>;
        }>;
      }
    | null
    | undefined,
  opts: ProcessMetaStatusCallbacksOptions = {},
): Promise<MetaStatusProcessingResult> {
  const client = opts.client ?? (supabaseAdmin as unknown as SupabaseLike);
  const totalSummary: MetaStatusProcessingResult = {
    ...emptyProcessOutcome(),
    unknown_status: 0,
    wrong_phone_number: 0,
  };
  if (!payload || !Array.isArray(payload.entry)) return totalSummary;

  const allEvents: ParsedStatusEvent[] = [];
  try {
    for (const entry of payload.entry) {
      if (!entry || !Array.isArray(entry.changes)) continue;
      for (const change of entry.changes) {
        const v = change?.value;
        if (!v || typeof v !== "object") continue;
        const parsed = parseStatusesFromChangeValue(
          v as { statuses?: unknown; metadata?: unknown },
          { expected_phone_number_id: opts.expected_phone_number_id ?? null },
        );
        totalSummary.invalid += parsed.invalid;
        totalSummary.unknown_status += parsed.unknown_status;
        totalSummary.wrong_phone_number += parsed.wrong_phone_number;
        allEvents.push(...parsed.events);
      }
    }
  } catch (e) {
    // Parser é síncrono/puro — mas se algo escapar, tratamos como retryable
    // conservadoramente sem expor detalhes.
    totalSummary.retryableErrors++;
    totalSummary.requiresWebhookRetry = true;
    console.error({
      event: "wa_status_parser_unexpected",
      errorName: e instanceof Error ? e.name : "unknown",
    });
    return totalSummary;
  }

  if (allEvents.length === 0) return totalSummary;

  const persisted = await persistAndApplyEvents(allEvents, client, opts.reconciler);
  totalSummary.received += persisted.received;
  totalSummary.inserted += persisted.inserted;
  totalSummary.duplicates += persisted.duplicates;
  totalSummary.matched += persisted.matched;
  totalSummary.unmatched += persisted.unmatched;
  totalSummary.invalid += persisted.invalid;
  totalSummary.updated += persisted.updated;
  totalSummary.state_changed += persisted.state_changed;
  totalSummary.anomalies += persisted.anomalies;
  totalSummary.retryableErrors += persisted.retryableErrors;
  totalSummary.permanentErrors += persisted.permanentErrors;
  if (persisted.requiresWebhookRetry) totalSummary.requiresWebhookRetry = true;

  return totalSummary;
}
