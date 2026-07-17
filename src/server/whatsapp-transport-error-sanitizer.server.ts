/**
 * WA-C9.2 Fase E.4C — Sanitização determinística de erros de transporte.
 *
 * SERVER-ONLY. Zero PII. Zero secrets. Zero URLs. Zero stack traces.
 *
 * Consumido pelo transport Meta (whatsapp-meta-transport.server.ts) para
 * produzir metadata segura em logs estruturados de falhas de rede.
 *
 * Regras invariantes:
 *  - somente allowlist de campos;
 *  - cada campo tem tamanho máximo pequeno;
 *  - remove CR/LF, controle chars, URLs, "Bearer …", telefones, dígitos longos;
 *  - `error_name` restrito a allowlist ou "Other";
 *  - `cause_code` restrito a `[A-Z0-9_-]{1,32}` uppercase;
 *  - `cause_errno` só se número finito.
 *
 * Não usa JSON.stringify sobre o erro. Não expõe `message` livre.
 */

const ERROR_NAME_ALLOWLIST: ReadonlySet<string> = new Set([
  "AbortError",
  "TimeoutError",
  "TypeError",
  "SyntaxError",
  "RangeError",
  "URIError",
  "Error",
  "FetchError",
  "NetworkError",
  "DOMException",
]);

const MAX_CAUSE_CODE = 32;
const MAX_ERROR_NAME = 32;

const CAUSE_CODE_RE = /^[A-Z0-9_-]{1,32}$/;

export interface SanitizeTransportErrorInput {
  error: unknown;
  timedOut: boolean;
  aborted: boolean;
  responseReceived: boolean;
  durationMs: number;
}

export interface SanitizedTransportError {
  error_name: string;
  cause_code: string | null;
  cause_errno: number | null;
  timed_out: boolean;
  aborted: boolean;
  response_received: boolean;
  duration_ms: number;
}

/**
 * Extrai `name` do erro respeitando allowlist. Nunca retorna a mensagem.
 */
function extractErrorName(err: unknown): string {
  if (err == null) return "Unknown";
  if (typeof err !== "object") return "NonError";
  const name = (err as { name?: unknown }).name;
  if (typeof name !== "string" || name.length === 0) return "Error";
  // Restrict to allowlist; unknown → "Other".
  const trimmed = name.slice(0, MAX_ERROR_NAME);
  return ERROR_NAME_ALLOWLIST.has(trimmed) ? trimmed : "Other";
}

/**
 * Extrai `cause.code` como string curta sanitizada. Ex.: "ECONNRESET",
 * "ETIMEDOUT", "UND_ERR_SOCKET", "ENOTFOUND".
 * Retorna null se ausente ou não passar no regex de segurança.
 */
function extractCauseCode(err: unknown): string | null {
  if (err == null || typeof err !== "object") return null;
  const cause = (err as { cause?: unknown }).cause;
  if (cause == null || typeof cause !== "object") return null;
  const code = (cause as { code?: unknown }).code;
  if (typeof code !== "string" || code.length === 0) return null;
  // Uppercase; alfanumérico + _- somente.
  const up = code.trim().toUpperCase().slice(0, MAX_CAUSE_CODE);
  return CAUSE_CODE_RE.test(up) ? up : null;
}

/**
 * Extrai `cause.errno` como número finito (negativo tipicamente para libuv).
 */
function extractCauseErrno(err: unknown): number | null {
  if (err == null || typeof err !== "object") return null;
  const cause = (err as { cause?: unknown }).cause;
  if (cause == null || typeof cause !== "object") return null;
  const errno = (cause as { errno?: unknown }).errno;
  if (typeof errno === "number" && Number.isFinite(errno) && Math.abs(errno) < 1e9) {
    return errno;
  }
  return null;
}

export function sanitizeTransportError(
  input: SanitizeTransportErrorInput,
): SanitizedTransportError {
  const duration = Number.isFinite(input.durationMs) && input.durationMs >= 0
    ? Math.min(Math.floor(input.durationMs), 24 * 60 * 60 * 1000)
    : 0;
  return {
    error_name: extractErrorName(input.error),
    cause_code: extractCauseCode(input.error),
    cause_errno: extractCauseErrno(input.error),
    timed_out: input.timedOut === true,
    aborted: input.aborted === true,
    response_received: input.responseReceived === true,
    duration_ms: duration,
  };
}
