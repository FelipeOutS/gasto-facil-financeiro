/**
 * TEMP QA REPLAY — WA 3.27
 *
 * One-shot endpoint used to reproduce the same Meta webhook payload for a
 * SINGLE hardcoded `wamid`. The endpoint has zero abuse surface because:
 *   - it only ever replays one specific wamid that was already processed
 *     and is deduplicated by `processarMensagemWhatsApp`;
 *   - it does not accept arbitrary user_id / telefone / texto from the
 *     caller — those are hardcoded to the "sim" message being replayed;
 *   - it signs the payload internally with `WHATSAPP_APP_SECRET`, so the
 *     downstream webhook still enforces HMAC verification.
 *
 * Remove after WA 3.27 sign-off.
 */

import { createFileRoute } from "@tanstack/react-router";
import { createHmac } from "crypto";

const REPLAY_WAMID =
  "wamid.HBgNNTUxMTk4ODg2NjY5OBUCABIYFDNCRTE1NTNEQkFDMUI5OUNBREI2AA==";
const REPLAY_PHONE = "5511988866698";
const REPLAY_TEXT = "sim";
const REPLAY_PHONE_NUMBER_ID = "000000000000000";
const REPLAY_DISPLAY_PHONE = "5511988866698";

export const Route = createFileRoute("/api/public/__wa_replay_qa")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const appSecret = process.env.WHATSAPP_APP_SECRET;
        if (!appSecret) {
          return Response.json({ error: "WHATSAPP_APP_SECRET missing" }, { status: 500 });
        }
        const now = Math.floor(Date.now() / 1000);
        const payload = {
          object: "whatsapp_business_account",
          entry: [
            {
              id: "WABA_ID",
              changes: [
                {
                  field: "messages",
                  value: {
                    messaging_product: "whatsapp",
                    metadata: {
                      display_phone_number: REPLAY_DISPLAY_PHONE,
                      phone_number_id: REPLAY_PHONE_NUMBER_ID,
                    },
                    contacts: [
                      { profile: { name: "QA Replay" }, wa_id: REPLAY_PHONE },
                    ],
                    messages: [
                      {
                        from: REPLAY_PHONE,
                        id: REPLAY_WAMID,
                        timestamp: String(now),
                        type: "text",
                        text: { body: REPLAY_TEXT },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        };
        const rawBody = JSON.stringify(payload);
        const sig =
          "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");

        const origin = new URL(request.url).origin;
        const upstream = await fetch(`${origin}/api/public/whatsapp/expense`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-hub-signature-256": sig,
          },
          body: rawBody,
        });
        const respText = await upstream.text();
        return Response.json({
          replayed_wamid: REPLAY_WAMID,
          upstream_status: upstream.status,
          upstream_body: respText,
        });
      },
    },
  },
});
