/**
 * WA-C11 FASE 3B.2.C — Testes do Financial Action Quota Gate.
 *
 * Cobre a cadeia canônica:
 *   runtime.global_enabled → entitlement → cycle → consumeFinancialActionQuota
 *
 * Sem tocar Supabase real, sem tocar Meta, sem escritas financeiras.
 * Dependências injetadas via `FinancialGateDeps`.
 */
import { describe, expect, it } from "vitest";
import {
  assertFinancialActionQuotaForWhatsApp,
  buildFinancialActionKey,
  financialQuotaBlockedReply,
  type FinancialGateDeps,
} from "@/server/whatsapp-financial-quota-gate.server";

const NOW = new Date("2026-07-17T15:00:00.000Z");
const USER = "00000000-0000-0000-0000-0000000000aa";
const MSGID = "wamid.HBgL553133333333FAIQg";

function baseDeps(overrides: Partial<FinancialGateDeps> = {}): FinancialGateDeps {
  return {
    now: () => NOW,
    readRuntimeConfig: async () =>
      ({
        global_enabled: true,
        outbound_http_enabled: false,
        dispatch_enabled: false,
        canary_only: false,
        rollout_bucket_max: 0,
        allowlist_user_ids: [] as string[],
        blocklist_user_ids: [] as string[],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    getWhatsAppEntitlement: async () => ({
      allowed: true,
      reason: "allowed" as const,
      planTier: "premium_annual",
      adminMaster: false,
      betaEnabled: true,
    }),
    loadPlanRow: async () => ({
      plano: "premium_annual",
      status: "active",
      current_period_start: "2026-07-01",
      current_period_end: "2026-08-01",
      access_until: null,
    }),
    consumeFinancialActionQuota: async () => ({
      allowed: true,
      duplicate: false,
      reason: "allowed" as const,
      limit: 500,
      used: 42,
      remaining: 458,
    }),
    ...overrides,
  };
}

describe("buildFinancialActionKey", () => {
  it("gera key estável determinística", () => {
    expect(buildFinancialActionKey(MSGID, "expense")).toBe(
      `wa:financial:${MSGID}:expense:v1`,
    );
  });

  it("inclui discriminator quando fornecido", () => {
    expect(buildFinancialActionKey(MSGID, "installment", "p3")).toBe(
      `wa:financial:${MSGID}:installment:p3:v1`,
    );
  });

  it("mesma mensagem + mesma action = mesma key (idempotência natural)", () => {
    const a = buildFinancialActionKey(MSGID, "bill_create_boleto");
    const b = buildFinancialActionKey(MSGID, "bill_create_boleto");
    expect(a).toBe(b);
  });

  it("actions diferentes na mesma msg = keys distintas", () => {
    expect(buildFinancialActionKey(MSGID, "expense")).not.toBe(
      buildFinancialActionKey(MSGID, "expense_receipt"),
    );
  });
});

describe("assertFinancialActionQuotaForWhatsApp — input validation", () => {
  it("rejeita userId ausente com internal-ish invalid_input", async () => {
    const r = await assertFinancialActionQuotaForWhatsApp(
      { userId: "", externalMessageId: MSGID, actionType: "expense" },
      baseDeps(),
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("invalid_input");
  });

  it("rejeita externalMessageId vazio", async () => {
    const r = await assertFinancialActionQuotaForWhatsApp(
      { userId: USER, externalMessageId: "", actionType: "expense" },
      baseDeps(),
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("invalid_input");
  });

  it("rejeita externalMessageId só-whitespace", async () => {
    const r = await assertFinancialActionQuotaForWhatsApp(
      { userId: USER, externalMessageId: "   ", actionType: "expense" },
      baseDeps(),
    );
    expect(r.reason).toBe("invalid_input");
  });
});

describe("assertFinancialActionQuotaForWhatsApp — runtime kill switch", () => {
  it("bloqueia quando global_enabled=false (mesmo admin master)", async () => {
    const r = await assertFinancialActionQuotaForWhatsApp(
      { userId: USER, externalMessageId: MSGID, actionType: "expense" },
      baseDeps({
        readRuntimeConfig: async () =>
          ({
            global_enabled: false,
            outbound_http_enabled: false,
            dispatch_enabled: false,
            canary_only: false,
            rollout_bucket_max: 0,
            allowlist_user_ids: [],
            blocklist_user_ids: [],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any,
        getWhatsAppEntitlement: async () => ({
          allowed: true,
          reason: "allowed",
          planTier: "admin_master",
          adminMaster: true,
          betaEnabled: true,
        }),
      }),
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("runtime_global_off");
  });
});

describe("assertFinancialActionQuotaForWhatsApp — entitlement", () => {
  it("bloqueia quando entitlement.allowed=false", async () => {
    const r = await assertFinancialActionQuotaForWhatsApp(
      { userId: USER, externalMessageId: MSGID, actionType: "expense" },
      baseDeps({
        getWhatsAppEntitlement: async () => ({
          allowed: false,
          reason: "no_beta_access",
          planTier: "free_ads",
          adminMaster: false,
          betaEnabled: false,
        }),
      }),
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("entitlement_denied");
  });

  it("admin master: allowed=true, adminMaster=true, sem quota consumida", async () => {
    let consumed = false;
    const r = await assertFinancialActionQuotaForWhatsApp(
      { userId: USER, externalMessageId: MSGID, actionType: "expense" },
      baseDeps({
        getWhatsAppEntitlement: async () => ({
          allowed: true,
          reason: "allowed",
          planTier: "admin_master",
          adminMaster: true,
          betaEnabled: true,
        }),
        consumeFinancialActionQuota: async () => {
          consumed = true;
          return {
            allowed: true,
            duplicate: false,
            reason: "allowed",
            limit: 0,
            used: 0,
            remaining: 0,
          };
        },
      }),
    );
    expect(r.allowed).toBe(true);
    expect(r.adminMaster).toBe(true);
    expect(consumed).toBe(false);
  });
});

describe("assertFinancialActionQuotaForWhatsApp — cycle", () => {
  it("bloqueia quando cycle.source=invalid", async () => {
    const r = await assertFinancialActionQuotaForWhatsApp(
      { userId: USER, externalMessageId: MSGID, actionType: "expense" },
      baseDeps({
        loadPlanRow: async () => ({
          plano: "premium_annual",
          status: "canceled",
          current_period_start: null,
          current_period_end: null,
          access_until: null,
        }),
      }),
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("cycle_invalid");
  });
});

describe("assertFinancialActionQuotaForWhatsApp — quota", () => {
  it("bloqueia quando quota.allowed=false", async () => {
    const r = await assertFinancialActionQuotaForWhatsApp(
      { userId: USER, externalMessageId: MSGID, actionType: "expense" },
      baseDeps({
        consumeFinancialActionQuota: async () => ({
          allowed: false,
          duplicate: false,
          reason: "monthly_cap",
          limit: 100,
          used: 100,
          remaining: 0,
        }),
      }),
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("quota_denied");
    expect(r.quota?.remaining).toBe(0);
  });

  it("duplicate=true: allowed sem novo consumo, remaining preservado", async () => {
    const r = await assertFinancialActionQuotaForWhatsApp(
      { userId: USER, externalMessageId: MSGID, actionType: "expense" },
      baseDeps({
        consumeFinancialActionQuota: async () => ({
          allowed: true,
          duplicate: true,
          reason: "duplicate",
          limit: 500,
          used: 42,
          remaining: 458,
        }),
      }),
    );
    expect(r.allowed).toBe(true);
    expect(r.duplicate).toBe(true);
    expect(r.reason).toBe("duplicate");
  });

  it("allowed: quota consumida, duplicate=false", async () => {
    const r = await assertFinancialActionQuotaForWhatsApp(
      { userId: USER, externalMessageId: MSGID, actionType: "expense" },
      baseDeps(),
    );
    expect(r.allowed).toBe(true);
    expect(r.duplicate).toBe(false);
    expect(r.reason).toBe("allowed");
    expect(r.quota?.remaining).toBe(458);
  });

  it("idempotencyKey retornado inclui action type", async () => {
    const r = await assertFinancialActionQuotaForWhatsApp(
      {
        userId: USER,
        externalMessageId: MSGID,
        actionType: "bill_create_boleto",
      },
      baseDeps(),
    );
    expect(r.idempotencyKey).toBe(`wa:financial:${MSGID}:bill_create_boleto:v1`);
  });
});

describe("assertFinancialActionQuotaForWhatsApp — fail-closed em exceções", () => {
  it("runtime lança → internal_error", async () => {
    const r = await assertFinancialActionQuotaForWhatsApp(
      { userId: USER, externalMessageId: MSGID, actionType: "expense" },
      baseDeps({
        readRuntimeConfig: async () => {
          throw new Error("db down");
        },
      }),
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("internal_error");
  });

  it("entitlement lança → internal_error", async () => {
    const r = await assertFinancialActionQuotaForWhatsApp(
      { userId: USER, externalMessageId: MSGID, actionType: "expense" },
      baseDeps({
        getWhatsAppEntitlement: async () => {
          throw new Error("plan lookup failed");
        },
      }),
    );
    expect(r.reason).toBe("internal_error");
  });

  it("consume lança → internal_error", async () => {
    const r = await assertFinancialActionQuotaForWhatsApp(
      { userId: USER, externalMessageId: MSGID, actionType: "expense" },
      baseDeps({
        consumeFinancialActionQuota: async () => {
          throw new Error("advisory lock timeout");
        },
      }),
    );
    expect(r.reason).toBe("internal_error");
  });
});

describe("financialQuotaBlockedReply", () => {
  it("quota_denied: mensagem sem PII, sem valor detalhado", async () => {
    const msg = financialQuotaBlockedReply({
      allowed: false,
      reason: "quota_denied",
      duplicate: false,
      adminMaster: false,
      planCode: "free_ads",
      idempotencyKey: "wa:financial:x:expense:v1",
      cycleSource: "plan_period",
      quota: { limit: 20, used: 20, remaining: 0 },
    });
    expect(msg).toMatch(/limite mensal/i);
    expect(msg).not.toMatch(/\d{2,}/); // sem números específicos
  });

  it("entitlement_denied: mensagem neutra", () => {
    const msg = financialQuotaBlockedReply({
      allowed: false,
      reason: "entitlement_denied",
      duplicate: false,
      adminMaster: false,
      planCode: null,
      idempotencyKey: null,
      cycleSource: null,
      quota: null,
    });
    expect(msg).toMatch(/não está habilitado/i);
  });

  it("internal_error: mensagem genérica de retry", () => {
    const msg = financialQuotaBlockedReply({
      allowed: false,
      reason: "internal_error",
      duplicate: false,
      adminMaster: false,
      planCode: null,
      idempotencyKey: null,
      cycleSource: null,
      quota: null,
    });
    expect(msg).toMatch(/tente novamente|use o app/i);
  });
});
