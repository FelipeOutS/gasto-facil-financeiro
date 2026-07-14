/**
 * WA-C9.2 Fase D.2B.1 — Transporte HTTP real da Meta (ISOLADO).
 *
 * SERVER-ONLY. NÃO importado pelo dispatcher, webhook, rotas públicas ou browser.
 * Nesta fase, o único chamador é o suite de testes com `fetchFn` injetado.
 *
 * Regras:
 *  - Uma única chamada `fetch` por `sendTemplate`. Zero retry interno.
 *  - Timeout via AbortController; `clearTimeout` em `finally`.
 *  - Leitura da resposta limitada (default 64 KB). Body bruto nunca persistido.
 *  - Classificação conservadora: accepted, rejected, ambiguous.
 *  - Fail-closed: sem env → factory retorna `{ ok: false, reason }`. Zero fetch.
 *  - Nenhuma leitura de env no import-time. Nenhum singleton com token.
 *  - Token só em `Authorization: Bearer`. Nunca em URL/query/body/log/erro.
 *  - `biz_opaque_callback_data` = client_reference já produzida pela D.1.
 *
 * Não altera notification/attempt: apenas retorna o resultado ao chamador.
 */
import {
  buildWhatsAppGraphUrl,
  getWhatsAppGraphVersion,
} from "@/server/whatsapp-graph-version.server";
import type {
  TransportContext,
  TransportResult,
  TransportSendInput,
  WhatsAppNotificationTransport,
} from "@/server/whatsapp-outbound-adapter.server";
import { buildWhatsAppTemplateRequest } from "@/server/whatsapp-outbound-adapter.server";

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de segurança
export const META_TRANSPORT_DEFAULTS = Object.freeze({
  TIMEOUT_MS_DEFAULT: 15_000,
  TIMEOUT_MS_MIN: 1_000,
  TIMEOUT_MS_MAX: 30_000,
  RESPONSE_MAX_BYTES: 64 * 1024,
  ERROR_TITLE_MAX: 200,
  ERROR_MESSAGE_MAX: 500,
  ERROR_CODE_MAX: 64,
});

const CATEGORY_ALLOWLIST = new Set([
  "authentication",
  "configuration",
  "permanent",
  "rate_limit",
  "retryable",
  "unknown",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Tipos públicos

export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<MetaFetchResponse>;

/**
 * Subconjunto mínimo de `Response` de que o transport depende. Evita expor
 * o objeto Response cru para o chamador; simplifica mocks.
 */
export interface MetaFetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  body?: ReadableStream<Uint8Array> | null;
  text?: () => Promise<string>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}

export interface MetaTransportLogger {
  (entry: Record<string, unknown>): void;
}

export interface MetaTransportConfig {
  graphApiVersion: string; // já validado pela factory
  phoneNumberId: string; // apenas dígitos
  accessToken: string; // NUNCA logar / persistir
  timeoutMs: number;
  fetchFn: FetchLike;
  logger?: MetaTransportLogger;
  responseMaxBytes?: number;
  now?: () => number;
}

export type MetaTransportFactoryResult =
  | { ok: true; transport: WhatsAppNotificationTransport }
  | {
      ok: false;
      reason:
        | "graph_version_missing"
        | "graph_version_invalid"
        | "graph_version_unsupported"
        | "phone_number_id_missing"
        | "phone_number_id_invalid"
        | "access_token_missing"
        | "timeout_invalid";
    };

export interface MetaTransportFactoryInput {
  /** Sobrescreve process.env.WHATSAPP_PHONE_NUMBER_ID quando presente (testes). */
  phoneNumberId?: string;
  /** Sobrescreve process.env.WHATSAPP_ACCESS_TOKEN quando presente (testes). */
  accessToken?: string;
  timeoutMs?: number;
  fetchFn?: FetchLike;
  logger?: MetaTransportLogger;
  responseMaxBytes?: number;
  now?: () => number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sanitização

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const DIGITS_ONLY = /^[0-9]+$/;

function sanitizeText(v: unknown, max: number): string | null {
  if (v == null) return null;
  const raw = typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
  if (raw == null) return null;
  const cleaned = raw.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, max);
}

function shortHash(s: string, len = 12): string {
  // não-cripto; apenas máscara para log.
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `${hex.slice(0, len)}`;
}

function maskPmid(pmid: string): string {
  if (!pmid) return "";
  if (pmid.length <= 6) return "***";
  return `${pmid.slice(0, 3)}…${pmid.slice(-3)}`;
}

function maskRef(ref: string): string {
  if (!ref) return "";
  return ref.length <= 8 ? "***" : `${ref.slice(0, 4)}…${ref.slice(-2)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory server-only

function isValidTimeout(t: unknown): t is number {
  return (
    typeof t === "number" &&
    Number.isFinite(t) &&
    t >= META_TRANSPORT_DEFAULTS.TIMEOUT_MS_MIN &&
    t <= META_TRANSPORT_DEFAULTS.TIMEOUT_MS_MAX
  );
}

/**
 * Server-only factory. Lê env SOMENTE quando invocada. Nunca no import-time.
 * Nunca retorna token no resultado.
 */
export function createMetaWhatsAppNotificationTransport(
  input: MetaTransportFactoryInput = {},
): MetaTransportFactoryResult {
  const version = getWhatsAppGraphVersion();
  if (!version.ok) {
    return { ok: false, reason: `graph_version_${version.reason}` as const };
  }

  const phoneNumberId =
    "phoneNumberId" in input ? input.phoneNumberId : process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (phoneNumberId == null || phoneNumberId === "") {
    return { ok: false, reason: "phone_number_id_missing" };
  }
  if (typeof phoneNumberId !== "string" || !DIGITS_ONLY.test(phoneNumberId)) {
    return { ok: false, reason: "phone_number_id_invalid" };
  }

  const accessToken =
    "accessToken" in input ? input.accessToken : process.env.WHATSAPP_ACCESS_TOKEN;
  if (accessToken == null || accessToken === "" || typeof accessToken !== "string") {
    return { ok: false, reason: "access_token_missing" };
  }

  const timeoutMs =
    input.timeoutMs === undefined
      ? META_TRANSPORT_DEFAULTS.TIMEOUT_MS_DEFAULT
      : input.timeoutMs;
  if (!isValidTimeout(timeoutMs)) {
    return { ok: false, reason: "timeout_invalid" };
  }

  const fetchFn: FetchLike | undefined =
    input.fetchFn ??
    (typeof globalThis.fetch === "function"
      ? ((globalThis.fetch as unknown) as FetchLike)
      : undefined);
  if (!fetchFn) {
    // Sem fetch injetado nem global disponível: falha fechada como configuração.
    return { ok: false, reason: "timeout_invalid" };
  }

  const cfg: MetaTransportConfig = {
    graphApiVersion: version.version,
    phoneNumberId,
    accessToken,
    timeoutMs,
    fetchFn,
    logger: input.logger,
    responseMaxBytes:
      input.responseMaxBytes ?? META_TRANSPORT_DEFAULTS.RESPONSE_MAX_BYTES,
    now: input.now,
  };

  return { ok: true, transport: new MetaWhatsAppNotificationTransport(cfg) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Transport real

export class MetaWhatsAppNotificationTransport
  implements WhatsAppNotificationTransport
{
  // NUNCA torne `accessToken` público. NUNCA serialize esta classe.
  readonly #accessToken: string;
  readonly #phoneNumberId: string;
  readonly #timeoutMs: number;
  readonly #fetchFn: FetchLike;
  readonly #log: MetaTransportLogger;
  readonly #responseMaxBytes: number;
  readonly #now: () => number;

  constructor(cfg: MetaTransportConfig) {
    if (!cfg || typeof cfg !== "object") throw new Error("meta_transport_config_required");
    if (!cfg.graphApiVersion) throw new Error("meta_transport_graph_version_required");
    if (!cfg.phoneNumberId || !DIGITS_ONLY.test(cfg.phoneNumberId))
      throw new Error("meta_transport_phone_number_id_invalid");
    if (!cfg.accessToken) throw new Error("meta_transport_access_token_required");
    if (!isValidTimeout(cfg.timeoutMs))
      throw new Error("meta_transport_timeout_invalid");
    if (typeof cfg.fetchFn !== "function")
      throw new Error("meta_transport_fetch_required");
    this.#accessToken = cfg.accessToken;
    this.#phoneNumberId = cfg.phoneNumberId;
    this.#timeoutMs = cfg.timeoutMs;
    this.#fetchFn = cfg.fetchFn;
    this.#log = cfg.logger ?? defaultLogger;
    this.#responseMaxBytes =
      cfg.responseMaxBytes ?? META_TRANSPORT_DEFAULTS.RESPONSE_MAX_BYTES;
    this.#now = cfg.now ?? (() => Date.now());
  }

  /** Não expor token via serialização acidental. */
  toJSON(): Record<string, unknown> {
    return {
      kind: "MetaWhatsAppNotificationTransport",
      phoneNumberIdMasked: this.#phoneNumberId.slice(-4),
      timeoutMs: this.#timeoutMs,
    };
  }

  async sendTemplate(
    request: TransportSendInput,
    _context?: TransportContext,
  ): Promise<TransportResult> {
    const startedAt = this.#now();

    // Endpoint via builder fechado. Impossível SSRF.
    const urlResult = buildWhatsAppGraphUrl({
      kind: "messages",
      phoneNumberId: this.#phoneNumberId,
    });
    if (!urlResult.ok) {
      this.#log({
        event: "meta_transport_configuration_error",
        config_reason: urlResult.reason,
      });
      return {
        kind: "ambiguous",
        reason: "configuration_error",
      };
    }

    // Body via builder D.1 (biz_opaque_callback_data = client_reference).
    const payload = buildWhatsAppTemplateRequest({
      recipientDigits: request.recipient,
      templateName: request.templateName,
      languageCode: request.languageCode,
      components: request.components,
      clientReference: request.clientReference,
    });

    // Guardas defensivos (o builder D.1 já os garante, mas replicamos:
    // token nunca deve entrar no body).
    if ("access_token" in (payload as unknown as Record<string, unknown>)) {
      this.#log({ event: "meta_transport_internal_error", reason: "body_contains_token" });
      return { kind: "ambiguous", reason: "internal_error" };
    }

    const controller = new AbortController();
    const externalSignal = request.signal;
    const abortFromExternal = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", abortFromExternal);
    }
    const timeoutMs = request.timeoutMs && isValidTimeout(request.timeoutMs)
      ? request.timeoutMs
      : this.#timeoutMs;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    this.#log({
      event: "meta_request_started",
      attempt_id: undefined,
      request_hash_short: shortHash(payload.template.name + payload.to),
      client_reference_masked: maskRef(request.clientReference),
      timeout_ms: timeoutMs,
    });

    let response: MetaFetchResponse | undefined;
    let fetchError: unknown;
    try {
      response = await this.#fetchFn(urlResult.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      fetchError = err;
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener("abort", abortFromExternal);
    }

    const durationMs = Math.max(0, this.#now() - startedAt);

    if (fetchError !== undefined || !response) {
      const errName = fetchError instanceof Error ? fetchError.name : "unknown";
      if (timedOut || errName === "AbortError") {
        this.#log({ event: "meta_request_timeout", duration_ms: durationMs });
        return {
          kind: "ambiguous",
          reason: timedOut ? "timeout" : "aborted",
        };
      }
      this.#log({
        event: "meta_request_ambiguous",
        duration_ms: durationMs,
        error_name: errName,
      });
      return { kind: "ambiguous", reason: "network_error" };
    }

    const status = response.status;

    // Ler body com limite estrito.
    const contentLengthHeader = response.headers.get("content-length");
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;
    if (Number.isFinite(contentLength) && contentLength > this.#responseMaxBytes) {
      this.#log({
        event: "meta_response_too_large",
        http_status: status,
        content_length: contentLength,
      });
      return { kind: "ambiguous", reason: "response_too_large", httpStatus: status };
    }

    let rawText: string;
    try {
      rawText = await this.#readLimited(response);
    } catch (err) {
      const name = err instanceof Error ? err.name : "unknown";
      if (name === "MetaResponseTooLarge") {
        this.#log({ event: "meta_response_too_large", http_status: status });
        return { kind: "ambiguous", reason: "response_too_large", httpStatus: status };
      }
      this.#log({ event: "meta_response_invalid", http_status: status, error_name: name });
      return { kind: "ambiguous", reason: "response_read_failed", httpStatus: status };
    }

    return this.#classify(status, rawText, durationMs);
  }

  async #readLimited(response: MetaFetchResponse): Promise<string> {
    const max = this.#responseMaxBytes;
    // Preferir stream para permitir corte cedo.
    if (response.body && typeof (response.body as ReadableStream).getReader === "function") {
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > max) {
            try { await reader.cancel(); } catch { /* no-op */ }
            const err = new Error("response_too_large");
            err.name = "MetaResponseTooLarge";
            throw err;
          }
          chunks.push(value);
        }
      }
      const merged = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
      return new TextDecoder("utf-8", { fatal: false }).decode(merged);
    }
    if (typeof response.arrayBuffer === "function") {
      const buf = await response.arrayBuffer();
      if (buf.byteLength > max) {
        const err = new Error("response_too_large");
        err.name = "MetaResponseTooLarge";
        throw err;
      }
      return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(buf));
    }
    if (typeof response.text === "function") {
      const s = await response.text();
      if (s.length > max) {
        const err = new Error("response_too_large");
        err.name = "MetaResponseTooLarge";
        throw err;
      }
      return s;
    }
    return "";
  }

  #classify(status: number, rawText: string, durationMs: number): TransportResult {
    const parsed = parseJsonSafe(rawText);

    if (status >= 200 && status < 300) {
      if (!parsed.ok) {
        this.#log({ event: "meta_response_invalid", http_status: status, duration_ms: durationMs });
        return { kind: "ambiguous", reason: "invalid_json", httpStatus: status };
      }
      const pmid = extractProviderMessageId(parsed.value);
      if (!pmid) {
        this.#log({ event: "meta_request_ambiguous", http_status: status, duration_ms: durationMs, reason: "missing_pmid" });
        return { kind: "ambiguous", reason: "missing_pmid", httpStatus: status };
      }
      // 2xx com erro estruturado presente: também tratamos como ambiguous.
      if (extractMetaError(parsed.value)) {
        this.#log({ event: "meta_request_ambiguous", http_status: status, duration_ms: durationMs, reason: "2xx_with_error" });
        return { kind: "ambiguous", reason: "2xx_with_error", httpStatus: status };
      }
      this.#log({
        event: "meta_request_accepted",
        http_status: status,
        duration_ms: durationMs,
        pmid_masked: maskPmid(pmid),
      });
      return { kind: "accepted", providerMessageId: pmid, httpStatus: status };
    }

    // Faixa de erro — precisamos de erro estruturado para classificar rejected.
    const metaError = parsed.ok ? extractMetaError(parsed.value) : null;
    if (metaError) {
      const category = categorizeStatus(status, metaError.code);
      // 5xx sem prova conclusiva de rejeição pré-envio → ambiguous.
      if (status >= 500) {
        this.#log({ event: "meta_request_ambiguous", http_status: status, duration_ms: durationMs, reason: "5xx_inconclusive" });
        return { kind: "ambiguous", reason: "5xx_inconclusive", httpStatus: status, errorCode: metaError.code };
      }
      this.#log({
        event: "meta_request_rejected",
        http_status: status,
        error_code: metaError.code,
        error_category: category.category,
        retryable: category.retryable,
        duration_ms: durationMs,
      });
      return {
        kind: "rejected",
        httpStatus: status,
        errorCode: metaError.code,
        errorCategory: category.category,
        retryable: category.retryable,
      };
    }

    // Sem erro estruturado.
    if (status === 401) {
      this.#log({ event: "meta_request_rejected", http_status: status, error_category: "authentication", duration_ms: durationMs });
      return { kind: "rejected", httpStatus: status, errorCode: "http_401", errorCategory: "authentication", retryable: false };
    }
    if (status === 403) {
      this.#log({ event: "meta_request_rejected", http_status: status, error_category: "configuration", duration_ms: durationMs });
      return { kind: "rejected", httpStatus: status, errorCode: "http_403", errorCategory: "configuration", retryable: false };
    }
    if (status === 429) {
      this.#log({ event: "meta_request_rejected", http_status: status, error_category: "rate_limit", duration_ms: durationMs });
      return { kind: "rejected", httpStatus: status, errorCode: "http_429", errorCategory: "rate_limit", retryable: true };
    }
    // 400/404/5xx sem estrutura → ambiguous (conservador).
    this.#log({ event: "meta_request_ambiguous", http_status: status, duration_ms: durationMs, reason: "unstructured_error" });
    return { kind: "ambiguous", reason: "unstructured_error", httpStatus: status };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser + classificador — puros e testáveis

export function parseJsonSafe(text: string):
  | { ok: true; value: unknown }
  | { ok: false; reason: "empty" | "invalid_json" } {
  if (text == null || text === "") return { ok: false, reason: "empty" };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

export function extractProviderMessageId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const messages = (body as Record<string, unknown>).messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const first = messages[0];
  if (!first || typeof first !== "object") return null;
  const id = (first as Record<string, unknown>).id;
  if (typeof id !== "string") return null;
  const cleaned = id.replace(CONTROL_CHARS, "").trim();
  if (!cleaned) return null;
  if (cleaned.length > 256) return null;
  return cleaned;
}

export interface MetaErrorInfo {
  code: string;
  subcode: string | null;
  type: string | null;
  title: string | null;
  message: string | null;
}

export function extractMetaError(body: unknown): MetaErrorInfo | null {
  if (!body || typeof body !== "object") return null;
  const errRaw = (body as Record<string, unknown>).error;
  if (!errRaw || typeof errRaw !== "object") return null;
  const err = errRaw as Record<string, unknown>;

  const codeRaw = err.code;
  const codeStr =
    typeof codeRaw === "number" && Number.isFinite(codeRaw)
      ? String(Math.trunc(codeRaw))
      : typeof codeRaw === "string"
        ? codeRaw
        : null;
  const code = sanitizeText(codeStr, META_TRANSPORT_DEFAULTS.ERROR_CODE_MAX) ?? "unknown";

  const subcodeRaw = err.error_subcode ?? err.subcode;
  const subcode =
    typeof subcodeRaw === "number" && Number.isFinite(subcodeRaw)
      ? String(Math.trunc(subcodeRaw))
      : typeof subcodeRaw === "string"
        ? sanitizeText(subcodeRaw, META_TRANSPORT_DEFAULTS.ERROR_CODE_MAX)
        : null;

  const type = sanitizeText(err.type, META_TRANSPORT_DEFAULTS.ERROR_CODE_MAX);
  const title = sanitizeText(
    err.error_user_title ?? err.title,
    META_TRANSPORT_DEFAULTS.ERROR_TITLE_MAX,
  );
  const message = sanitizeText(
    err.message ?? err.error_user_msg,
    META_TRANSPORT_DEFAULTS.ERROR_MESSAGE_MAX,
  );

  return { code, subcode, type, title, message };
}

export function categorizeStatus(
  httpStatus: number,
  _errorCode: string,
): { category: string; retryable: boolean } {
  let category = "unknown";
  let retryable = false;
  if (httpStatus === 401) {
    category = "authentication";
    retryable = false;
  } else if (httpStatus === 403) {
    category = "configuration";
    retryable = false;
  } else if (httpStatus === 404) {
    category = "configuration";
    retryable = false;
  } else if (httpStatus === 429) {
    category = "rate_limit";
    retryable = true;
  } else if (httpStatus >= 400 && httpStatus < 500) {
    category = "permanent";
    retryable = false;
  } else if (httpStatus >= 500) {
    category = "retryable";
    retryable = true;
  }
  if (!CATEGORY_ALLOWLIST.has(category)) category = "unknown";
  return { category, retryable };
}

// ─────────────────────────────────────────────────────────────────────────────
// Logger padrão sem PII

const defaultLogger: MetaTransportLogger = (entry) => {
  try {
    console.log(JSON.stringify({ module: "wa-meta-transport-d2b1", ...entry }));
  } catch {
    /* no-op */
  }
};
