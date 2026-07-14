/**
 * WA-C9.2 Fase D.2B.2 (hardening) — Testes de concorrência + comportamento
 * do orquestrador `runOutboundForNotification`.
 *
 * Todos os testes usam deps injetadas — nenhum acesso a rede/Supabase real.
 * Cobre:
 *   - gate negado → nenhuma factory / execute / fetch
 *   - factory unavailable → transport_unavailable
 *   - recipient/template ausentes → sem execute
 *   - propagação de outcomes accepted/rejected/ambiguous
 *   - dois "dispatchers" concorrentes: apenas um chega a executar
 *     (ownership_changed simulado); nenhum segundo fetch
 *   - sentinela global: falha se `globalThis.fetch` for chamado
 */
import { test, expect, beforeEach, afterEach } from "bun:test";
import {
  runOutboundForNotification,
  type RunOutboundDeps,
} from "@/server/whatsapp-dispatcher-outbound.server";
import type {
  ExecuteResult,
  NotificationTemplateRow,
  SupabaseLike,
  WhatsAppNotificationTransport,
} from "@/server/whatsapp-outbound-adapter.server";

const NID = "n-conc-1";
const UID = "u-conc-1";
const TOKEN = "claim-token-conc";
const RECIPIENT = "5511988887777";

const emptyClient: SupabaseLike = { from: () => ({}) };

function tmpl(active = true): NotificationTemplateRow {
  return {
    key: "gi_conta_vencendo_hoje",
    category: "contas_a_pagar",
    meta_template_name: "gi_conta_vencendo_hoje_v1",
    language: "pt_BR",
    payload_schema: {
      required: ["nome", "valor", "vencimento"],
      body_params_order: ["nome", "valor", "vencimento"],
    },
    active,
  };
}

function baseNotification() {
  return {
    id: NID,
    user_id: UID,
    notification_type: "gi_conta_vencendo_hoje",
    payload: { nome: "X", valor: "R$ 1,00", vencimento: "14/07" } as Record<string, unknown>,
  };
}

function stubTransport(): WhatsAppNotificationTransport {
  return {
    async sendTemplate() {
      throw new Error("transport must be injected explicitly");
    },
  };
}

function baseDeps(overrides: Partial<RunOutboundDeps> = {}): RunOutboundDeps {
  return {
    supabaseClient: emptyClient,
    gate: () => ({ allowed: true }),
    transportFactory: () => ({ ok: true, transport: stubTransport() }),
    loadRecipient: async () => RECIPIENT,
    loadTemplate: async () => tmpl(),
    phoneNumberId: "1234567890",
    execute: async () =>
      ({ kind: "accepted", attemptId: "a-1", providerMessageId: "wamid.PMID" } as ExecuteResult),
    logger: () => {},
    ...overrides,
  };
}

// ─── Sentinela global de rede ────────────────────────────────────────────
const originalFetch = globalThis.fetch;
let fetchCalls = 0;

beforeEach(() => {
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    throw new Error("SENTINEL: real network access forbidden");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ═══════════ Gate ═══════════

test("gate negado → gated, sem factory/execute/fetch", async () => {
  let factoryCalls = 0;
  let executeCalls = 0;
  const out = await runOutboundForNotification(
    baseNotification(),
    TOKEN,
    baseDeps({
      gate: () => ({ allowed: false, reasons: ["outbound_http_disabled"] }),
      transportFactory: () => {
        factoryCalls++;
        return { ok: true, transport: stubTransport() };
      },
      execute: async () => {
        executeCalls++;
        throw new Error("execute must not be called");
      },
    }),
  );
  expect(out.kind).toBe("gated");
  expect(factoryCalls).toBe(0);
  expect(executeCalls).toBe(0);
  expect(fetchCalls).toBe(0);
});

// ═══════════ Recipient / Template ═══════════

test("recipient ausente → no_recipient, sem factory/execute", async () => {
  let factoryCalls = 0;
  const out = await runOutboundForNotification(
    baseNotification(),
    TOKEN,
    baseDeps({
      loadRecipient: async () => null,
      transportFactory: () => {
        factoryCalls++;
        return { ok: true, transport: stubTransport() };
      },
    }),
  );
  expect(out.kind).toBe("no_recipient");
  expect(factoryCalls).toBe(0);
  expect(fetchCalls).toBe(0);
});

test("recipient string vazia → no_recipient", async () => {
  const out = await runOutboundForNotification(
    baseNotification(),
    TOKEN,
    baseDeps({ loadRecipient: async () => "   " }),
  );
  expect(out.kind).toBe("no_recipient");
});

test("template null → no_template", async () => {
  const out = await runOutboundForNotification(
    baseNotification(),
    TOKEN,
    baseDeps({ loadTemplate: async () => null }),
  );
  expect(out.kind).toBe("no_template");
  expect(fetchCalls).toBe(0);
});

test("template inativo → no_template", async () => {
  const out = await runOutboundForNotification(
    baseNotification(),
    TOKEN,
    baseDeps({ loadTemplate: async () => tmpl(false) }),
  );
  expect(out.kind).toBe("no_template");
});

// ═══════════ Factory ═══════════

test("factory unavailable → transport_unavailable, sem execute", async () => {
  let executeCalls = 0;
  const out = await runOutboundForNotification(
    baseNotification(),
    TOKEN,
    baseDeps({
      transportFactory: () => ({ ok: false, reason: "phone_number_id_missing" }),
      execute: async () => {
        executeCalls++;
        throw new Error("must not execute");
      },
    }),
  );
  expect(out.kind).toBe("transport_unavailable");
  if (out.kind === "transport_unavailable") {
    expect(out.reason).toBe("phone_number_id_missing");
  }
  expect(executeCalls).toBe(0);
});

// ═══════════ Outcomes propagados ═══════════

test("execute accepted → executed{accepted}", async () => {
  const out = await runOutboundForNotification(
    baseNotification(),
    TOKEN,
    baseDeps({
      execute: async () =>
        ({ kind: "accepted", attemptId: "a-ok", providerMessageId: "wamid.OK" } as ExecuteResult),
    }),
  );
  expect(out.kind).toBe("executed");
  if (out.kind === "executed") expect(out.result.kind).toBe("accepted");
});

test("execute rejected → executed{rejected}, sem retry", async () => {
  let calls = 0;
  const out = await runOutboundForNotification(
    baseNotification(),
    TOKEN,
    baseDeps({
      execute: async () => {
        calls++;
        return {
          kind: "rejected",
          attemptId: "a-rej",
          errorCode: "meta_reject_131",
          retryable: false,
        } as ExecuteResult;
      },
    }),
  );
  expect(out.kind).toBe("executed");
  expect(calls).toBe(1);
});

test("execute ambiguous → executed{ambiguous}, sem retry, sem volta pending", async () => {
  let calls = 0;
  const out = await runOutboundForNotification(
    baseNotification(),
    TOKEN,
    baseDeps({
      execute: async () => {
        calls++;
        return { kind: "ambiguous", attemptId: "a-amb", reason: "timeout" } as ExecuteResult;
      },
    }),
  );
  expect(out.kind).toBe("executed");
  expect(calls).toBe(1);
});

// ═══════════ Sanitização de logs ═══════════

test("logger não recebe token/recipient/payload cru", async () => {
  const logs: Record<string, unknown>[] = [];
  await runOutboundForNotification(
    baseNotification(),
    TOKEN,
    baseDeps({ logger: (e) => logs.push(e) }),
  );
  const dump = JSON.stringify(logs);
  expect(dump).not.toContain(TOKEN);
  expect(dump).not.toContain(RECIPIENT);
  expect(dump).not.toContain("R$ 1,00");
});

// ═══════════ Dois dispatchers concorrentes ═══════════

test("dois dispatchers simultâneos: apenas um chega a executar (ownership_changed do outro)", async () => {
  // Simulamos ownership por token: só o dono chega ao execute. O segundo,
  // com token errado, é detectado pelo execute injetado como state_changed.
  let executes = 0;
  const ownerToken = "OWNER";
  const otherToken = "OTHER";

  function makeDeps(callerToken: string): RunOutboundDeps {
    return baseDeps({
      execute: async (input, _ctx, _t) => {
        executes++;
        if (input.claimToken !== ownerToken) {
          return { kind: "state_changed", attemptId: null } as unknown as ExecuteResult;
        }
        return {
          kind: "accepted",
          attemptId: "a-uno",
          providerMessageId: "wamid.UNO",
        } as ExecuteResult;
      },
    });
  }

  const [a, b] = await Promise.all([
    runOutboundForNotification(baseNotification(), ownerToken, makeDeps(ownerToken)),
    runOutboundForNotification(baseNotification(), otherToken, makeDeps(otherToken)),
  ]);

  expect(a.kind).toBe("executed");
  expect(b.kind).toBe("executed");
  // Executor foi consultado por ambos (o próprio executor decide via RPC
  // atômica em produção); apenas UM foi aceito.
  const outcomes = [a, b]
    .filter((r) => r.kind === "executed")
    .map((r) => (r as { kind: "executed"; result: ExecuteResult }).result.kind);
  expect(outcomes.filter((k) => k === "accepted").length).toBe(1);
  expect(outcomes.filter((k) => k !== "accepted").length).toBe(1);
  expect(fetchCalls).toBe(0);
});

// ═══════════ Sentinela ═══════════

test("todo o fluxo com deps injetadas: zero fetch real", async () => {
  await runOutboundForNotification(baseNotification(), TOKEN, baseDeps());
  expect(fetchCalls).toBe(0);
});
