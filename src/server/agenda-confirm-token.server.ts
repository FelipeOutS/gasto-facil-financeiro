/**
 * Token assinado do botão "Confirmar cancelamento" da Agenda no WhatsApp.
 *
 * Prova que a confirmação foi EMITIDA pelo servidor (askCancel) para este
 * usuário, este item e esta ação, dentro da validade. Não basta conhecer o id
 * do item: sem a assinatura o botão é recusado.
 *
 * Chave: subchave HKDF (domínio "gi-agenda-cancel-confirm-v1") derivada do
 * segredo server-side já existente WHATSAPP_BOLETO_FINGERPRINT_SECRET — nunca
 * a chave crua, nunca exposta. Sem o segredo → falha fechada (nada é cancelado).
 */
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

export const CANCEL_TTL_MIN = 30;

function key(): Buffer | null {
  const master = process.env.WHATSAPP_BOLETO_FINGERPRINT_SECRET;
  if (!master || master.length < 16) return null;
  return Buffer.from(hkdfSync("sha256", master, "gi-agenda", "gi-agenda-cancel-confirm-v1", 32));
}

function mac(k: Buffer, userId: string, itemId: string, issuedMin: number): string {
  return createHmac("sha256", k).update(`cancel|${userId}|${itemId}|${issuedMin}`).digest("base64url").slice(0, 22);
}

/** Retorna "<min36>:<assinatura>" ou null se não houver segredo. */
export function signCancel(userId: string, itemId: string, now: Date): string | null {
  const k = key();
  if (!k) return null;
  const m = Math.floor(now.getTime() / 60_000);
  return `${m.toString(36)}:${mac(k, userId, itemId, m)}`;
}

export type CancelCheck = "ok" | "expired" | "invalid" | "unavailable";

export function verifyCancel(userId: string, itemId: string, issuedMin: number, sig: string, now: Date): CancelCheck {
  const k = key();
  if (!k) return "unavailable";
  const want = Buffer.from(mac(k, userId, itemId, issuedMin));
  const got = Buffer.from(sig ?? "");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return "invalid";
  const age = Math.floor(now.getTime() / 60_000) - issuedMin;
  return age >= 0 && age <= CANCEL_TTL_MIN ? "ok" : "expired";
}
