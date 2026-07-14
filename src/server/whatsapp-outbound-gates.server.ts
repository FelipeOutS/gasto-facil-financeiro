/**
 * WA-C9.2 Fase D.2B.1 — Helper puro da dupla trava (SEM call site operacional).
 *
 * Servidor-only. Nesta fase, o helper NÃO é chamado por dispatcher, webhook
 * ou rota. É usado apenas por testes para validar a política de gating.
 *
 * A avaliação exige TODOS os gates simultaneamente. Basta um falhar para
 * retornar `{ allowed: false, reasons }`. Não constrói transport. Não lê
 * token. Não chama fetch.
 */
import { getWhatsAppGraphVersion } from "@/server/whatsapp-graph-version.server";

export type OutboundGateReason =
  | "whatsapp_disabled"
  | "canary_disabled"
  | "user_not_in_canary"
  | "dispatch_disabled"
  | "outbound_http_disabled"
  | "graph_version_missing"
  | "graph_version_invalid"
  | "graph_version_unsupported"
  | "phone_number_id_missing"
  | "phone_number_id_invalid"
  | "access_token_missing";

export type OutboundGateResult =
  | { allowed: true }
  | { allowed: false; reasons: OutboundGateReason[] };

export interface OutboundGateInput {
  /** Se null, o helper considera "sem usuário" — canary é ignorado. */
  userId?: string | null;
  /**
   * Lista opcional de usuários autorizados no canary. Se omitida, o helper
   * lê de `WHATSAPP_CANARY_USERS` (CSV). Se ambos ausentes → considera vazio.
   */
  canaryUserIds?: readonly string[];
  /** Overrides de env exclusivos para testes. */
  env?: Partial<Record<
    | "WHATSAPP_ENABLED"
    | "WHATSAPP_CANARY_ENABLED"
    | "WHATSAPP_DISPATCH_ENABLED"
    | "WHATSAPP_OUTBOUND_HTTP_ENABLED"
    | "WHATSAPP_PHONE_NUMBER_ID"
    | "WHATSAPP_ACCESS_TOKEN"
    | "WHATSAPP_CANARY_USERS",
    string | undefined
  >>;
}

/**
 * Parser estrito: aceita SOMENTE a string literal "true" (case-insensitive).
 * Rejeita "1", "yes", "on", "enabled", string vazia, undefined.
 */
function parseStrictBool(v: string | undefined): boolean {
  if (typeof v !== "string") return false;
  return v.trim().toLowerCase() === "true";
}

const DIGITS_ONLY = /^[0-9]+$/;

function envOf(input: OutboundGateInput, key: keyof NonNullable<OutboundGateInput["env"]>): string | undefined {
  const local = input.env?.[key];
  if (local !== undefined) return local;
  return process.env[key as string];
}

export function isOutboundHttpAllowed(input: OutboundGateInput = {}): OutboundGateResult {
  const reasons: OutboundGateReason[] = [];

  if (!parseStrictBool(envOf(input, "WHATSAPP_ENABLED"))) reasons.push("whatsapp_disabled");
  if (!parseStrictBool(envOf(input, "WHATSAPP_CANARY_ENABLED"))) reasons.push("canary_disabled");
  if (!parseStrictBool(envOf(input, "WHATSAPP_DISPATCH_ENABLED"))) reasons.push("dispatch_disabled");
  if (!parseStrictBool(envOf(input, "WHATSAPP_OUTBOUND_HTTP_ENABLED"))) reasons.push("outbound_http_disabled");

  // Canary user gate: se um userId foi passado, precisa estar na lista.
  if (input.userId !== undefined && input.userId !== null && input.userId !== "") {
    const list: readonly string[] =
      input.canaryUserIds ??
      (envOf(input, "WHATSAPP_CANARY_USERS") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    if (!list.includes(input.userId)) reasons.push("user_not_in_canary");
  }

  // Restringe leitura de env de token/phone e Graph version.
  const version = getWhatsAppGraphVersion();
  if (!version.ok) {
    reasons.push(`graph_version_${version.reason}` as OutboundGateReason);
  }

  const phoneNumberId = envOf(input, "WHATSAPP_PHONE_NUMBER_ID");
  if (phoneNumberId == null || phoneNumberId === "") {
    reasons.push("phone_number_id_missing");
  } else if (!DIGITS_ONLY.test(phoneNumberId)) {
    reasons.push("phone_number_id_invalid");
  }

  const accessToken = envOf(input, "WHATSAPP_ACCESS_TOKEN");
  if (accessToken == null || accessToken === "") {
    reasons.push("access_token_missing");
  }

  if (reasons.length > 0) return { allowed: false, reasons };
  return { allowed: true };
}
