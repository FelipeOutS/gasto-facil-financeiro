import { test, expect, mock, beforeEach, afterAll } from "bun:test";
type Payload = {
  label: string;
  expires_at?: string;
  message_id: string;
  idempotency_key: string;
  text: string;
  to: string;
  queued_at: string;
};
let payload: Payload,
  present = true,
  sent = 0,
  fail: number | null = null;
let logs: Record<string, unknown>[] = [],
  dlq: Record<string, unknown>[] = [],
  state: Record<string, unknown> = {};
const previous = {
  mail: process.env.LOVABLE_API_KEY,
  service: process.env.SUPABASE_SERVICE_ROLE_KEY,
  url: process.env.VITE_SUPABASE_URL,
};
process.env.LOVABLE_API_KEY = "isolated-provider";
process.env.SUPABASE_SERVICE_ROLE_KEY = "isolated-service";
process.env.VITE_SUPABASE_URL = "http://127.0.0.1:1";
mock.module("@tanstack/react-router", () => ({ createFileRoute: () => (x: unknown) => x }));
mock.module("@lovable.dev/email-js", () => ({
  sendLovableEmail: async (p: Payload) => {
    sent++;
    expect(p.idempotency_key).toBe(payload.idempotency_key);
    if (fail)
      throw Object.assign(Error("simulated provider failure"), {
        status: fail,
        retryAfterSeconds: 60,
      });
  },
}));
mock.module("@supabase/supabase-js", () => ({
  createClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const result = () => ({
        data:
          table === "email_send_state"
            ? state
            : logs.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v)),
        error: null,
      });
      const chain = {
        select: () => chain,
        in: () => chain,
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          return chain;
        },
        single: async () => result(),
        maybeSingle: async () => ({ data: (result().data as unknown[])[0] ?? null, error: null }),
        then: (ok: (x: unknown) => unknown) => Promise.resolve(result()).then(ok),
        insert: async (r: Record<string, unknown>) => {
          logs.push(r);
          return { error: null };
        },
        update: (r: Record<string, unknown>) => {
          Object.assign(state, r);
          return chain;
        },
      };
      return chain;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "read_email_batch")
        return {
          data:
            args.queue_name === "transactional_emails" && present
              ? [{ msg_id: 1, read_ct: 1, message: payload }]
              : [],
          error: null,
        };
      if (name === "delete_email") {
        present = false;
        return { error: null };
      }
      if (name === "move_to_dlq") {
        dlq.push(args.payload as Record<string, unknown>);
        present = false;
        return { error: null };
      }
      throw Error("unexpected RPC");
    },
  }),
}));
const { Route } = await import("../src/routes/lovable/email/queue/process");
const post = (
  Route as unknown as {
    server: { handlers: { POST: (x: { request: Request }) => Promise<Response> } };
  }
).server.handlers.POST;
const run = () =>
  post({
    request: new Request("http://127.0.0.1/queue", {
      method: "POST",
      headers: { Authorization: "Bearer isolated-service" },
    }),
  });
beforeEach(() => {
  payload = {
    label: "vault-recovery-code",
    expires_at: new Date(Date.now() + 600000).toISOString(),
    message_id: "message",
    idempotency_key: "vault:message:code",
    text: "Seu código é 123456",
    to: "test@example.invalid",
    queued_at: new Date().toISOString(),
  };
  present = true;
  sent = 0;
  fail = null;
  logs = [];
  dlq = [];
  state = { send_delay_ms: 0 };
});
afterAll(() => {
  for (const [k, v] of Object.entries({
    LOVABLE_API_KEY: previous.mail,
    SUPABASE_SERVICE_ROLE_KEY: previous.service,
    VITE_SUPABASE_URL: previous.url,
  })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
test("expired or malformed vault code never reaches provider and DLQ removes code text", async () => {
  payload.expires_at = new Date(Date.now() - 1).toISOString();
  await run();
  expect(sent).toBe(0);
  expect(dlq.length).toBe(1);
  expect(JSON.stringify(dlq)).not.toContain("123456");
});
test("transient provider failure preserves queue, retry sends once then deletes", async () => {
  fail = 500;
  await run();
  expect(present).toBe(true);
  expect(logs.filter((r) => r.status === "failed").length).toBe(1);
  fail = null;
  await run();
  expect(sent).toBe(2);
  expect(present).toBe(false);
  expect(logs.filter((r) => r.status === "sent").length).toBe(1);
  await run();
  expect(sent).toBe(2);
});
test("429 backoff stops further attempts until cooldown ends", async () => {
  fail = 429;
  expect((await (await run()).json()).stopped).toBe("rate_limited");
  expect((await (await run()).json()).skipped).toBe(true);
  expect(sent).toBe(1);
  state.retry_after_until = null;
  fail = null;
  await run();
  expect(sent).toBe(2);
  expect(present).toBe(false);
});
test("five failures and forbidden errors move to DLQ instead of infinite retry", async () => {
  logs = Array.from({ length: 5 }, () => ({ message_id: "message", status: "failed" }));
  await run();
  expect(sent).toBe(0);
  expect(dlq.length).toBe(1);
  logs = [];
  dlq = [];
  present = true;
  fail = 403;
  await run();
  expect(present).toBe(false);
  expect(dlq.length).toBe(1);
});
test("already-sent event skips duplicate provider call", async () => {
  logs = [{ message_id: "message", status: "sent" }];
  await run();
  expect(sent).toBe(0);
  expect(present).toBe(false);
});
