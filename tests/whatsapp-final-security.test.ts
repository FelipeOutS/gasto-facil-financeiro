import { test, expect } from "bun:test";
import {
  downloadWhatsappMediaBounded,
  isTrustedMetaUrl,
} from "../src/server/whatsapp-bounded-fetch.server";
import { isNotificationStale } from "../src/server/whatsapp-notification-freshness";
import { resolveAllowedMapping } from "../src/server/whatsapp-meta-template-mapping.server";
import {
  runOutboundForNotification,
  type RunOutboundDeps,
} from "../src/server/whatsapp-dispatcher-outbound.server";
import { approvedCatalog } from "./_whatsapp-approved-catalog";

test.each([
  "https://localhost/x",
  "https://127.0.0.1/x",
  "https://fbcdn.net.attacker.test/x",
  "http://graph.facebook.com/x",
  "https://user:password@graph.facebook.com/x",
  "https://graph.facebook.com:8443/x",
])("media rejects unsafe destination %s before forwarding credentials", async (url) => {
  expect(isTrustedMetaUrl(url)).toBe(false);
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return Response.json({ url });
  }) as typeof fetch;
  const result = await downloadWhatsappMediaBounded(
    { lookupUrl: "https://graph.facebook.com/v25.0/media", token: "fixture", maxBytes: 100 },
    { fetchImpl },
  );
  expect(result).toEqual({ ok: false, reason: "invalid" });
  expect(calls).toBe(1);
});
test("valid media uses redirect:error for lookup and bytes", async () => {
  const redirects: unknown[] = [];
  const fetchImpl = (async (_url: unknown, init: RequestInit) => {
    redirects.push(init.redirect);
    return redirects.length === 1
      ? Response.json({ url: "https://lookaside.fbsbx.com/file" })
      : new Response("fixture");
  }) as typeof fetch;
  expect(
    (
      await downloadWhatsappMediaBounded(
        { lookupUrl: "https://graph.facebook.com/v25.0/id", token: "fixture", maxBytes: 100 },
        { fetchImpl },
      )
    ).ok,
  ).toBe(true);
  expect(redirects).toEqual(["error", "error"]);
});
test("old/invalid reminders blocked and exact 24h boundary explicit", () => {
  const now = new Date("2026-10-25T12:00:00Z");
  expect(isNotificationStale("invalid", now)).toBe(true);
  expect(isNotificationStale("2026-10-24T11:59:59Z", now)).toBe(true);
  expect(isNotificationStale("2026-10-24T12:00:00Z", now)).toBe(false);
});
test.each(["__proto__", "constructor", "toString", "hello_world"])(
  "mapping refuses inherited/unknown %s",
  (key) => expect(resolveAllowedMapping(key).ok).toBe(false),
);
test.each(["pending", "rejected", "paused", "disabled"])(
  "dispatcher never creates transport for %s catalog",
  async (status) => {
    let transport = 0;
    const deps: RunOutboundDeps = {
      supabaseClient: {} as never,
      gate: () => ({ allowed: true }),
      loadRecipient: async () => "5511900000000",
      loadTemplate: async () =>
        ({
          key: "gi_agenda_lembrete",
          active: true,
          meta_template_name: "hello_world",
          payload_schema: {},
        }) as never,
      catalogLoader: approvedCatalog(status),
      transportFactory: () => {
        transport++;
        throw Error("must not send");
      },
      logger: () => {},
    };
    const result = await runOutboundForNotification(
      {
        id: "fixture",
        user_id: "fixture",
        notification_type: "gi_agenda_lembrete",
        payload: { template_date: "25/10/2026" },
      } as never,
      "fixture",
      deps,
    );
    expect(result.kind).toBe("no_template");
    expect(transport).toBe(0);
  },
);
