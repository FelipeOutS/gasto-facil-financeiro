import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { hashRecipient } from "./whatsapp-outbound-log.server";
import { classifySendResult, safeSend, type SendResult } from "./whatsapp-reply-delivery.server";

// Candidate SQL + independent encryption key + explicit release review required.
export const REPLY_OUTBOX_RELEASE_AUTHORIZED = false;
export const isReplyOutboxEnabled = () =>
  REPLY_OUTBOX_RELEASE_AUTHORIZED && process.env.WHATSAPP_REPLY_OUTBOX_ENABLED === "true";
export type ReplySnapshot = {
  text: string;
  interactive?: Record<string, unknown>;
  cta?: { body: string; buttonText: string; url: string };
};
type RpcResult = { data: unknown; error: unknown };
export type ReplyRpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult> };
export type ReplyClaim = {
  id: string;
  user_id: string;
  inbound_external_id: string;
  claim_token: string;
  payload_ciphertext: string;
};
export type ReplyDeps = {
  client: ReplyRpc;
  key: string;
  authorize: (userId: string, phone: string) => Promise<boolean>;
  send: (phone: string, snapshot: ReplySnapshot, reference: string) => Promise<SendResult>;
};
function keyBytes(key: string) {
  if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new Error("reply_key_invalid");
  return Buffer.from(key, "hex");
}
export function sealReply(snapshot: ReplySnapshot, key: string, identity: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  cipher.setAAD(Buffer.from(identity));
  const body = Buffer.concat([cipher.update(JSON.stringify(snapshot), "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    body.toString("base64"),
  ].join(".");
}
export function openReply(value: string, key: string, identity: string): ReplySnapshot {
  const [version, iv, tag, body, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !body || extra) throw new Error("reply_cipher_invalid");
  const cipher = createDecipheriv("aes-256-gcm", keyBytes(key), Buffer.from(iv, "base64"));
  cipher.setAAD(Buffer.from(identity));
  cipher.setAuthTag(Buffer.from(tag, "base64"));
  const snapshot = JSON.parse(
    Buffer.concat([cipher.update(Buffer.from(body, "base64")), cipher.final()]).toString("utf8"),
  );
  if (!snapshot || typeof snapshot.text !== "string" || snapshot.text.length > 16000)
    throw new Error("reply_payload_invalid");
  return snapshot;
}
export async function enqueueReply(
  input: {
    userId: string;
    externalId: string;
    phone: string;
    receivedAt: Date;
    snapshot: ReplySnapshot;
  },
  deps: ReplyDeps,
): Promise<string | null> {
  if (!(await deps.authorize(input.userId, input.phone))) return null;
  const ciphertext = sealReply(input.snapshot, deps.key, `${input.userId}:${input.externalId}`);
  const r = await deps.client.rpc("wa_reply_enqueue", {
    p_user: input.userId,
    p_external: input.externalId,
    p_phone_hash: hashRecipient(input.phone),
    p_cipher: ciphertext,
    p_expires: new Date(input.receivedAt.getTime() + 24 * 3600_000).toISOString(),
  });
  if (r.error) throw new Error("reply_enqueue_failed");
  return typeof r.data === "string" ? r.data : null;
}
// Invoked by the inbound handler or an explicitly authorized administrative
// recovery. Never calls the financial parser, and never generates a new reply.
export async function dispatchStoredReply(
  id: string,
  userId: string,
  phone: string,
  deps: ReplyDeps,
) {
  if (!(await deps.authorize(userId, phone))) return "blocked";
  const claim = await deps.client.rpc("wa_reply_claim", {
    p_id: id,
    p_user: userId,
    p_phone: phone,
  });
  if (claim.error) throw new Error("reply_claim_failed");
  const row = (Array.isArray(claim.data) ? claim.data[0] : null) as ReplyClaim | null;
  if (!row) return "not_claimed";
  let state = "cancelled";
  let provider: string | null = null;
  try {
    const snapshot = openReply(
      row.payload_ciphertext,
      deps.key,
      `${userId}:${row.inbound_external_id}`,
    );
    if (row.user_id !== userId || !(await deps.authorize(userId, phone))) state = "cancelled";
    else {
      const result = await safeSend(() => deps.send(phone, snapshot, `wa_reply:${id}`));
      const classification = classifySendResult(result);
      provider = result.providerMessageId ?? null;
      state =
        classification === "accepted" && provider
          ? "accepted"
          : classification === "permanent"
            ? "rejected"
            : "ambiguous";
    }
  } catch {
    state = "cancelled";
  } // No HTTP when decryption/authorization fails.
  const finish = await deps.client.rpc("wa_reply_finish", {
    p_id: id,
    p_token: row.claim_token,
    p_state: state,
    p_provider: provider,
  });
  if (finish.error) throw new Error("reply_finish_failed"); // lease will quarantine; never retry send.
  return state;
}
export async function reconcileReply(
  reference: string | null,
  provider: string,
  status: string,
  client: ReplyRpc,
) {
  const match = /^wa_reply:([a-f0-9-]{36})$/.exec(reference ?? "");
  if (!match) return;
  const r = await client.rpc("wa_reply_reconcile", {
    p_id: match[1],
    p_provider: provider,
    p_status: status,
  });
  if (r.error) throw new Error("reply_callback_failed");
}
