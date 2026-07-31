/**
 * Prompt 4A — Verificação de assinatura do webhook do Mercado Pago.
 *
 * Funções PURAS (sem banco, sem rede) para permitir teste exaustivo.
 * A rota chama `verifyMercadoPagoSignature` ANTES de qualquer consulta ou
 * escrita no banco: assinatura inválida ⇒ nada é lido, nada é gravado.
 */
import { createHmac, timingSafeEqual } from "crypto";

export type SignatureFailureReason =
  | "missing_signature"
  | "missing_timestamp"
  | "missing_request_id"
  | "missing_data_id"
  | "malformed_signature"
  | "timestamp_too_old"
  | "invalid_signature"
  | "secret_missing";

export interface SignatureVerification {
  ok: boolean;
  reason?: SignatureFailureReason;
  /** HTTP sugerido. Sempre 400/401 — sem detalhes exploráveis no corpo. */
  httpStatus: number;
}

/** Tolerância padrão para replay por timestamp (10 minutos). */
export const SIGNATURE_MAX_AGE_SECONDS = 600;

export function parseSignatureHeader(header: string | null | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const kv of header.split(",")) {
    const [k, ...rest] = kv.split("=");
    const key = (k ?? "").trim();
    if (!key) continue;
    out[key] = rest.join("=").trim();
  }
  return out;
}

export function buildSignatureManifest(input: {
  dataId: string;
  requestId: string;
  ts: string;
}): string {
  return `id:${input.dataId};request-id:${input.requestId};ts:${input.ts};`;
}

export function verifyMercadoPagoSignature(input: {
  signatureHeader: string | null | undefined;
  requestId: string | null | undefined;
  dataId: string | null | undefined;
  secret: string | null | undefined;
  now?: Date;
  maxAgeSeconds?: number;
  requireRequestId?: boolean;
}): SignatureVerification {
  if (!input.secret) return { ok: false, reason: "secret_missing", httpStatus: 503 };
  if (!input.signatureHeader) return { ok: false, reason: "missing_signature", httpStatus: 401 };
  if (!input.dataId) return { ok: false, reason: "missing_data_id", httpStatus: 401 };

  const parts = parseSignatureHeader(input.signatureHeader);
  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts) return { ok: false, reason: "missing_timestamp", httpStatus: 401 };
  if (!v1) return { ok: false, reason: "missing_signature", httpStatus: 401 };
  if (!/^[0-9a-fA-F]+$/.test(v1) || v1.length % 2 !== 0) {
    return { ok: false, reason: "malformed_signature", httpStatus: 401 };
  }

  const requestId = (input.requestId ?? "").trim();
  if (input.requireRequestId !== false && !requestId) {
    return { ok: false, reason: "missing_request_id", httpStatus: 401 };
  }

  const tsNumber = Number(ts);
  if (!Number.isFinite(tsNumber)) {
    return { ok: false, reason: "missing_timestamp", httpStatus: 401 };
  }
  // MP envia ts em milissegundos; aceitamos segundos também.
  const tsMs = ts.length <= 10 ? tsNumber * 1000 : tsNumber;
  const nowMs = (input.now ?? new Date()).getTime();
  const maxAge = (input.maxAgeSeconds ?? SIGNATURE_MAX_AGE_SECONDS) * 1000;
  if (Math.abs(nowMs - tsMs) > maxAge) {
    return { ok: false, reason: "timestamp_too_old", httpStatus: 401 };
  }

  const manifest = buildSignatureManifest({ dataId: String(input.dataId), requestId, ts });
  const expected = createHmac("sha256", input.secret).update(manifest).digest();
  const got = Buffer.from(v1, "hex");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return { ok: false, reason: "invalid_signature", httpStatus: 401 };
  }
  return { ok: true, httpStatus: 200 };
}

/** Assina um manifesto — usado apenas por testes e ferramentas internas. */
export function signMercadoPagoManifest(input: {
  dataId: string;
  requestId: string;
  ts: string;
  secret: string;
}): string {
  const manifest = buildSignatureManifest(input);
  const v1 = createHmac("sha256", input.secret).update(manifest).digest("hex");
  return `ts=${input.ts},v1=${v1}`;
}
