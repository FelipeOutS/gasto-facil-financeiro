import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CONFIRM_PREFIX = "CONFIRMAR GASTO INTELIGENTE";

/** A canonical Brazilian mobile number, without '+'; never guesses identity from a token. */
export function canonicalWhatsAppPhone(raw: string): string | null {
  let phone = String(raw ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (phone.length === 10) phone = `55${phone.slice(0, 2)}9${phone.slice(2)}`;
  else if (phone.length === 11) phone = `55${phone}`;
  else if (phone.startsWith("55") && phone.length === 12) {
    phone = `${phone.slice(0, 4)}9${phone.slice(4)}`;
  }
  return /^55[1-9][0-9]9[0-9]{8}$/.test(phone) ? phone : null;
}

export function createLinkToken(): string {
  const bytes = randomBytes(12);
  return Array.from(bytes, (byte) => ALPHABET[byte & 31]).join("");
}

export function hashLinkToken(token: string): string {
  return createHash("sha256").update(`wa-link-v1:${token.toUpperCase()}`).digest("hex");
}

export function parseLinkConfirmation(text: string): string | null {
  const match = /^CONFIRMAR GASTO INTELIGENTE ([A-HJ-NP-Z2-9]{12})$/i.exec(
    String(text ?? "").trim(),
  );
  return match?.[1]?.toUpperCase() ?? null;
}

export async function beginWhatsAppLinkVerification(args: {
  userId: string;
  phone: string;
  consentVersion: string;
  userAgent?: string;
}): Promise<{
  status: "pending" | "already_active";
  linkId: string;
  phone: string;
  message?: string;
  expiresAt?: string;
}> {
  const phone = canonicalWhatsAppPhone(args.phone);
  if (!phone) throw new Error("Telefone inválido.");
  const token = createLinkToken();
  const { data, error } = await supabaseAdmin.rpc("whatsapp_begin_link_verification", {
    p_user_id: args.userId,
    p_phone: phone,
    p_token_hash: hashLinkToken(token),
    p_consent_version: args.consentVersion,
    p_user_agent: args.userAgent,
  });
  if (error || !data || typeof data !== "object") {
    // The same response covers a number owned by somebody else and all
    // other database errors; never reveal an account or its identity.
    throw new Error("Não foi possível iniciar a confirmação deste número.");
  }
  const result = data as { status?: string; link_id?: string; expires_at?: string };
  if (result.status === "already_active" && result.link_id) {
    return { status: "already_active", linkId: result.link_id, phone };
  }
  if (result.status !== "pending" || !result.link_id || !result.expires_at) {
    throw new Error("Não foi possível iniciar a confirmação deste número.");
  }
  return {
    status: "pending",
    linkId: result.link_id,
    phone,
    message: `${CONFIRM_PREFIX} ${token}`,
    expiresAt: result.expires_at,
  };
}

/** Called only after the Meta webhook's HMAC and payload have been verified. */
export async function completeWhatsAppLinkVerification(args: {
  senderPhone: string;
  text: string;
  externalId: string | null;
}): Promise<"not_confirmation" | "verified" | "invalid" | "retry"> {
  const token = parseLinkConfirmation(args.text);
  if (!token) return "not_confirmation";
  const phone = canonicalWhatsAppPhone(args.senderPhone);
  if (!phone || !args.externalId) return "invalid";
  const { data, error } = await supabaseAdmin.rpc("whatsapp_complete_link_verification", {
    p_phone: phone,
    p_token_hash: hashLinkToken(token),
    p_external_id: args.externalId,
  });
  if (error) return "retry";
  return data === "verified" ? "verified" : "invalid";
}
