import { createHash } from "node:crypto";

/** Stable primary key: concurrent INSERTs of one Meta message cannot create two rows. */
export function financialIdForWhatsAppMessage(
  userId: string,
  externalId: string,
  kind: "expense" | "income_single",
): string {
  if (!userId || !externalId) throw new Error("Missing financial idempotency input");
  const bytes = createHash("sha256")
    .update(`gasto-inteligente:whatsapp-financial:v1:${kind}:${userId}:${externalId}`)
    .digest();
  const id = Buffer.from(bytes.subarray(0, 16));
  id[6] = (id[6] & 0x0f) | 0x50;
  id[8] = (id[8] & 0x3f) | 0x80;
  const hex = id.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
