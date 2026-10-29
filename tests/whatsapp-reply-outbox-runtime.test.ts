import { test, expect } from "bun:test";
import {
  dispatchStoredReply,
  sealReply,
  openReply,
  type ReplyDeps,
} from "../src/server/whatsapp-reply-outbox.server";
const key = "ab".repeat(32);
test("cipher protects original reply and binds user/message", () => {
  const c = sealReply({ text: "Gasto fictício R$ 33,50" }, key, "u:m");
  expect(c).not.toContain("33,50");
  expect(openReply(c, key, "u:m").text).toContain("33,50");
  expect(() => openReply(c, key, "other:m")).toThrow();
  expect(() => openReply(c, "cd".repeat(32), "u:m")).toThrow();
});
test.each([400, 401, 403, 429, 500, 200])("HTTP %i is classified without retry", async (status) => {
  let sends = 0;
  let state = "";
  const deps: ReplyDeps = {
    key,
    authorize: async () => true,
    send: async () => {
      sends++;
      return { sent: status === 200, status, providerMessageId: status === 200 ? "wamid.x" : null };
    },
    client: {
      async rpc(name, args) {
        if (name === "wa_reply_claim")
          return {
            error: null,
            data: [
              {
                id: "id",
                user_id: "u",
                inbound_external_id: "m",
                claim_token: "token",
                payload_ciphertext: sealReply({ text: "original" }, key, "u:m"),
              },
            ],
          };
        state = String(args.p_state);
        return { error: null, data: true };
      },
    },
  };
  await dispatchStoredReply("id", "u", "phone", deps);
  expect(sends).toBe(1);
  expect(state).toBe(
    status === 200 ? "accepted" : status === 429 || status >= 500 ? "ambiguous" : "rejected",
  );
});
test("revocation between claim and HTTP sends nothing", async () => {
  let checks = 0,
    sends = 0;
  const deps: ReplyDeps = {
    key,
    authorize: async () => ++checks === 1,
    send: async () => {
      sends++;
      return { sent: true };
    },
    client: {
      async rpc(name) {
        return {
          error: null,
          data:
            name === "wa_reply_claim"
              ? [
                  {
                    user_id: "u",
                    inbound_external_id: "m",
                    claim_token: "t",
                    payload_ciphertext: sealReply({ text: "x" }, key, "u:m"),
                  },
                ]
              : true,
        };
      },
    },
  };
  expect(await dispatchStoredReply("id", "u", "phone", deps)).toBe("cancelled");
  expect(sends).toBe(0);
});
test("timeout is ambiguous; finish failure never sends twice", async () => {
  let sends = 0;
  const deps: ReplyDeps = {
    key,
    authorize: async () => true,
    send: async () => {
      sends++;
      throw new Error("private content");
    },
    client: {
      async rpc(name, args) {
        if (name === "wa_reply_claim")
          return {
            error: null,
            data: [
              {
                user_id: "u",
                inbound_external_id: "m",
                claim_token: "t",
                payload_ciphertext: sealReply({ text: "x" }, key, "u:m"),
              },
            ],
          };
        expect(args.p_state).toBe("ambiguous");
        return { error: { code: "fixture" }, data: null };
      },
    },
  };
  await expect(dispatchStoredReply("id", "u", "phone", deps)).rejects.toThrow(
    "reply_finish_failed",
  );
  expect(sends).toBe(1);
});
