/**
 * Helpers para mensagens de erro amigáveis ao usuário.
 *
 * Objetivo: reduzir mensagens genéricas ("Erro ao salvar", "Falha ao
 * processar") e detectar com segurança os tipos mais comuns de erro
 * sem expor stack trace, payload de API ou detalhes técnicos.
 *
 * Para erros 403 de plano premium, prefira `isPremiumApiError` /
 * `usePremiumApiGate` de `@/lib/premium-errors`. Este helper trata
 * apenas erros "comuns" (rede, validação, servidor, sessão expirada).
 */

export type ErrorLike = unknown;

export function getErrorStatus(err: ErrorLike): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as Record<string, unknown>;
  const candidates = [e.status, e.statusCode, e.code];
  for (const c of candidates) {
    if (typeof c === "number" && c >= 100 && c < 600) return c;
    if (typeof c === "string" && /^\d{3}$/.test(c)) return Number(c);
  }
  return null;
}

function getErrorMessage(err: ErrorLike): string {
  if (!err) return "";
  if (err instanceof Error) return err.message ?? "";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
  }
  return "";
}

export function isNetworkError(err: ErrorLike): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = getErrorMessage(err).toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network error") ||
    msg.includes("load failed") ||
    msg.includes("offline") ||
    msg.includes("err_network") ||
    msg.includes("err_internet")
  );
}

export function isAuthExpiredError(err: ErrorLike): boolean {
  const s = getErrorStatus(err);
  if (s === 401) return true;
  const msg = getErrorMessage(err).toLowerCase();
  return (
    msg.includes("jwt expired") ||
    msg.includes("session expired") ||
    msg.includes("invalid jwt") ||
    msg.includes("not authenticated")
  );
}

export function isServerError(err: ErrorLike): boolean {
  const s = getErrorStatus(err);
  return typeof s === "number" && s >= 500;
}

export function isValidationError(err: ErrorLike): boolean {
  const s = getErrorStatus(err);
  if (s === 400 || s === 422) return true;
  const msg = getErrorMessage(err).toLowerCase();
  return msg.includes("validation") || msg.includes("invalid input");
}

/**
 * Tradução do erro para uma chave i18n em `common.errors.*`.
 * Retorna a chave (string) — chame `t(key)` no consumidor.
 *
 * `fallbackKey` é usada quando nenhum padrão técnico é reconhecido,
 * permitindo que cada fluxo defina sua mensagem contextual (ex.:
 * "errors.save", "errors.load", "errors.delete").
 */
export function getFriendlyErrorKey(
  err: ErrorLike,
  fallbackKey = "errors.server",
): string {
  if (isAuthExpiredError(err)) return "errors.authExpired";
  if (isNetworkError(err)) return "errors.network";
  if (isServerError(err)) return "errors.server";
  return fallbackKey;
}
