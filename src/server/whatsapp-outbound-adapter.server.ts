/**
 * WA-C9.2 Fase D.1 — Adapter Outbound (modo técnico, sem chamada real Meta).
 *
 * Este módulo NÃO deve ser importado pelo dispatcher de produção nesta fase.
 * Nenhum fetch para graph.facebook.com. Nenhuma leitura de WHATSAPP_ACCESS_TOKEN
 * ou WHATSAPP_PHONE_NUMBER_ID. O transport é sempre injetado (obrigatório).
 *
 * Escopo:
 *   - contrato interno do provider outbound (WhatsAppNotificationTransport)
 *   - FakeWhatsAppNotificationTransport para testes
 *   - renderer determinístico de components
 *   - builder canônico do payload Meta
 *   - request_hash SHA-256 sem PII
 *   - validação de recipient (E.164) reutilizando normalizePhone
 *   - livro de tentativas: prepare/sending/accepted/rejected/ambiguous/cancel
 *
 * Máquina de estados:
 *   planned → sending → accepted | rejected | ambiguous
 *   planned → cancelled
 *   ambiguous é ESTADO DE QUARENTENA: bloqueia nova tentativa até
 *   reconciliação autoritativa (Fase D.2). Não permite retry automático.
 *
 * Regras de PII:
 *   - Nunca persiste telefone em claro em `request_hash`. Persiste apenas
 *     o hash do recipient dentro da representação canônica.
 *   - Nunca persiste payload bruto, headers, resposta bruta, token, secret.
 *
 * Compatibilidade:
 *   - Não altera notification.status. Fase D.2 fará a integração atômica
 *     attempt.accepted → notification.sent com PMID unique.
 */
import { createHash, randomUUID } from "node:crypto";
import { normalizePhone } from "@/server/whatsapp-authz.server";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos públicos

export type AttemptStatus =
  | "planned"
  | "sending"
  | "accepted"
  | "rejected"
  | "ambiguous"
  | "cancelled";

export interface NotificationTemplateRow {
  key: string;
  category: string;
  meta_template_name: string | null;
  /** ISO language code (ex.: pt_BR). Default pt_BR quando ausente. */
  language?: string | null;
  payload_schema:
    | {
        required?: string[];
        body_params_order?: string[]; // ordem de params no body; default = required
      }
    | Record<string, unknown>;
  active: boolean;
}

export interface WhatsAppTemplateComponent {
  type: "body" | "header" | "button";
  parameters: Array<{ type: "text"; text: string }>;
}

export interface WhatsAppTemplateRequest {
  messaging_product: "whatsapp";
  to: string;
  type: "template";
  template: {
    name: string;
    language: { code: string };
    /** Omitido quando o template não possui parâmetros dinâmicos. */
    components?: WhatsAppTemplateComponent[];
  };
  biz_opaque_callback_data: string;
}

export interface TransportSendInput {
  phoneNumberId: string;
  recipient: string; // E.164 digits (normalized)
  templateName: string;
  languageCode: string;
  components: WhatsAppTemplateComponent[];
  clientReference: string;
  attemptToken: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface TransportContext {
  now?: () => Date;
}

export type TransportResult =
  | {
      kind: "accepted";
      providerMessageId: string;
      httpStatus?: number;
    }
  | {
      kind: "rejected";
      httpStatus?: number;
      errorCode: string;
      errorCategory: string;
      retryable: boolean;
    }
  | {
      kind: "ambiguous";
      reason: string;
      httpStatus?: number;
      errorCode?: string;
    };

export interface WhatsAppNotificationTransport {
  sendTemplate(request: TransportSendInput, context?: TransportContext): Promise<TransportResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fake transport (testes)

export class FakeWhatsAppNotificationTransport implements WhatsAppNotificationTransport {
  public calls: TransportSendInput[] = [];
  constructor(
    private readonly script:
      | TransportResult
      | ((i: TransportSendInput) => TransportResult | Promise<TransportResult>),
  ) {}
  async sendTemplate(input: TransportSendInput): Promise<TransportResult> {
    this.calls.push(input);
    if (typeof this.script === "function") return this.script(input);
    return this.script;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipient

export type RecipientValidation =
  | { ok: true; digits: string; hash: string }
  | { ok: false; reason: "empty" | "invalid" };

export function validateRecipient(raw: string | null | undefined): RecipientValidation {
  if (raw == null || String(raw).trim() === "") return { ok: false, reason: "empty" };
  const digits = normalizePhone(raw);
  if (!digits) return { ok: false, reason: "invalid" };
  const hash = createHash("sha256").update(digits).digest("hex");
  return { ok: true, digits, hash };
}

// Máscara para logs: preserva 2 primeiros + 2 últimos, ex.: "55******89".
export function maskPhone(digits: string): string {
  if (!digits || digits.length < 4) return "****";
  return `${digits.slice(0, 2)}${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-2)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Renderer determinístico

export interface RenderResult {
  ok: true;
  components: WhatsAppTemplateComponent[];
  paramsOrdered: string[];
}
export type RenderError =
  | { ok: false; reason: "template_disabled" }
  | { ok: false; reason: "template_name_missing" }
  | { ok: false; reason: "param_missing"; param: string }
  | { ok: false; reason: "param_invalid"; param: string };

/** Sanitiza string de parâmetro Meta: sem quebras de linha, sem tabs consecutivos, trim, hardlimit. */
function sanitizeParam(v: unknown): string | null {
  if (v == null) return null;
  const raw =
    typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null;
  if (raw == null) return null;
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  // Meta impõe 1024 chars por parâmetro body; hard cap conservador.
  return cleaned.slice(0, 1024);
}

export function renderTemplateComponents(
  template: NotificationTemplateRow,
  payload: Record<string, unknown>,
): RenderResult | RenderError {
  if (!template.active) return { ok: false, reason: "template_disabled" };
  if (!template.meta_template_name || String(template.meta_template_name).trim() === "") {
    return { ok: false, reason: "template_name_missing" };
  }
  const schema = (template.payload_schema ?? {}) as {
    required?: string[];
    body_params_order?: string[];
  };
  const order =
    schema.body_params_order && schema.body_params_order.length > 0
      ? schema.body_params_order
      : (schema.required ?? []);

  const params: Array<{ type: "text"; text: string }> = [];
  const paramsOrdered: string[] = [];
  for (const key of order) {
    if (!(key in payload)) return { ok: false, reason: "param_missing", param: key };
    const cleaned = sanitizeParam((payload as Record<string, unknown>)[key]);
    if (cleaned == null) return { ok: false, reason: "param_invalid", param: key };
    params.push({ type: "text", text: cleaned });
    paramsOrdered.push(cleaned);
  }
  const components: WhatsAppTemplateComponent[] =
    params.length > 0 ? [{ type: "body", parameters: params }] : [];
  return { ok: true, components, paramsOrdered };
}

// ─────────────────────────────────────────────────────────────────────────────
// client_reference + payload builder

export function buildClientReference(attemptToken: string): string {
  return `wa_attempt:${attemptToken}`;
}

export function buildWhatsAppTemplateRequest(input: {
  recipientDigits: string;
  templateName: string;
  languageCode: string;
  components: WhatsAppTemplateComponent[];
  clientReference: string;
}): WhatsAppTemplateRequest {
  const req: WhatsAppTemplateRequest = {
    messaging_product: "whatsapp",
    to: input.recipientDigits,
    type: "template",
    template: {
      name: input.templateName,
      language: { code: input.languageCode },
    },
    biz_opaque_callback_data: input.clientReference,
  };
  if (Array.isArray(input.components) && input.components.length > 0) {
    req.template.components = input.components;
  }
  return req;
}

// ─────────────────────────────────────────────────────────────────────────────
// Language resolver — WA-C9.2 Fase E.1E
//
// Precedência:
//   1) languageOverride explícito passado pelo executor (server-only);
//   2) template.payload_schema.language (metadata declarativo);
//   3) template.language (legado, se ainda presente);
//   4) fallback global "pt_BR".
//
// Só aceita locales explícitos: pt_BR, en_US. Fail-closed em qualquer
// valor inválido — nunca acomoda locale vindo de payload de notification
// ou de request público (o caller deve garantir server-only trust).

export const SUPPORTED_TEMPLATE_LANGUAGES = Object.freeze(["pt_BR", "en_US"] as const);
export type SupportedTemplateLanguage = (typeof SUPPORTED_TEMPLATE_LANGUAGES)[number];

export type LanguageResolution =
  | {
      ok: true;
      code: SupportedTemplateLanguage;
      source: "override" | "payload_schema" | "template_field" | "fallback";
    }
  | { ok: false; reason: "override_invalid" | "payload_schema_invalid" };

function isSupportedLanguage(v: unknown): v is SupportedTemplateLanguage {
  if (typeof v !== "string") return false;
  const trimmed = v.trim();
  if (trimmed === "" || trimmed !== v) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return false;
  return (SUPPORTED_TEMPLATE_LANGUAGES as readonly string[]).includes(trimmed);
}

export function resolveTemplateLanguage(
  template: NotificationTemplateRow,
  override?: string | null | undefined,
): LanguageResolution {
  if (override !== undefined && override !== null) {
    if (!isSupportedLanguage(override)) return { ok: false, reason: "override_invalid" };
    return { ok: true, code: override, source: "override" };
  }
  const schema = (template.payload_schema ?? {}) as Record<string, unknown>;
  if ("language" in schema && schema.language !== undefined && schema.language !== null) {
    if (!isSupportedLanguage(schema.language))
      return { ok: false, reason: "payload_schema_invalid" };
    return { ok: true, code: schema.language, source: "payload_schema" };
  }
  const legacy = template.language;
  if (legacy !== undefined && legacy !== null && legacy !== "") {
    if (isSupportedLanguage(legacy)) return { ok: true, code: legacy, source: "template_field" };
    // Legacy inválido é ignorado silenciosamente para não quebrar produtivos;
    // cai no fallback pt_BR.
  }
  return { ok: true, code: "pt_BR", source: "fallback" };
}

// ─────────────────────────────────────────────────────────────────────────────
// request_hash canônico (sem telefone em claro)

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => [k, canonicalize((value as Record<string, unknown>)[k])]);
  return Object.fromEntries(entries);
}

export function buildNotificationRequestHash(input: {
  templateName: string;
  languageCode: string;
  components: WhatsAppTemplateComponent[];
  recipientHash: string; // hash SHA-256 do recipient — nunca digits em claro
  clientReference: string;
}): string {
  const canonical = canonicalize({
    template_name: input.templateName,
    language: input.languageCode,
    components: input.components,
    recipient_hash: input.recipientHash,
    client_reference: input.clientReference,
  });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistência — SupabaseLike (mesmo shape do adapter da Fase C)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseLike = { from(table: string): any };

export interface OutboundDeps {
  client: SupabaseLike;
  now?: () => Date;
  randomUUID?: () => string;
}

function nowOf(d: OutboundDeps): Date {
  return d.now?.() ?? new Date();
}
function uuid(d: OutboundDeps): string {
  return d.randomUUID?.() ?? randomUUID();
}

// ─────────────────────────────────────────────────────────────────────────────
// Prepare — cria attempt planned atomicamente

export interface PrepareInput {
  notificationId: string;
  claimToken: string;
  template: NotificationTemplateRow;
  payload: Record<string, unknown>;
  recipient: string;
  languageOverride?: string;
}

export type PrepareResult =
  | {
      kind: "prepared";
      attemptId: string;
      attemptToken: string;
      clientReference: string;
      requestHash: string;
      request: WhatsAppTemplateRequest;
      recipientDigits: string;
    }
  | { kind: "invalid_recipient"; reason: "empty" | "invalid" }
  | { kind: "invalid_template"; reason: RenderError["reason"]; param?: string }
  | { kind: "invalid_template_language"; reason: "override_invalid" | "payload_schema_invalid" }
  | { kind: "state_changed" } // notification not processing / bad claim / lease expired
  | { kind: "active_attempt_exists" } // planned/sending
  | { kind: "quarantined" } // ambiguous ativo — bloqueia retry
  | { kind: "database_error"; error?: unknown };

export async function prepareNotificationAttempt(
  input: PrepareInput,
  deps: OutboundDeps,
): Promise<PrepareResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = deps.client as any;
  const now = nowOf(deps);
  const nowIso = now.toISOString();

  // 1. Validar recipient.
  const recipient = validateRecipient(input.recipient);
  if (!recipient.ok) return { kind: "invalid_recipient", reason: recipient.reason };

  // 2. Renderizar components.
  const rendered = renderTemplateComponents(input.template, input.payload);
  if ("reason" in rendered && rendered.ok === false) {
    return {
      kind: "invalid_template",
      reason: rendered.reason,
      param: (rendered as { param?: string }).param,
    };
  }

  // 3. Resolver idioma (override → payload_schema → legacy → fallback).
  const langRes = resolveTemplateLanguage(input.template, input.languageOverride);
  if (!langRes.ok) return { kind: "invalid_template_language", reason: langRes.reason };

  // 4. Gerar tokens + hash + request.
  const attemptToken = uuid(deps);
  const clientReference = buildClientReference(attemptToken);
  const templateName = String(input.template.meta_template_name);
  const languageCode = langRes.code;
  const request = buildWhatsAppTemplateRequest({
    recipientDigits: recipient.digits,
    templateName,
    languageCode,
    components: (rendered as RenderResult).components,
    clientReference,
  });
  const requestHash = buildNotificationRequestHash({
    templateName,
    languageCode,
    components: (rendered as RenderResult).components,
    recipientHash: recipient.hash,
    clientReference,
  });

  // 4. Chamada atômica via RPC: valida status/claim/lease + insere planned
  //    numa única transação SECURITY DEFINER. Fecha a race entre SELECT da
  //    notificação e INSERT da tentativa (ownership só é revalidada dentro
  //    da mesma transação em que a linha nasce).
  try {
    const rpc = await client.rpc("whatsapp_attempt_prepare_atomic", {
      p_notification_id: input.notificationId,
      p_claim_token: input.claimToken,
      p_attempt_token: attemptToken,
      p_request_hash: requestHash,
      p_template_key: input.template.key,
      p_template_name: templateName,
      p_template_language: languageCode,
      p_client_reference: clientReference,
      p_now: nowIso,
    });
    if (rpc.error) return { kind: "database_error", error: rpc.error };
    const rows = Array.isArray(rpc.data) ? rpc.data : rpc.data ? [rpc.data] : [];
    const first = (rows[0] ?? {}) as { outcome?: string; attempt_id?: string | null };
    switch (first.outcome) {
      case "state_changed":
        return { kind: "state_changed" };
      case "active_attempt_exists":
        return { kind: "active_attempt_exists" };
      case "quarantined":
        return { kind: "quarantined" };
      case "prepared": {
        const attemptId = String(first.attempt_id ?? "");
        if (!attemptId) return { kind: "database_error" };
        logStructured({
          event: "attempt_prepared",
          attempt_id: attemptId,
          notification_id: input.notificationId,
          template_key: input.template.key,
          request_hash_short: requestHash.slice(0, 12),
          recipient_masked: maskPhone(recipient.digits),
        });
        return {
          kind: "prepared",
          attemptId,
          attemptToken,
          clientReference,
          requestHash,
          request,
          recipientDigits: recipient.digits,
        };
      }
      default:
        return { kind: "database_error", error: new Error("rpc_unknown_outcome") };
    }
  } catch (err) {
    return { kind: "database_error", error: err };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// State transitions

async function transitionAttempt(
  deps: OutboundDeps,
  attemptId: string,
  attemptToken: string,
  fromStatuses: AttemptStatus[],
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { client } = deps;
  try {
    const res = await client
      .from("whatsapp_notification_attempts")
      .update(patch)
      .eq("id", attemptId)
      .eq("attempt_token", attemptToken)
      .in("attempt_status", fromStatuses)
      .select("id");
    if (res.error) return false;
    return Array.isArray(res.data) && res.data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Move attempt planned → sending SOMENTE se a notificação ainda estiver com
 * ownership válida (status='processing', claim_token=att.claim_token, lease
 * vigente). A revalidação é feita atomicamente pela RPC
 * `whatsapp_attempt_mark_sending_atomic` (SECURITY DEFINER + FOR UPDATE):
 *
 *   - ownership válida  → true (transport pode ser chamado)
 *   - ownership perdida → false, tentativa cancelada atomicamente
 *                         (status='cancelled', error_code='ownership_lost')
 *   - attempt já não está planned → false, sem tocar
 *
 * Fecha a corrida entre prepare e sending (callback/recovery/lease/reclaim/
 * cancelamento). Nunca move para sending sem prova fresca de ownership.
 */
export async function markAttemptSending(
  attemptId: string,
  attemptToken: string,
  deps: OutboundDeps,
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = deps.client as any;
  const nowIso = nowOf(deps).toISOString();
  try {
    const rpc = await client.rpc("whatsapp_attempt_mark_sending_atomic", {
      p_attempt_id: attemptId,
      p_attempt_token: attemptToken,
      p_now: nowIso,
    });
    if (rpc.error) {
      logStructured({ event: "mark_sending_rpc_error", attempt_id: attemptId });
      return false;
    }
    const rows = Array.isArray(rpc.data) ? rpc.data : rpc.data ? [rpc.data] : [];
    const outcome = String((rows[0] as { outcome?: string } | undefined)?.outcome ?? "");
    if (outcome === "sending") {
      logStructured({ event: "attempt_sending", attempt_id: attemptId });
      return true;
    }
    if (outcome === "ownership_lost") {
      logStructured({ event: "ownership_lost_before_sending", attempt_id: attemptId });
    } else if (outcome === "state_changed" || outcome === "not_found") {
      logStructured({ event: "attempt_sending_state_changed", attempt_id: attemptId, outcome });
    } else {
      logStructured({ event: "attempt_sending_unknown_outcome", attempt_id: attemptId, outcome });
    }
    return false;
  } catch {
    return false;
  }
}

export async function completeAttemptAccepted(
  attemptId: string,
  attemptToken: string,
  providerMessageId: string,
  httpStatus: number | undefined,
  deps: OutboundDeps,
): Promise<boolean> {
  if (!providerMessageId || String(providerMessageId).trim() === "") return false;
  const nowIso = nowOf(deps).toISOString();
  const ok = await transitionAttempt(deps, attemptId, attemptToken, ["sending"], {
    attempt_status: "accepted",
    provider_message_id: providerMessageId,
    http_status: httpStatus ?? null,
    error_code: null,
    error_category: null,
    retryable: null,
    finished_at: nowIso,
  });
  if (ok) {
    logStructured({
      event: "attempt_accepted",
      attempt_id: attemptId,
      pmid_hash: createHash("sha256").update(providerMessageId).digest("hex").slice(0, 12),
    });
  }
  return ok;
}

export interface RejectedInfo {
  errorCode: string;
  errorCategory: string;
  retryable: boolean;
  httpStatus?: number;
}
export async function completeAttemptRejected(
  attemptId: string,
  attemptToken: string,
  info: RejectedInfo,
  deps: OutboundDeps,
): Promise<boolean> {
  const nowIso = nowOf(deps).toISOString();
  const errorCode = String(info.errorCode ?? "").slice(0, 128);
  const errorCategory = String(info.errorCategory ?? "").slice(0, 64);
  const ok = await transitionAttempt(deps, attemptId, attemptToken, ["sending"], {
    attempt_status: "rejected",
    error_code: errorCode || "unknown",
    error_category: errorCategory || "unknown",
    retryable: Boolean(info.retryable),
    http_status: info.httpStatus ?? null,
    finished_at: nowIso,
  });
  if (ok) {
    logStructured({
      event: "attempt_rejected",
      attempt_id: attemptId,
      error_code: errorCode,
      error_category: errorCategory,
      retryable: Boolean(info.retryable),
    });
  }
  return ok;
}

export async function completeAttemptAmbiguous(
  attemptId: string,
  attemptToken: string,
  reason: string,
  deps: OutboundDeps,
  extra?: { errorCode?: string; httpStatus?: number },
): Promise<boolean> {
  const nowIso = nowOf(deps).toISOString();
  const cleanReason = String(reason ?? "").slice(0, 128) || "unknown";
  const ok = await transitionAttempt(deps, attemptId, attemptToken, ["sending"], {
    attempt_status: "ambiguous",
    error_code: extra?.errorCode ?? cleanReason,
    error_category: "ambiguous",
    // ambiguous NUNCA marca retryable=true. Deixa null para exigir reconciliação.
    retryable: null,
    http_status: extra?.httpStatus ?? null,
    finished_at: nowIso,
  });
  if (ok) {
    logStructured({
      event: "attempt_ambiguous",
      attempt_id: attemptId,
      reason: cleanReason,
    });
  }
  return ok;
}

export async function cancelPlannedAttempt(
  attemptId: string,
  attemptToken: string,
  reason: string,
  deps: OutboundDeps,
): Promise<boolean> {
  const nowIso = nowOf(deps).toISOString();
  const ok = await transitionAttempt(deps, attemptId, attemptToken, ["planned"], {
    attempt_status: "cancelled",
    error_code: String(reason ?? "").slice(0, 128) || "cancelled",
    error_category: "cancelled",
    finished_at: nowIso,
  });
  if (ok) logStructured({ event: "attempt_cancelled", attempt_id: attemptId });
  return ok;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orquestrador técnico (dry) — transport OBRIGATÓRIO como argumento explícito.
// Nesta Fase D.1, NÃO integrado ao dispatcher de produção.

export interface ExecuteInput {
  notificationId: string;
  claimToken: string;
  phoneNumberId: string;
  template: NotificationTemplateRow;
  payload: Record<string, unknown>;
  recipient: string;
  languageOverride?: string;
  timeoutMs?: number;
}

export type ExecuteResult =
  | { kind: "accepted"; attemptId: string; providerMessageId: string }
  | {
      kind: "rejected";
      attemptId: string;
      errorCode: string;
      errorCategory: string;
      retryable: boolean;
    }
  | { kind: "ambiguous"; attemptId: string; reason: string }
  | { kind: "state_changed" }
  | { kind: "invalid_template"; reason: string; param?: string }
  | { kind: "invalid_template_language"; reason: "override_invalid" | "payload_schema_invalid" }
  | { kind: "invalid_recipient"; reason: "empty" | "invalid" }
  | { kind: "active_attempt_exists" }
  | { kind: "quarantined" }
  | { kind: "database_error"; error?: unknown };

/**
 * Serviço de orquestração técnica. Uso: testes e experimentos server-side
 * isolados. NUNCA importado pelo dispatcher em produção nesta fase.
 *
 * `transport` é argumento obrigatório e SEM default — impede uso acidental
 * sem transport injetado (não há transport real implementado).
 */
export async function executeNotificationAttemptDryTechnical(
  input: ExecuteInput,
  deps: OutboundDeps,
  transport: WhatsAppNotificationTransport,
): Promise<ExecuteResult> {
  if (!transport || typeof transport.sendTemplate !== "function") {
    // Não permite fallback silencioso.
    return { kind: "database_error", error: new Error("transport_required") };
  }
  const prepared = await prepareNotificationAttempt(input, deps);
  switch (prepared.kind) {
    case "invalid_recipient":
      logStructured({ event: "invalid_recipient", reason: prepared.reason });
      return prepared;
    case "invalid_template":
      logStructured({
        event: "invalid_template",
        reason: prepared.reason,
        param: prepared.param,
      });
      return { kind: "invalid_template", reason: prepared.reason, param: prepared.param };
    case "invalid_template_language":
      logStructured({ event: "invalid_template_language", reason: prepared.reason });
      return { kind: "invalid_template_language", reason: prepared.reason };
    case "state_changed":
      logStructured({ event: "ownership_lost", notification_id: input.notificationId });
      return { kind: "state_changed" };
    case "active_attempt_exists":
      logStructured({ event: "active_attempt_exists", notification_id: input.notificationId });
      return { kind: "active_attempt_exists" };
    case "quarantined":
      logStructured({ event: "attempt_quarantined", notification_id: input.notificationId });
      return { kind: "quarantined" };
    case "database_error":
      logStructured({ event: "database_error", stage: "prepare" });
      return { kind: "database_error", error: prepared.error };
    case "prepared":
      break;
  }

  const sending = await markAttemptSending(prepared.attemptId, prepared.attemptToken, deps);
  if (!sending) {
    return { kind: "state_changed" };
  }

  let result: TransportResult;
  try {
    result = await transport.sendTemplate({
      phoneNumberId: input.phoneNumberId,
      recipient: prepared.recipientDigits,
      templateName: prepared.request.template.name,
      languageCode: prepared.request.template.language.code,
      components: prepared.request.template.components ?? [],
      clientReference: prepared.clientReference,
      attemptToken: prepared.attemptToken,
      timeoutMs: input.timeoutMs,
    });
  } catch (err) {
    // Erro no transporte não distingue aceite: quarentena.
    await completeAttemptAmbiguous(
      prepared.attemptId,
      prepared.attemptToken,
      "transport_threw",
      deps,
      { errorCode: err instanceof Error ? err.name : "unknown" },
    );
    return { kind: "ambiguous", attemptId: prepared.attemptId, reason: "transport_threw" };
  }

  if (result.kind === "accepted") {
    const ok = await completeAttemptAccepted(
      prepared.attemptId,
      prepared.attemptToken,
      result.providerMessageId,
      result.httpStatus,
      deps,
    );
    if (!ok) {
      // Não conseguiu gravar accepted após provider aceitar → quarentena.
      await completeAttemptAmbiguous(
        prepared.attemptId,
        prepared.attemptToken,
        "persist_after_accept_failed",
        deps,
      );
      return {
        kind: "ambiguous",
        attemptId: prepared.attemptId,
        reason: "persist_after_accept_failed",
      };
    }
    return {
      kind: "accepted",
      attemptId: prepared.attemptId,
      providerMessageId: result.providerMessageId,
    };
  }
  if (result.kind === "rejected") {
    await completeAttemptRejected(
      prepared.attemptId,
      prepared.attemptToken,
      {
        errorCode: result.errorCode,
        errorCategory: result.errorCategory,
        retryable: result.retryable,
        httpStatus: result.httpStatus,
      },
      deps,
    );
    return {
      kind: "rejected",
      attemptId: prepared.attemptId,
      errorCode: result.errorCode,
      errorCategory: result.errorCategory,
      retryable: result.retryable,
    };
  }
  // ambiguous
  await completeAttemptAmbiguous(prepared.attemptId, prepared.attemptToken, result.reason, deps, {
    errorCode: result.errorCode,
    httpStatus: result.httpStatus,
  });
  return { kind: "ambiguous", attemptId: prepared.attemptId, reason: result.reason };
}

// ─────────────────────────────────────────────────────────────────────────────
// Log estruturado — sem PII

function logStructured(entry: Record<string, unknown>): void {
  // Camada mínima; caller pode substituir. Nunca inclui telefone/token/payload.
  try {
    console.log(JSON.stringify({ module: "wa-outbound-d1", ...entry }));
  } catch {
    // no-op
  }
}
