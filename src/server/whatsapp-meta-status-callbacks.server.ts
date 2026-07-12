/**
 * WA-C9.2 Fase C — Callbacks de status da Meta.
 *
 * Este módulo cobre:
 *   1. Parser de `value.statuses[]` a partir do payload já validado pelo webhook.
 *   2. Geração determinística de `event_key` (idempotência).
 *   3. Persistência em `whatsapp_notification_status_events` (dedupe via unique).
 *   4. Redutor puro do estado agregado (sent/delivered/read/failed).
 *   5. Aplicação idempotente em `whatsapp_notifications` sem regredir estado.
 *   6. Reconciliação de eventos "unmatched" (sem notification_id) por PMID.
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
}

export interface RawMetaStatus {
  id?: unknown;
  status?: unknown;
  timestamp?: unknown;
  recipient_id?: unknown;
  conversation?: { id?: unknown } | null;
  pricing?: { category?: unknown } | null;
  errors?: unknown;
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

// Aceitamos timestamps entre 2020-01-01 e now + 24h (tolerância p/ clock skew).
const MIN_EVENT_MS = Date.UTC(2020, 0, 1);
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Sanitização de texto (nunca deixa PII vazar em log/DB)

function sanitizeText(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v)
    // remove controles exceto tab/newline/CR
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
// Normalização de timestamp

function normalizeTimestampToUtcIso(raw: unknown): string | null {
  if (raw == null) return null;
  let ms: number | null = null;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Meta envia epoch em segundos (10 dígitos). Aceita ms se maior.
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
  // Representação canônica: ordem fixa, sem espaços, UTC.
  const canonical = [
    input.provider_message_id,
    input.event_status,
    input.event_at,
    input.error_code ?? "",
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Classificação de erro Meta (Cloud API) — categorias iniciais.
// Códigos comuns: 130472 (rate limit), 131047 (24h window), 131026 (undeliverable),
// 131051 (unsupported), 132000 (parameter), 131057 (auth), 190 (token).
// Usada apenas para auditoria nesta fase.
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
  /**
   * ID do phone number configurado para o projeto. Quando presente e o payload
   * trouxer `metadata.phone_number_id` diferente, o lote inteiro é rejeitado.
   * (Meta pode enviar múltiplos change.value; a validação ocorre por change.)
   */
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

  // phone_number_id da metadata do change
  const metaPhoneId =
    changeValue.metadata &&
    typeof changeValue.metadata === "object" &&
    "phone_number_id" in (changeValue.metadata as Record<string, unknown>)
      ? sanitizeCode(
          (changeValue.metadata as Record<string, unknown>).phone_number_id,
        )
      : null;

  // Se configurado e diferente, rejeita todo o change.value.
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
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Redutor puro. Não toca DB.

/**
 * Regras (WA-C9.2 Fase C, §9):
 * - read > delivered > sent (nunca rebaixa).
 * - failed só define estado quando não há delivered/read.
 * - sent vs failed decidido por timestamps (empate → failed).
 * - Se após failed chegar delivered/read → volta para sent (e limpa last_error_code
 *   no agregado; o evento failed continua preservado na tabela de auditoria).
 * - Preserva o menor timestamp válido por estágio.
 * - Nunca rebaixa timestamps já preenchidos no `current`.
 */
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

  const earlier = (a: string | null, b: string) =>
    a && a <= b ? a : b;

  // Para failed, precisamos do MAIS RECENTE (para decidir estado) e do erro dele.
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

  // Decide status agregado
  let status: AggregateState["status"] = null;
  let last_error_code: string | null = latestFailedCode;

  const hasDeliveryEvidence = merged.delivered || merged.read;
  if (hasDeliveryEvidence) {
    // delivered/read vencem qualquer failed.
    status = "sent";
    // Erro do provider deixa de refletir estado atual quando há entrega confirmada.
    last_error_code = null;
  } else if (merged.sent && merged.failed) {
    // Empate ou failed mais recente → failed. Sent mais recente que failed → sent.
    if (merged.sent > merged.failed) status = "sent";
    else status = "failed";
  } else if (merged.failed) {
    status = "failed";
  } else if (merged.sent) {
    status = "sent";
  }

  if (status !== "failed") {
    // Só carrega failed_at/last_error_code quando o estado atual é failed.
    // O evento failed continua preservado na tabela de eventos.
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
  | { kind: "error"; reason: string };

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
      })
      .select("id")
      .maybeSingle();

    if (error) {
      // Postgres unique_violation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = (error as any).code;
      const msg = String(error.message || "");
      if (code === "23505" || msg.includes("event_key_uniq")) {
        return { kind: "duplicate" };
      }
      return { kind: "error", reason: msg || "insert_failed" };
    }
    if (!data) return { kind: "duplicate" };
    return { kind: "inserted", id: data.id as string };
  } catch (e) {
    return {
      kind: "error",
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
  reason?: string;
  new_status?: string;
}

/**
 * Aplica o agregado a UMA notificação identificada pelo `provider_message_id`.
 *
 * Regras de segurança (§11–§13):
 *   - Toca somente sent_at/delivered_at/read_at/failed_at/last_error_code/status
 *     (updated_at via trigger).
 *   - Callback em `processing` PODE promover para sent/failed limpando lease.
 *   - Callback em estados terminais (`cancelled`, `skipped`) NÃO reabre.
 *   - Callback em `pending` NÃO promove sem correlação forte — apenas registra.
 *   - Nunca rebaixa delivered_at/read_at existentes.
 */
export async function applyProviderStatusAggregate(
  provider_message_id: string,
  eventsForPmid: ReadonlyArray<
    Pick<ParsedStatusEvent, "event_status" | "event_at" | "error_code">
  >,
  client: SupabaseLike = supabaseAdmin as unknown as SupabaseLike,
): Promise<ApplyOutcome> {
  const { data: notif, error: selErr } = await client
    .from("whatsapp_notifications")
    .select(
      "id, status, sent_at, delivered_at, read_at, failed_at, last_error_code, claim_token, claimed_at, lease_expires_at",
    )
    .eq("provider_message_id", provider_message_id)
    .maybeSingle();

  if (selErr) return { ok: false, changed: false, reason: "select_failed" };
  if (!notif) return { ok: false, changed: false, reason: "unmatched" };

  const cur: CurrentNotification = {
    status: notif.status as string,
    sent_at: (notif.sent_at as string) ?? null,
    delivered_at: (notif.delivered_at as string) ?? null,
    read_at: (notif.read_at as string) ?? null,
    failed_at: (notif.failed_at as string) ?? null,
    last_error_code: (notif.last_error_code as string) ?? null,
  };

  // Estados terminais: cancelled/skipped nunca reabrem.
  if (cur.status === "cancelled" || cur.status === "skipped") {
    return { ok: true, changed: false, reason: "terminal_state", new_status: cur.status };
  }

  const agg = reduceProviderStatusEvents(eventsForPmid, cur);

  // Se o redutor não tem opinião (nenhum evento válido conhecido), no-op.
  if (agg.status === null) {
    return { ok: true, changed: false, reason: "no_effective_state" };
  }

  // ─── Regra Fase C §13: callback em `pending` não promove sem prova forte.
  // Nesta rodada tratamos como anomalia: registramos ausência de mudança.
  if (cur.status === "pending") {
    // Ainda gravamos os timestamps individuais se estavam nulos, pois são
    // apenas rastros de auditoria e não afetam a máquina de estados.
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
      .eq("status", "pending"); // condição defensiva
    if (error) return { ok: false, changed: false, reason: "update_failed" };
    return {
      ok: true,
      changed: true,
      new_status: "pending",
      reason: "pending_timestamps_only",
    };
  }

  // ─── Monta patch respeitando "nunca rebaixar" e "primeiro timestamp válido".
  const patch: Record<string, unknown> = {};
  const eq_or_null = (a: string | null, b: string | null) => a === b;

  const nextSent =
    cur.sent_at && agg.sent_at ? (cur.sent_at <= agg.sent_at ? cur.sent_at : agg.sent_at) : (cur.sent_at ?? agg.sent_at);
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

  if (!eq_or_null(nextSent, cur.sent_at)) patch.sent_at = nextSent;
  if (!eq_or_null(nextDelivered, cur.delivered_at)) patch.delivered_at = nextDelivered;
  if (!eq_or_null(nextRead, cur.read_at)) patch.read_at = nextRead;

  // Status agregado: sent | failed.
  let newStatus: string = cur.status;
  if (agg.status === "sent") newStatus = "sent";
  else if (agg.status === "failed") newStatus = "failed";

  // Bloqueia rebaixamento: se atual é `sent` e chegou apenas failed sem prova
  // de entrega, o redutor já teria retornado "failed" apenas se não houvesse
  // delivered/read no histórico. Como delivered/read sobrepõem, aqui é seguro.
  // Porém, se cur.status === "sent" e agg diz "failed" sem novos delivered/read,
  // aplicamos apenas quando o histórico agregado justifica (o redutor decide).
  if (newStatus !== cur.status) patch.status = newStatus;

  // failed_at/last_error_code
  if (agg.status === "failed") {
    if (agg.failed_at && cur.failed_at !== agg.failed_at) patch.failed_at = agg.failed_at;
    if (agg.last_error_code !== cur.last_error_code)
      patch.last_error_code = agg.last_error_code;
  } else {
    // agg.status === "sent" (nunca "pending" aqui)
    if (cur.failed_at) patch.failed_at = null;
    if (cur.last_error_code) patch.last_error_code = null;
  }

  // Callback em processing → limpar lease/claim ao promover para terminal.
  if (cur.status === "processing" && (newStatus === "sent" || newStatus === "failed")) {
    patch.claim_token = null;
    patch.claimed_at = null;
    patch.lease_expires_at = null;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true, changed: false, reason: "no_change", new_status: cur.status };
  }

  // Update condicional para não sobrescrever transições concorrentes.
  // Aceitamos o update se o status ainda é o que lemos OU já é o alvo (idempotente).
  const q = client
    .from("whatsapp_notifications")
    .update(patch)
    .eq("id", notif.id)
    .in("status", Array.from(new Set([cur.status, newStatus])));

  const { error: upErr } = await q;
  if (upErr) return { ok: false, changed: false, reason: "update_failed" };
  return { ok: true, changed: true, new_status: newStatus };
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
}

export async function persistAndApplyEvents(
  events: ReadonlyArray<ParsedStatusEvent>,
  client: SupabaseLike = supabaseAdmin as unknown as SupabaseLike,
): Promise<ProcessOutcome> {
  const summary: ProcessOutcome = {
    received: events.length,
    inserted: 0,
    duplicates: 0,
    matched: 0,
    unmatched: 0,
    invalid: 0,
    updated: 0,
    state_changed: 0,
    anomalies: 0,
  };
  if (events.length === 0) return summary;

  // Agrupa eventos por provider_message_id.
  const byPmid = new Map<string, ParsedStatusEvent[]>();
  for (const ev of events) {
    const arr = byPmid.get(ev.provider_message_id) ?? [];
    arr.push(ev);
    byPmid.set(ev.provider_message_id, arr);
  }

  for (const [pmid, list] of byPmid) {
    // 1) Correlaciona: existe notificação com esse PMID?
    let notifId: string | null = null;
    try {
      const { data } = await client
        .from("whatsapp_notifications")
        .select("id")
        .eq("provider_message_id", pmid)
        .maybeSingle();
      notifId = data?.id ?? null;
    } catch {
      notifId = null;
    }
    if (notifId) summary.matched += list.length;
    else summary.unmatched += list.length;

    // 2) Persiste cada evento (idempotente via event_key).
    for (const ev of list) {
      const r = await persistStatusEvent(ev, notifId, client);
      if (r.kind === "inserted") summary.inserted++;
      else if (r.kind === "duplicate") summary.duplicates++;
      else summary.invalid++;
    }

    // 3) Se há notificação, aplica agregado (usa todos os eventos do PMID).
    if (notifId) {
      const applied = await applyProviderStatusAggregate(pmid, list, client);
      if (applied.ok && applied.changed) {
        summary.updated++;
        summary.state_changed++;
      } else if (applied.reason === "terminal_state" || applied.reason === "pending_no_promotion") {
        summary.anomalies++;
      }
    }
  }

  return summary;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliação: quando o envio real (Fase D) persistir PMID depois, este
// helper vincula os eventos "unmatched" já registrados e recalcula estado.

export async function reconcileStatusEvents(
  provider_message_id: string,
  client: SupabaseLike = supabaseAdmin as unknown as SupabaseLike,
): Promise<{ associated: number; applied: ApplyOutcome | null }> {
  // Localiza a notificação alvo
  const { data: notif } = await client
    .from("whatsapp_notifications")
    .select("id")
    .eq("provider_message_id", provider_message_id)
    .maybeSingle();
  if (!notif) return { associated: 0, applied: null };

  // Associa eventos ainda com notification_id NULL
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

  // Recalcula agregado com TODOS os eventos conhecidos.
  const { data: allEvents } = await client
    .from("whatsapp_notification_status_events")
    .select("event_status, event_at, error_code")
    .eq("provider_message_id", provider_message_id);

  const events = ((allEvents ?? []) as Array<{
    event_status: ProviderStatus;
    event_at: string;
    error_code: string | null;
  }>).map((r) => ({
    event_status: r.event_status,
    event_at: r.event_at,
    error_code: r.error_code,
  }));

  const applied = await applyProviderStatusAggregate(
    provider_message_id,
    events,
    client,
  );

  return { associated: rows.length, applied };
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrada de alto nível (usada pelo webhook) — recebe o `payload` já validado
// e retorna o summary. Nunca lança.

export interface ProcessMetaStatusCallbacksOptions {
  expected_phone_number_id?: string | null;
  client?: SupabaseLike;
}

export async function processMetaStatusCallbacks(
  payload: {
    entry?: Array<{
      changes?: Array<{
        value?: unknown;
      }>;
    }>;
  } | null | undefined,
  opts: ProcessMetaStatusCallbacksOptions = {},
): Promise<ProcessOutcome & { unknown_status: number; wrong_phone_number: number }> {
  const client = opts.client ?? (supabaseAdmin as unknown as SupabaseLike);
  const totalSummary: ProcessOutcome & {
    unknown_status: number;
    wrong_phone_number: number;
  } = {
    received: 0,
    inserted: 0,
    duplicates: 0,
    matched: 0,
    unmatched: 0,
    invalid: 0,
    updated: 0,
    state_changed: 0,
    anomalies: 0,
    unknown_status: 0,
    wrong_phone_number: 0,
  };
  if (!payload || !Array.isArray(payload.entry)) return totalSummary;

  const allEvents: ParsedStatusEvent[] = [];
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

  if (allEvents.length === 0) return totalSummary;

  const persisted = await persistAndApplyEvents(allEvents, client);
  totalSummary.received += persisted.received;
  totalSummary.inserted += persisted.inserted;
  totalSummary.duplicates += persisted.duplicates;
  totalSummary.matched += persisted.matched;
  totalSummary.unmatched += persisted.unmatched;
  totalSummary.invalid += persisted.invalid;
  totalSummary.updated += persisted.updated;
  totalSummary.state_changed += persisted.state_changed;
  totalSummary.anomalies += persisted.anomalies;

  return totalSummary;
}
