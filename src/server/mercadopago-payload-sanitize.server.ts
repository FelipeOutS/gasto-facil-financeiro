/**
 * Prompt 4A — Sanitização de payload do Mercado Pago antes de persistir.
 *
 * NUNCA armazenar: dados completos do pagador, documento, endereço, e-mail,
 * dados de cartão, tokens ou secrets. Guardamos apenas o mínimo auditável
 * mais um hash do corpo bruto para conferência de integridade.
 *
 * Funções puras — testáveis sem banco.
 */
import { createHash } from "crypto";

/** Campos permitidos no payload persistido. */
const ALLOWED_KEYS = [
  "id",
  "status",
  "status_detail",
  "transaction_amount",
  "currency_id",
  "date_created",
  "date_approved",
  "date_last_updated",
  "payment_method_id",
  "payment_type_id",
  "installments",
  "live_mode",
  "external_reference",
  "preference_id",
] as const;

const FORBIDDEN_KEY_PATTERN =
  /(payer|card|token|secret|document|identification|address|email|phone|cpf|cnpj|holder|last_four|first_six|access)/i;

export function sanitizeMercadoPagoPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {};
  const src = payload as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    if (!(key in src)) continue;
    if (FORBIDDEN_KEY_PATTERN.test(key)) continue;
    const value = src[key];
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      out[key] = value;
    }
  }
  return out;
}

/** Hash do corpo bruto — permite auditoria sem guardar PII. */
export function payloadHash(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

/** Máscara para identificadores em relatórios (LGPD). */
export function maskIdentifier(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "—";
  if (v.length <= 8) return `${v.slice(0, 2)}***`;
  return `${v.slice(0, 4)}***${v.slice(-4)}`;
}

/** Erros do provedor em forma segura para log e para payment_events.error_code. */
export function sanitizeErrorCode(input: unknown): string | null {
  if (!input) return null;
  const raw = typeof input === "string" ? input : JSON.stringify(input);
  const code = raw.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 60);
  return code.length > 0 ? code : null;
}
