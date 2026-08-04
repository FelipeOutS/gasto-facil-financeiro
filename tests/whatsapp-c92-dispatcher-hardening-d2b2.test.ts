/**
 * WA-C9.2 Fase D.2B.2 (hardening) — Testes complementares.
 *
 * 1) `isOutboundHttpAllowed`: parser estrito de flags + todas as razões.
 * 2) `revertProcessingToPending`: CAS por (id, status='processing', claim_token).
 *    Chamado com token errado ou linha em outro status ⇒ zero linhas afetadas
 *    e a função retorna false — nada é reescrito.
 * 3) Configuração inválida: factory sem token/phone gera `transport_unavailable`
 *    sem loop quente (sem execute, sem fetch).
 * 4) Múltiplos motivos acumulados no gate.
 * 5) Sentinela: nenhum teste toca globalThis.fetch.
 */
import { test, expect, beforeEach, afterEach } from "bun:test";
import { isOutboundHttpAllowed } from "@/server/whatsapp-outbound-gates.server";
import { revertProcessingToPending } from "@/server/whatsapp-notifications.server";
import {
  runOutboundForNotification,
  type RunOutboundDeps,
} from "@/server/whatsapp-dispatcher-outbound.server";
import { createMetaWhatsAppNotificationTransport } from "@/server/whatsapp-meta-transport.server";
import type {
  ExecuteResult,
  NotificationTemplateRow,
  SupabaseLike,
  WhatsAppNotificationTransport,
} from "@/server/whatsapp-outbound-adapter.server";

// ─── env baseline ────────────────────────────────────────────────────────
const ORIGINAL_ENV: Record<string, string | undefined> = {
  WHATSAPP_ENABLED: process.env.WHATSAPP_ENABLED,
  WHATSAPP_CANARY_ENABLED: process.env.WHATSAPP_CANARY_ENABLED,
  WHATSAPP_DISPATCH_ENABLED: process.env.WHATSAPP_DISPATCH_ENABLED,
  WHATSAPP_OUTBOUND_HTTP_ENABLED: process.env.WHATSAPP_OUTBOUND_HTTP_ENABLED,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_GRAPH_VERSION: process.env.WHATSAPP_GRAPH_VERSION,
};

// sentinela global
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
beforeEach(() => {
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    throw new Error("SENTINEL: no real network");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ═══════════ isOutboundHttpAllowed — parser estrito ═══════════

function fullEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    WHATSAPP_ENABLED: "true",
    WHATSAPP_CANARY_ENABLED: "true",
    WHATSAPP_DISPATCH_ENABLED: "true",
    WHATSAPP_OUTBOUND_HTTP_ENABLED: "true",
    WHATSAPP_PHONE_NUMBER_ID: "1234567890",
    WHATSAPP_ACCESS_TOKEN: "tok-abc",
    ...overrides,
  };
}

test("gate: todas as flags 'true' + graph válida → allowed", () => {
  process.env.WHATSAPP_GRAPH_VERSION = "v20.0";
  const r = isOutboundHttpAllowed({ env: fullEnv() });
  expect(r.allowed).toBe(true);
});

test.each([
  ["ausente", undefined],
  ["'false'", "false"],
  ["'FALSE'", "FALSE"],
  ["'0'", "0"],
  ["'1'", "1"],
  ["'yes'", "yes"],
  ["'on'", "on"],
  ["' true'", " true"], // trim ok
  ["''", ""],
])("gate: WHATSAPP_DISPATCH_ENABLED=%s → correta classificação", (_label, value) => {
  process.env.WHATSAPP_GRAPH_VERSION = "v20.0";
  const r = isOutboundHttpAllowed({
    env: fullEnv({ WHATSAPP_DISPATCH_ENABLED: value }),
  });
  if (value !== undefined && value.trim().toLowerCase() === "true") {
    expect(r.allowed).toBe(true);
  } else {
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reasons).toContain("dispatch_disabled");
  }
});

test("gate: outbound_http_disabled acumulado com dispatch_disabled", () => {
  process.env.WHATSAPP_GRAPH_VERSION = "v20.0";
  const r = isOutboundHttpAllowed({
    env: fullEnv({
      WHATSAPP_DISPATCH_ENABLED: "0",
      WHATSAPP_OUTBOUND_HTTP_ENABLED: "0",
    }),
  });
  expect(r.allowed).toBe(false);
  if (!r.allowed) {
    expect(r.reasons).toContain("dispatch_disabled");
    expect(r.reasons).toContain("outbound_http_disabled");
  }
});

test("gate: phone_number_id não-numérico → invalid", () => {
  process.env.WHATSAPP_GRAPH_VERSION = "v20.0";
  const r = isOutboundHttpAllowed({
    env: fullEnv({ WHATSAPP_PHONE_NUMBER_ID: "abc123" }),
  });
  expect(r.allowed).toBe(false);
  if (!r.allowed) expect(r.reasons).toContain("phone_number_id_invalid");
});

test("gate: access_token vazio → access_token_missing", () => {
  process.env.WHATSAPP_GRAPH_VERSION = "v20.0";
  const r = isOutboundHttpAllowed({
    env: fullEnv({ WHATSAPP_ACCESS_TOKEN: "" }),
  });
  expect(r.allowed).toBe(false);
  if (!r.allowed) expect(r.reasons).toContain("access_token_missing");
});

test("gate: usuário fora do canary → user_not_in_canary", () => {
  process.env.WHATSAPP_GRAPH_VERSION = "v20.0";
  const r = isOutboundHttpAllowed({
    userId: "u-external",
    canaryUserIds: ["u-canary-1"],
    env: fullEnv(),
  });
  expect(r.allowed).toBe(false);
  if (!r.allowed) expect(r.reasons).toContain("user_not_in_canary");
});

// ═══════════ revertProcessingToPending — CAS ═══════════

type UpdateRow = { id: string; status: string; claim_token: string };

function fakeClient(rows: UpdateRow[]): {
  client: SupabaseLike;
  writes: Array<{ id: string; claim_token: string; result: number }>;
} {
  const writes: Array<{ id: string; claim_token: string; result: number }> = [];
  const client: SupabaseLike = {
    from: (_table: string) => {
      const filters: Record<string, string> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let patch: any = null;
      const builder = {
        update(p: unknown) {
          patch = p;
          return builder;
        },
        eq(col: string, val: string) {
          filters[col] = val;
          return builder;
        },
        select(_cols: string) {
          const matched = rows.filter(
            (r) =>
              (filters.id === undefined || r.id === filters.id) &&
              (filters.status === undefined || r.status === filters.status) &&
              (filters.claim_token === undefined || r.claim_token === filters.claim_token),
          );
          for (const m of matched) {
            m.status = patch?.status ?? m.status;
            m.claim_token = patch?.claim_token ?? "";
          }
          writes.push({
            id: filters.id ?? "",
            claim_token: filters.claim_token ?? "",
            result: matched.length,
          });
          return Promise.resolve({ data: matched.map((r) => ({ id: r.id })), error: null });
        },
      };
      return builder;
    },
  };
  return { client, writes };
}

test("revert: claim correto + status='processing' → sucesso e 1 linha", async () => {
  const rows: UpdateRow[] = [{ id: "n-1", status: "processing", claim_token: "T-1" }];
  const { client, writes } = fakeClient(rows);
  const ok = await revertProcessingToPending("n-1", "T-1", { client: client as never });
  expect(ok).toBe(true);
  expect(writes[0]!.result).toBe(1);
  expect(rows[0]!.status).toBe("pending");
});

test("revert: token errado → false e 0 linhas", async () => {
  const rows: UpdateRow[] = [{ id: "n-1", status: "processing", claim_token: "T-1" }];
  const { client, writes } = fakeClient(rows);
  const ok = await revertProcessingToPending("n-1", "WRONG", { client: client as never });
  expect(ok).toBe(false);
  expect(writes[0]!.result).toBe(0);
  expect(rows[0]!.status).toBe("processing"); // não mudou
});

test("revert: status != processing → false", async () => {
  const rows: UpdateRow[] = [{ id: "n-1", status: "sent", claim_token: "T-1" }];
  const { client } = fakeClient(rows);
  const ok = await revertProcessingToPending("n-1", "T-1", { client: client as never });
  expect(ok).toBe(false);
  expect(rows[0]!.status).toBe("sent");
});

test("revert: token vazio é rejeitado antes da query", async () => {
  const rows: UpdateRow[] = [{ id: "n-1", status: "processing", claim_token: "T-1" }];
  const { client, writes } = fakeClient(rows);
  const ok = await revertProcessingToPending("n-1", "", { client: client as never });
  expect(ok).toBe(false);
  expect(writes.length).toBe(0); // guard clause corta antes
});

test("revert: id inexistente → false", async () => {
  const rows: UpdateRow[] = [{ id: "n-1", status: "processing", claim_token: "T-1" }];
  const { client } = fakeClient(rows);
  const ok = await revertProcessingToPending("n-outra", "T-1", { client: client as never });
  expect(ok).toBe(false);
});

// ═══════════ Factory real com env inválido → sem fetch ═══════════

test("factory Meta com phone_number_id ausente → factory falha", () => {
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  process.env.WHATSAPP_ACCESS_TOKEN = "tok";
  process.env.WHATSAPP_GRAPH_VERSION = "v20.0";
  const r = createMetaWhatsAppNotificationTransport();
  expect(r.ok).toBe(false);
  expect(fetchCalls).toBe(0);
});

test("factory Meta com access_token ausente → factory falha", () => {
  process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  process.env.WHATSAPP_GRAPH_VERSION = "v20.0";
  const r = createMetaWhatsAppNotificationTransport();
  expect(r.ok).toBe(false);
  expect(fetchCalls).toBe(0);
});

// ═══════════ runOutbound com factory falhando por env ═══════════

test("runOutbound: configuração inválida → transport_unavailable sem loop, sem fetch", async () => {
  const NID = "n-cfg";
  let executeCalls = 0;
  const deps: RunOutboundDeps = {
    supabaseClient: { from: () => ({}) } as SupabaseLike,
    gate: () => ({ allowed: true }),
    transportFactory: () => ({ ok: false, reason: "access_token_missing" }),
    loadRecipient: async () => "5511900000000",
    loadTemplate: async () =>
      ({
        key: "gi_conta_vencendo_hoje",
        category: "contas_a_pagar",
        meta_template_name: "x",
        language: "pt_BR",
        payload_schema: { required: [], body_params_order: [] },
        active: true,
      }) as NotificationTemplateRow,
    execute: async () => {
      executeCalls++;
      throw new Error("must not execute");
    },
    logger: () => {},
  };
  const out = await runOutboundForNotification(
    { id: NID, user_id: "u-1", notification_type: "gi_conta_vencendo_hoje", payload: {} },
    "TOKEN",
    deps,
  );
  expect(out.kind).toBe("transport_unavailable");
  expect(executeCalls).toBe(0);
  expect(fetchCalls).toBe(0);
});

// ═══════════ Múltiplas invocações do mesmo runOutbound ═══════════

test("runOutbound: chamado 3× para a mesma notification (execute injetado idempotente)", async () => {
  let calls = 0;
  const deps: RunOutboundDeps = {
    supabaseClient: { from: () => ({}) } as SupabaseLike,
    gate: () => ({ allowed: true }),
    transportFactory: () => ({
      ok: true,
      transport: {
        async sendTemplate() {
          throw new Error("must not be called; execute is stubbed");
        },
      } as WhatsAppNotificationTransport,
    }),
    loadRecipient: async () => "5511900000000",
    loadTemplate: async () =>
      ({
        key: "gi_conta_vencendo_hoje",
        category: "contas_a_pagar",
        meta_template_name: "x",
        language: "pt_BR",
        payload_schema: { required: [], body_params_order: [] },
        active: true,
      }) as NotificationTemplateRow,
    execute: async () => {
      calls++;
      // Idempotência autoritativa fica nas RPCs D.2A; aqui só validamos que
      // execute é chamado uma vez por invocação e nunca há retry interno.
      return { kind: "accepted", attemptId: "a-x", providerMessageId: "wamid.X" } as ExecuteResult;
    },
    phoneNumberId: "1234567890",
    logger: () => {},
  };
  const notif = {
    id: "n-idem",
    user_id: "u-1",
    notification_type: "gi_conta_vencendo_hoje",
    payload: {},
  };
  await runOutboundForNotification(notif, "T1", deps);
  await runOutboundForNotification(notif, "T2", deps);
  await runOutboundForNotification(notif, "T3", deps);
  expect(calls).toBe(3); // uma invocação de execute por chamada; sem retry interno
  expect(fetchCalls).toBe(0);
});
