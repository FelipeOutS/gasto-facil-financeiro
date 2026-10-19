import { test, expect, mock, beforeEach, afterEach } from "bun:test";

const received: string[] = [];
let unavailable = false;
mock.module("@/server/pluggy/pluggy-webhook-queue.server", () => ({
  createQueueDb: async () => ({}),
  receiveWebhook: async (_db: unknown, event: { eventId: string }) => {
    if (unavailable) throw new Error("unavailable");
    const isNew = !received.includes(event.eventId);
    if (isNew) received.push(event.eventId);
    return { status: "pendente", isNew };
  },
}));
const { Route } = await import("../src/routes/api/public/pluggy.webhook");
const handler = Route.options.server?.handlers?.POST;
const oldToken = process.env.PLUGGY_WEBHOOK_TOKEN;
const token = "test-only-webhook-token";
beforeEach(() => { process.env.PLUGGY_WEBHOOK_TOKEN = token; received.length = 0; unavailable = false; });
afterEach(() => {
  if (oldToken === undefined) delete process.env.PLUGGY_WEBHOOK_TOKEN;
  else process.env.PLUGGY_WEBHOOK_TOKEN = oldToken;
});
async function send(body: unknown, header = true, query = false) {
  if (typeof handler !== "function") throw new Error("missing_handler");
  const request = new Request(`https://app.example/api/public/pluggy/webhook${query ? `?t=${token}` : ""}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(header ? { "X-GI-Webhook-Token": token } : {}) },
    body: JSON.stringify(body),
  });
  // Route handler context is framework-owned; this handler uses only request.
  return await handler({ request } as Parameters<typeof handler>[0]) as Response;
}
const event = { event: "item/updated", itemId: "11111111-1111-4111-8111-111111111111", eventId: "provider-event-1" };
test("URL token without header is rejected before queue access", async () => {
  expect((await send(event, false, true)).status).toBe(401);
  expect(received).toEqual([]);
});
test("missing provider event ID fails closed without enqueue", async () => {
  expect((await send({ ...event, eventId: undefined })).status).toBe(400);
  expect(received).toEqual([]);
});
test("distinct IDs stay distinct and identical ID is a duplicate", async () => {
  expect((await send(event)).status).toBe(202);
  expect(await (await send(event)).json()).toMatchObject({ duplicate: true });
  expect((await send({ ...event, eventId: "provider-event-2" })).status).toBe(202);
  expect(received).toEqual(["provider-event-1", "provider-event-2"]);
});
test("unknown event is ignored without queue access", async () => {
  expect(await (await send({ ...event, event: "unknown/event" })).json()).toEqual({ ok: true, ignored: true });
  expect(received).toEqual([]);
});
test("invalid item and failed durable enqueue do not acknowledge success", async () => {
  expect((await send({ ...event, itemId: "not-a-uuid" })).status).toBe(400);
  unavailable = true;
  expect((await send(event)).status).toBe(503);
  expect(received).toEqual([]);
});