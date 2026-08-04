/**
 * WA-C9.2 Fase D.2B.2 — Testes do wiring do dispatcher outbound.
 *
 * Não usa rede, nem Supabase real. Todas as dependências externas
 * (`gate`, `transportFactory`, `execute`, `loadRecipient`, `loadTemplate`,
 * `supabaseClient`) são injetadas.
 *
 * O objetivo é garantir que:
 *  - Sem TODAS as flags/canary ligadas, retorna `gated` e não chama transport.
 *  - Sem recipient / sem template → retorna cedo, sem chamar transport.
 *  - Factory falha → `transport_unavailable`.
 *  - Com tudo ok, delega ao `execute` injetado e propaga o `ExecuteResult`.
 *  - Nenhum log inclui telefone/token/payload cru.
 */
import { describe, it, expect } from "bun:test";
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

const NID = "n-1";
const UID = "u-1";
const TOKEN = "claim-token-abc";
const RECIPIENT = "5511999999999";

function baseNotification() {
  return {
    id: NID,
    user_id: UID,
    notification_type: "gi_conta_vencendo_hoje",
    payload: { nome: "Conta X", valor: "R$ 120,00", vencimento: "12/07" } as Record<
      string,
      unknown
    >,
  };
}

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

function stubTransport(): WhatsAppNotificationTransport {
  return {
    async sendTemplate() {
      throw new Error("transport should not be called in these tests");
    },
  };
}

const emptyClient: SupabaseLike = { from: () => ({}) };

function baseDeps(overrides: Partial<RunOutboundDeps> = {}): RunOutboundDeps {
  return {
    supabaseClient: emptyClient,
    gate: () => ({ allowed: true }),
    transportFactory: () => ({ ok: true, transport: stubTransport() }),
    loadRecipient: async () => RECIPIENT,
    loadTemplate: async () => tmpl(),
    phoneNumberId: "1234567890",
    execute: async () =>
      ({ kind: "accepted", attemptId: "a-1", providerMessageId: "wamid.PMID" }) as ExecuteResult,
    logger: () => {},
    ...overrides,
  };
}

describe("runOutboundForNotification — gate", () => {
  it("returns gated when gate denies; does not build transport or execute", async () => {
    let factoryCalled = false;
    let executeCalled = false;
    const out = await runOutboundForNotification(baseNotification(), TOKEN, {
      ...baseDeps(),
      gate: () => ({
        allowed: false,
        reasons: ["whatsapp_disabled", "outbound_http_disabled"],
      }),
      transportFactory: () => {
        factoryCalled = true;
        return { ok: true, transport: stubTransport() };
      },
      execute: async () => {
        executeCalled = true;
        return { kind: "accepted", attemptId: "x", providerMessageId: "y" };
      },
    });
    expect(out.kind).toBe("gated");
    if (out.kind === "gated") {
      expect(out.reasons).toContain("whatsapp_disabled");
      expect(out.reasons).toContain("outbound_http_disabled");
    }
    expect(factoryCalled).toBe(false);
    expect(executeCalled).toBe(false);
  });

  it("passes userId to the gate for canary evaluation", async () => {
    let seenUserId: string | null = null;
    await runOutboundForNotification(baseNotification(), TOKEN, {
      ...baseDeps(),
      gate: (uid) => {
        seenUserId = uid;
        return { allowed: false, reasons: ["user_not_in_canary"] };
      },
    });
    expect(seenUserId).toBe(UID);
  });
});

describe("runOutboundForNotification — pre-conditions", () => {
  it("returns no_recipient when whatsapp_links yields nothing", async () => {
    const out = await runOutboundForNotification(baseNotification(), TOKEN, {
      ...baseDeps(),
      loadRecipient: async () => null,
    });
    expect(out.kind).toBe("no_recipient");
  });

  it("returns no_recipient for blank string", async () => {
    const out = await runOutboundForNotification(baseNotification(), TOKEN, {
      ...baseDeps(),
      loadRecipient: async () => "   ",
    });
    expect(out.kind).toBe("no_recipient");
  });

  it("returns no_template when template missing", async () => {
    const out = await runOutboundForNotification(baseNotification(), TOKEN, {
      ...baseDeps(),
      loadTemplate: async () => null,
    });
    expect(out.kind).toBe("no_template");
  });

  it("returns no_template when template inactive", async () => {
    const out = await runOutboundForNotification(baseNotification(), TOKEN, {
      ...baseDeps(),
      loadTemplate: async () => tmpl(false),
    });
    expect(out.kind).toBe("no_template");
  });
});

describe("runOutboundForNotification — factory failure", () => {
  it("propagates factory reason as transport_unavailable", async () => {
    const out = await runOutboundForNotification(baseNotification(), TOKEN, {
      ...baseDeps(),
      transportFactory: () => ({ ok: false, reason: "access_token_missing" }),
    });
    expect(out.kind).toBe("transport_unavailable");
    if (out.kind === "transport_unavailable") {
      expect(out.reason).toBe("access_token_missing");
    }
  });
});

describe("runOutboundForNotification — executed", () => {
  it("propagates accepted result from executor", async () => {
    const captured: Array<{
      notificationId: string;
      claimToken: string;
      phoneNumberId: string;
      recipient: string;
    }> = [];
    const out = await runOutboundForNotification(baseNotification(), TOKEN, {
      ...baseDeps(),
      execute: async (input) => {
        captured.push({
          notificationId: input.notificationId,
          claimToken: input.claimToken,
          phoneNumberId: input.phoneNumberId,
          recipient: input.recipient,
        });
        return {
          kind: "accepted",
          attemptId: "a-42",
          providerMessageId: "wamid.OK",
        };
      },
    });
    expect(out.kind).toBe("executed");
    if (out.kind === "executed") {
      expect(out.result.kind).toBe("accepted");
    }
    expect(captured).toHaveLength(1);
    expect(captured[0].notificationId).toBe(NID);
    expect(captured[0].claimToken).toBe(TOKEN);
    expect(captured[0].phoneNumberId).toBe("1234567890");
    expect(captured[0].recipient).toBe(RECIPIENT);
  });

  it("propagates rejected result", async () => {
    const out = await runOutboundForNotification(baseNotification(), TOKEN, {
      ...baseDeps(),
      execute: async () => ({
        kind: "rejected",
        attemptId: "a-1",
        errorCode: "131047",
        errorCategory: "permanent",
        retryable: false,
      }),
    });
    expect(out.kind).toBe("executed");
    if (out.kind === "executed") {
      expect(out.result.kind).toBe("rejected");
    }
  });

  it("propagates ambiguous result", async () => {
    const out = await runOutboundForNotification(baseNotification(), TOKEN, {
      ...baseDeps(),
      execute: async () => ({
        kind: "ambiguous",
        attemptId: "a-1",
        reason: "timeout",
      }),
    });
    expect(out.kind).toBe("executed");
    if (out.kind === "executed") {
      expect(out.result.kind).toBe("ambiguous");
    }
  });

  it("propagates state_changed / active_attempt_exists / quarantined / database_error", async () => {
    for (const k of ["state_changed", "active_attempt_exists", "quarantined"] as const) {
      const out = await runOutboundForNotification(baseNotification(), TOKEN, {
        ...baseDeps(),
        execute: async () => ({ kind: k }) as ExecuteResult,
      });
      expect(out.kind).toBe("executed");
      if (out.kind === "executed") expect(out.result.kind).toBe(k);
    }
    const dberr = await runOutboundForNotification(baseNotification(), TOKEN, {
      ...baseDeps(),
      execute: async () => ({ kind: "database_error", error: new Error("boom") }),
    });
    expect(dberr.kind).toBe("executed");
    if (dberr.kind === "executed") expect(dberr.result.kind).toBe("database_error");
  });
});

describe("runOutboundForNotification — logging safety", () => {
  it("never logs token, recipient, or raw payload", async () => {
    const entries: Array<Record<string, unknown>> = [];
    await runOutboundForNotification(baseNotification(), TOKEN, {
      ...baseDeps(),
      logger: (e) => entries.push(e),
    });
    const serialized = JSON.stringify(entries);
    expect(serialized.includes(TOKEN)).toBe(false);
    expect(serialized.includes(RECIPIENT)).toBe(false);
    // payload keys should not appear (values differ from key names)
    expect(serialized.includes("R$ 120,00")).toBe(false);
  });

  it("logs gated event with reasons only (no PII)", async () => {
    const entries: Array<Record<string, unknown>> = [];
    await runOutboundForNotification(baseNotification(), TOKEN, {
      ...baseDeps(),
      gate: () => ({ allowed: false, reasons: ["canary_disabled"] }),
      logger: (e) => entries.push(e),
    });
    const gated = entries.find((e) => e.event === "outbound_gated");
    expect(gated).toBeTruthy();
    expect(JSON.stringify(gated)).toContain("canary_disabled");
  });
});
