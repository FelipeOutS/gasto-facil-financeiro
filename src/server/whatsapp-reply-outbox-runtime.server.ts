import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canUseWhatsAppForSender } from "./whatsapp-authz.server";
import { readRuntimeConfig } from "./whatsapp-runtime-config.server";
import {
  sendWhatsAppReply,
  sendWhatsAppInteractiveReply,
  sendWhatsAppInteractiveCtaUrl,
} from "./whatsapp.server";
import { classifySendResult, safeSend } from "./whatsapp-reply-delivery.server";
import {
  enqueueReply,
  dispatchStoredReply,
  isReplyOutboxEnabled,
  type ReplyDeps,
  type ReplySnapshot,
} from "./whatsapp-reply-outbox.server";

function buildReplyDeps(): ReplyDeps {
  return {
    client: supabaseAdmin as unknown as ReplyDeps["client"],
    key: process.env.WHATSAPP_REPLY_ENCRYPTION_KEY ?? "",
    authorize: async (userId, phone) => {
      if (!isReplyOutboxEnabled() || process.env.WHATSAPP_ENABLED !== "true") return false;
      const runtime = await readRuntimeConfig();
      if (!runtime.global_enabled || !runtime.outbound_enabled) return false;
      const auth = await canUseWhatsAppForSender(phone);
      return auth.allowed && auth.userId === userId;
    },
    send: async (phone, snapshot, reference) => {
      const interactive = snapshot.cta
        ? () =>
            sendWhatsAppInteractiveCtaUrl(phone, { ...snapshot.cta!, type: "cta_url" }, reference)
        : snapshot.interactive
          ? () => sendWhatsAppInteractiveReply(phone, snapshot.interactive!, reference)
          : null;
      if (interactive) {
        const r = await safeSend(interactive);
        if (classifySendResult(r) !== "permanent") return r;
      }
      return sendWhatsAppReply(phone, snapshot.text, reference);
    },
  };
}

export async function deliverDurableReply(input: {
  userId: string;
  externalId: string;
  phone: string;
  receivedAt: Date;
  snapshot: ReplySnapshot;
}) {
  if (!isReplyOutboxEnabled()) return "disabled";
  const deps = buildReplyDeps();
  const id = await enqueueReply(input, deps);
  return id ? dispatchStoredReply(id, input.userId, input.phone, deps) : "blocked";
}

/** Only an authenticated owner/admin can call this through the server function. */
export async function recoverOwnDurableReply(id: string, userId: string) {
  if (!isReplyOutboxEnabled()) return "disabled";
  const db = supabaseAdmin as unknown as { from: typeof supabaseAdmin.from };
  const { data: row, error } = await db
    .from("whatsapp_reply_outbox" as never)
    .select("id,inbound_external_id,state")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !row) return "unavailable";
  const stored = row as unknown as { inbound_external_id: string; state: string };
  if (!["pending", "rejected"].includes(stored.state)) return "not_retryable";
  const { data: msg, error: msgError } = await db
    .from("whatsapp_messages")
    .select("telefone")
    .eq("user_id", userId)
    .eq("external_id", stored.inbound_external_id)
    .maybeSingle();
  if (msgError || !msg?.telefone) return "unavailable";
  const deps = buildReplyDeps();
  if (!(await deps.authorize(userId, msg.telefone))) return "blocked";
  if (stored.state === "rejected") {
    const retry = await deps.client.rpc("wa_reply_retry_rejected", { p_id: id, p_user: userId });
    if (retry.error || retry.data !== true) return "not_retryable";
  }
  return dispatchStoredReply(id, userId, msg.telefone, deps);
}
