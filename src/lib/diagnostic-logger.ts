import { BUILD_ID } from "./build-id";

export interface ClientErrorReport {
  error_type: string;
  error_name?: string;
  error_message?: string;
  stack_trace?: string;
  resource_url?: string;
  current_route?: string;
  navigator_online?: boolean;
  js_build_id?: string;
  server_build_id?: string;
  recovery_attempted?: boolean;
  sw_state?: string;
  sw_controller_url?: string;
  cache_names?: string;
  user_agent?: string;
}

/** Remove query string, fragmento e qualquer material sensível de uma URL. */
export function sanitizeUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw, "https://placeholder.invalid");
    return `${url.origin === "https://placeholder.invalid" ? "" : url.origin}${url.pathname}`;
  } catch {
    return raw.split("?")[0]?.split("#")[0];
  }
}

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JWT
  /(sb_(publishable|secret)_[A-Za-z0-9_-]+)/g,
  /(bearer\s+)[A-Za-z0-9._-]+/gi,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // e-mail
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, // UUID
  /\b\d{11,14}\b/g, // telefone/CPF/CNPJ
];

/** Sanitiza texto livre (mensagem/stack) antes de sair do navegador. */
export function sanitizeText(raw: string | undefined, max = 4000): string | undefined {
  if (!raw) return undefined;
  let out = raw;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
  out = out.replace(/([?#])[^\s"')]*/g, "$1[redacted]");
  return out.slice(0, max);
}

export function buildDiagnosticPayload(data: ClientErrorReport): Record<string, unknown> {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  return {
    ...data,
    error_message: sanitizeText(data.error_message, 1000),
    stack_trace: sanitizeText(data.stack_trace, 5000),
    resource_url: sanitizeUrl(data.resource_url),
    current_route: sanitizeUrl(data.current_route),
    navigator_online: data.navigator_online ?? nav?.onLine,
    js_build_id: data.js_build_id ?? BUILD_ID,
    sw_state: data.sw_state ?? nav?.serviceWorker?.controller?.state ?? "none",
    sw_controller_url: sanitizeUrl(
      data.sw_controller_url ?? nav?.serviceWorker?.controller?.scriptURL ?? "none",
    ),
    user_agent: data.user_agent ?? nav?.userAgent?.slice(0, 512),
  };
}

/** Envia o diagnóstico. Nunca lança e nunca inclui dados pessoais/financeiros. */
export async function logClientError(data: ClientErrorReport): Promise<void> {
  try {
    const payload = buildDiagnosticPayload(data);
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      payload.cache_names = names.filter((n) => n.startsWith("gi-")).join(",") || "none";
    }
    await fetch("/api/public/client-load-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    /* diagnóstico é best-effort: nunca deve piorar o erro original */
  }
}
