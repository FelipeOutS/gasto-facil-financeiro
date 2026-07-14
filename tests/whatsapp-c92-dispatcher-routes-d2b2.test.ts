/**
 * WA-C9.2 Fase D.2B.2 (hardening) — Testes HTTP das rotas canônicas.
 *
 * Cobre:
 *   - `/api/public/hooks/whatsapp-dispatcher` (POST)
 *       • rejeição sem HMAC → 401
 *       • rejeição HMAC inválido → 401
 *       • HMAC válido + `WHATSAPP_DISPATCH_ENABLED=false` → early exit
 *       • HMAC válido + `WHATSAPP_OUTBOUND_HTTP_ENABLED=false` → early exit
 *       • sentinelas: nenhum recovery / list / claim / revert / reschedule /
 *         skip / template / gate / factory / transport quando OFF
 *   - `/api/public/whatsapp/expense` (GET/POST) — verify token e assinatura
 *     inválidos rejeitam antes de qualquer operação.
 *
 * Sem rede real, sem Supabase real, sem Graph API.
 */
import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createHmac } from "node:crypto";

const DISPATCHER_SECRET = "test-dispatcher-secret-xyz";

const ORIGINAL_ENV: Record<string, string | undefined> = {
  WHATSAPP_DISPATCHER_SECRET: process.env.WHATSAPP_DISPATCHER_SECRET,
  WHATSAPP_DISPATCH_ENABLED: process.env.WHATSAPP_DISPATCH_ENABLED,
  WHATSAPP_OUTBOUND_HTTP_ENABLED: process.env.WHATSAPP_OUTBOUND_HTTP_ENABLED,
  WHATSAPP_ENABLED: process.env.WHATSAPP_ENABLED,
  WHATSAPP_CANARY_ENABLED: process.env.WHATSAPP_CANARY_ENABLED,
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
};

// ─── Sentinelas de chamadas operacionais ──────────────────────────────────────
type CallCounts = {
  recoverStuckProcessing: number;
  listDuePending: number;
  claimForProcessing: number;
  markSkipped: number;
  revertProcessingToPending: number;
  rescheduleForQuietHours: number;
  recoverStuckReschedule: number;
  loadTemplate: number;
  canDispatch: number;
  revalidateConta: number;
  runOutbound: number;
  fetchCalls: number;
};

const counts: CallCounts = {
  recoverStuckProcessing: 0,
  listDuePending: 0,
  claimForProcessing: 0,
  markSkipped: 0,
  revertProcessingToPending: 0,
  rescheduleForQuietHours: 0,
  recoverStuckReschedule: 0,
  loadTemplate: 0,
  canDispatch: 0,
  revalidateConta: 0,
  runOutbound: 0,
  fetchCalls: 0,
};

// Modo do lote: quando OFF, os mocks respondem "vazio" mas o teste também
// afirma que nunca são invocados. Quando ON, os mocks retornam vazio para
// permitir o loop passar sem operação.
const mockState = { returnEmpty: true };

function resetCounts() {
  for (const k of Object.keys(counts) as (keyof CallCounts)[]) counts[k] = 0;
}

// ─── Mocks ──────────────────────────────────────────────────────────────────
mock.module("@/server/whatsapp-notifications.server", () => ({
  recoverStuckProcessing: async () => {
    counts.recoverStuckProcessing++;
    return { recovered: 0, state_changed: 0, errors: 0 };
  },
  listDuePending: async () => {
    counts.listDuePending++;
    return [];
  },
  claimForProcessing: async () => {
    counts.claimForProcessing++;
    return null;
  },
  markSkipped: async () => {
    counts.markSkipped++;
    return true;
  },
  revertProcessingToPending: async () => {
    counts.revertProcessingToPending++;
    return true;
  },
  rescheduleForQuietHours: async () => {
    counts.rescheduleForQuietHours++;
    return { ok: true as const, status: "ok" as const };
  },
  recoverStuckReschedule: async () => {
    counts.recoverStuckReschedule++;
    return { ok: true as const, status: "ok" as const };
  },
}));

mock.module("@/server/whatsapp-notification-gates.server", () => ({
  canDispatch: async () => {
    counts.canDispatch++;
    return { allow: true as const };
  },
}));

mock.module("@/server/whatsapp-contas-lembretes.server", () => ({
  revalidateContaForDispatch: async () => {
    counts.revalidateConta++;
    return { ok: true as const };
  },
}));

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            counts.loadTemplate++;
            return { data: null };
          },
        }),
      }),
    }),
  },
}));

mock.module("@/server/whatsapp-dispatcher-outbound.server", () => ({
  runOutboundForNotification: async () => {
    counts.runOutbound++;
    return { kind: "gated", reasons: ["dispatch_disabled"] };
  },
}));

// Sentinela de rede real.
const originalFetch = globalThis.fetch;

beforeEach(() => {
  resetCounts();
  mockState.returnEmpty = true;
  process.env.WHATSAPP_DISPATCHER_SECRET = DISPATCHER_SECRET;
  delete process.env.WHATSAPP_DISPATCH_ENABLED;
  delete process.env.WHATSAPP_OUTBOUND_HTTP_ENABLED;
  process.env.WHATSAPP_APP_SECRET = "test-app-secret";
  process.env.WHATSAPP_VERIFY_TOKEN = "test-verify-token";
  globalThis.fetch = (async () => {
    counts.fetchCalls++;
    throw new Error("network access forbidden in D.2B.2 hardening tests");
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ─── Importa as rotas DEPOIS dos mocks ────────────────────────────────────
const { Route: DispatcherRoute } = await import(
  "../src/routes/api/public.hooks.whatsapp-dispatcher"
);
const { Route: WebhookRoute } = await import(
  "../src/routes/api/public.whatsapp.expense"
);

type HttpHandler = (ctx: { request: Request }) => Promise<Response>;
const dispatcherPOST = (DispatcherRoute as unknown as {
  options: { server: { handlers: { POST: HttpHandler } } };
}).options.server.handlers.POST;
const webhookHandlers = (WebhookRoute as unknown as {
  options: { server: { handlers: Record<string, HttpHandler> } };
}).options.server.handlers;

function signBody(body: string): string {
  return createHmac("sha256", DISPATCHER_SECRET).update(body).digest("hex");
}

async function callDispatcher(opts: {
  body?: string;
  signature?: string | null;
}): Promise<Response> {
  const body = opts.body ?? "{}";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.signature === undefined) headers["x-cron-signature"] = signBody(body);
  else if (opts.signature !== null) headers["x-cron-signature"] = opts.signature;
  return dispatcherPOST({
    request: new Request("http://local/api/public/hooks/whatsapp-dispatcher", {
      method: "POST",
      headers,
      body,
    }),
  });
}

function assertNoOperationalCalls() {
  expect(counts.recoverStuckProcessing).toBe(0);
  expect(counts.listDuePending).toBe(0);
  expect(counts.claimForProcessing).toBe(0);
  expect(counts.markSkipped).toBe(0);
  expect(counts.revertProcessingToPending).toBe(0);
  expect(counts.rescheduleForQuietHours).toBe(0);
  expect(counts.recoverStuckReschedule).toBe(0);
  expect(counts.loadTemplate).toBe(0);
  expect(counts.canDispatch).toBe(0);
  expect(counts.revalidateConta).toBe(0);
  expect(counts.runOutbound).toBe(0);
  expect(counts.fetchCalls).toBe(0);
}

// ═══════════ Dispatcher — HMAC ═══════════

test("dispatcher: POST sem x-cron-signature → 401 e nenhuma operação", async () => {
  const res = await callDispatcher({ signature: null });
  expect(res.status).toBe(401);
  assertNoOperationalCalls();
});

test("dispatcher: POST com HMAC inválido → 401 e nenhuma operação", async () => {
  const res = await callDispatcher({ signature: "deadbeef" });
  expect(res.status).toBe(401);
  assertNoOperationalCalls();
});

test("dispatcher: HMAC assinado sobre outro corpo → 401", async () => {
  const res = await callDispatcher({ body: "{}", signature: signBody("{\"x\":1}") });
  expect(res.status).toBe(401);
  assertNoOperationalCalls();
});

// ═══════════ Dispatcher — early exit ═══════════

test("HMAC válido + WHATSAPP_DISPATCH_ENABLED ausente → early exit, banco intocado", async () => {
  const res = await callDispatcher({});
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.disabled).toBe(true);
  expect(body.dispatch_enabled).toBe(false);
  expect(body.reason).toBe("dispatcher_disabled");
  expect(body.considered).toBe(0);
  expect(body.would_send).toBe(0);
  expect(body.recovered_stuck_processing).toBe(0);
  assertNoOperationalCalls();
});

test("dispatcher='false' + outbound='true' → early exit", async () => {
  process.env.WHATSAPP_DISPATCH_ENABLED = "false";
  process.env.WHATSAPP_OUTBOUND_HTTP_ENABLED = "true";
  const res = await callDispatcher({});
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.disabled).toBe(true);
  expect(body.reason).toBe("dispatcher_disabled");
  assertNoOperationalCalls();
});

test("dispatcher='true' + outbound ausente → early exit por outbound", async () => {
  process.env.WHATSAPP_DISPATCH_ENABLED = "true";
  const res = await callDispatcher({});
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.disabled).toBe(true);
  expect(body.reason).toBe("outbound_http_disabled");
  expect(body.outbound_http_enabled).toBe(false);
  assertNoOperationalCalls();
});

test("dispatcher='true' + outbound='FALSE' → early exit (parser não é case-sensitive só em 'true')", async () => {
  process.env.WHATSAPP_DISPATCH_ENABLED = "true";
  process.env.WHATSAPP_OUTBOUND_HTTP_ENABLED = "FALSE";
  const res = await callDispatcher({});
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.disabled).toBe(true);
  assertNoOperationalCalls();
});

test("dispatcher='1' + outbound='1' → early exit (não é 'true')", async () => {
  process.env.WHATSAPP_DISPATCH_ENABLED = "1";
  process.env.WHATSAPP_OUTBOUND_HTTP_ENABLED = "1";
  const res = await callDispatcher({});
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.disabled).toBe(true);
  assertNoOperationalCalls();
});

test("dispatcher='yes' + outbound='yes' → early exit (não é 'true')", async () => {
  process.env.WHATSAPP_DISPATCH_ENABLED = "yes";
  process.env.WHATSAPP_OUTBOUND_HTTP_ENABLED = "yes";
  const res = await callDispatcher({});
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.disabled).toBe(true);
  assertNoOperationalCalls();
});

test("ambos '  true  ' com espaços → aceitos após trim → sai do early exit", async () => {
  process.env.WHATSAPP_DISPATCH_ENABLED = "  true  ";
  process.env.WHATSAPP_OUTBOUND_HTTP_ENABLED = "TRUE";
  const res = await callDispatcher({});
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.disabled).toBe(false);
  // Sai do early exit — recovery + list rodam (retornam vazio via mock).
  expect(counts.recoverStuckProcessing).toBe(1);
  expect(counts.listDuePending).toBe(1);
  // listDuePending vazio ⇒ zero claim.
  expect(counts.claimForProcessing).toBe(0);
  expect(counts.runOutbound).toBe(0);
  expect(counts.fetchCalls).toBe(0);
});

test("summary OFF contém todos os contadores operacionais zerados", async () => {
  const res = await callDispatcher({});
  const body = (await res.json()) as Record<string, unknown>;
  const zeroKeys = [
    "considered",
    "skipped",
    "rescheduled_quiet_hours",
    "would_send",
    "recovered_stuck_processing",
    "recovery_state_changed",
    "recovery_errors",
    "attempts_prepared",
    "attempts_prepare_failed",
    "attempts_marked_sending",
    "attempts_mark_sending_failed",
    "transport_accepted",
    "transport_rejected",
    "transport_ambiguous",
    "finalize_accepted",
    "finalize_rejected",
    "finalize_ambiguous",
    "finalize_errors",
    "outbound_gate_blocked",
    "outbound_factory_errors",
    "ownership_changed",
    "state_changed",
  ];
  for (const k of zeroKeys) expect(body[k]).toBe(0);
});

// ═══════════ Webhook — rejeições ═══════════

test("webhook: GET verify token inválido → 403", async () => {
  const GET = webhookHandlers.GET!;
  const res = await GET({
    request: new Request(
      "http://local/api/public/whatsapp/expense?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=xyz",
    ),
  });
  expect(res.status).toBe(403);
});

test("webhook: POST sem x-hub-signature-256 → 403", async () => {
  const POST = webhookHandlers.POST!;
  const res = await POST({
    request: new Request("http://local/api/public/whatsapp/expense", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ object: "whatsapp_business_account" }),
    }),
  });
  expect(res.status).toBe(403);
});

test("webhook: POST assinatura inválida → 403", async () => {
  const POST = webhookHandlers.POST!;
  const res = await POST({
    request: new Request("http://local/api/public/whatsapp/expense", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=deadbeef",
      },
      body: JSON.stringify({ object: "whatsapp_business_account" }),
    }),
  });
  expect(res.status).toBe(403);
});
