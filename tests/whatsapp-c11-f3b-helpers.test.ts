/**
 * WA-C11 FASE 3B — Testes unitários dos helpers server-side (B.1).
 *
 * Cobre:
 *  - cycle-resolver: billing_cycle válido, fallback mensal SP, ciclo invertido, ausência de plano.
 *  - rollout: precedência env/runtime, plano gratuito bloqueado, beta obrigatório,
 *    percentual 0/100, bucket in/out.
 *  - runtime-config: fail-closed em erro, coerção de bool/int, reason obrigatório,
 *    percentual fora do range rejeitado.
 *  - quota: normalização de retornos, tratamento de erro RPC (fail-closed),
 *    idempotência via chave.
 *
 * ZERO efeitos colaterais reais: todo Supabase é injetado como stub.
 */
import { describe, expect, it } from "bun:test";
import {
  calendarMonthCycleSaoPaulo,
  resolveCycleForPlan,
} from "@/server/whatsapp-cycle-resolver.server";
import { evaluateRolloutSync, evaluateRollout, isPaidPlan } from "@/server/whatsapp-rollout.server";
import {
  FAIL_CLOSED_RUNTIME,
  readRuntimeConfig,
  requiresReason,
  updateRuntimeConfig,
} from "@/server/whatsapp-runtime-config.server";
import {
  commitOutboundQuota,
  consumeFinancialActionQuota,
  consumeInboundQuota,
  getUsageSnapshot,
  releaseOutboundQuota,
  reserveOutboundQuota,
} from "@/server/whatsapp-quota.server";

// ─────────────────────────────────────────────────────────────────────────────
// Cycle resolver

describe("cycle-resolver: calendar month in SP", () => {
  it("returns first-of-month..first-of-next-month in SP for mid-July", () => {
    const now = new Date("2026-07-15T12:00:00Z");
    const c = calendarMonthCycleSaoPaulo(now);
    expect(c.source).toBe("calendar_month");
    expect(c.cycleStart.getTime()).toBeLessThan(c.cycleEnd.getTime());
    // Start deve ser <= now e end > now
    expect(c.cycleStart.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(c.cycleEnd.getTime()).toBeGreaterThan(now.getTime());
    // Duração aproximada de 28-31 dias
    const days = (c.cycleEnd.getTime() - c.cycleStart.getTime()) / 86400000;
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(31);
  });

  it("handles month boundary at SP local midnight", () => {
    // 1º de agosto 03:00 UTC = 00:00 de 1º de agosto SP (offset -3)
    const now = new Date("2026-08-01T03:00:00Z");
    const c = calendarMonthCycleSaoPaulo(now);
    expect(c.cycleStart.toISOString()).toBe("2026-08-01T03:00:00.000Z");
  });
});

describe("cycle-resolver: resolveCycleForPlan", () => {
  it("uses billing cycle when valid and end > now", () => {
    const now = new Date("2026-07-15T12:00:00Z");
    const c = resolveCycleForPlan(
      {
        plano: "pessoal_premium",
        status: "ativo",
        current_period_start: "2026-07-10T00:00:00Z",
        current_period_end: "2026-08-10T00:00:00Z",
        access_until: null,
      },
      now,
    );
    expect(c.source).toBe("billing_cycle");
    expect(c.cycleStart.toISOString()).toBe("2026-07-10T00:00:00.000Z");
    expect(c.cycleEnd.toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });

  it("falls back to calendar month when plan is null", () => {
    const now = new Date("2026-07-15T12:00:00Z");
    const c = resolveCycleForPlan(null, now);
    expect(c.source).toBe("calendar_month");
  });

  it("falls back when billing end has passed", () => {
    const now = new Date("2026-07-15T12:00:00Z");
    const c = resolveCycleForPlan(
      {
        plano: "pessoal_premium",
        status: "ativo",
        current_period_start: "2026-06-01T00:00:00Z",
        current_period_end: "2026-07-01T00:00:00Z", // expirado
        access_until: null,
      },
      now,
    );
    expect(c.source).toBe("calendar_month");
  });

  it("falls back when start >= end (inverted)", () => {
    const now = new Date("2026-07-15T12:00:00Z");
    const c = resolveCycleForPlan(
      {
        plano: "pessoal_premium",
        status: "ativo",
        current_period_start: "2026-08-01T00:00:00Z",
        current_period_end: "2026-07-01T00:00:00Z",
        access_until: null,
      },
      now,
    );
    expect(c.source).toBe("calendar_month");
  });

  it("falls back when dates are malformed", () => {
    const c = resolveCycleForPlan(
      {
        plano: "pessoal_premium",
        status: "ativo",
        current_period_start: "not-a-date",
        current_period_end: "also-not-a-date",
        access_until: null,
      },
      new Date("2026-07-15T12:00:00Z"),
    );
    expect(c.source).toBe("calendar_month");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rollout

describe("rollout: isPaidPlan", () => {
  it("recognizes free tiers as ineligible", () => {
    expect(isPaidPlan("free")).toBe(false);
    expect(isPaidPlan("free_ads")).toBe(false);
    expect(isPaidPlan("sem_assinatura")).toBe(false);
    expect(isPaidPlan("pessoal_manual")).toBe(false);
  });
  it("recognizes paid tiers as eligible", () => {
    expect(isPaidPlan("pessoal_premium")).toBe(true);
    expect(isPaidPlan("mei_essencial")).toBe(true);
    expect(isPaidPlan("mei_inteligente")).toBe(true);
    expect(isPaidPlan("empresa")).toBe(true);
  });
  it("treats null/unknown as ineligible", () => {
    expect(isPaidPlan(null)).toBe(false);
    expect(isPaidPlan(undefined)).toBe(false);
  });
});

describe("rollout: evaluateRolloutSync (pure decision matrix)", () => {
  const base = {
    userId: "u-1",
    planCode: "pessoal_premium",
    betaAllowed: true,
    rolloutEnabled: true,
    rolloutPercentage: 50,
    bucketIn: true,
  };
  it("allows when all gates pass", () => {
    expect(evaluateRolloutSync(base)).toEqual({ allowed: true, reason: null });
  });
  it("blocks free plan even if bucket in and beta allowed", () => {
    expect(evaluateRolloutSync({ ...base, planCode: "free_ads" }).reason).toBe(
      "plan_free_or_manual",
    );
  });
  it("blocks when beta denied", () => {
    expect(evaluateRolloutSync({ ...base, betaAllowed: false }).reason).toBe("beta_denied");
  });
  it("blocks when rollout disabled", () => {
    expect(evaluateRolloutSync({ ...base, rolloutEnabled: false }).reason).toBe("rollout_disabled");
  });
  it("blocks at percentage zero", () => {
    expect(evaluateRolloutSync({ ...base, rolloutPercentage: 0 }).reason).toBe("percentage_zero");
  });
  it("blocks when bucket out", () => {
    expect(evaluateRolloutSync({ ...base, bucketIn: false }).reason).toBe("bucket_out");
  });
});

describe("rollout: evaluateRollout (with injected RPC)", () => {
  it("short-circuits before RPC when plan is free", async () => {
    let called = 0;
    const client = {
      rpc: async () => {
        called++;
        return { data: true, error: null };
      },
    };
    const r = await evaluateRollout(
      {
        userId: "u-1",
        planCode: "free_ads",
        betaAllowed: true,
        rolloutEnabled: true,
        rolloutPercentage: 100,
      },
      client,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("plan_free_or_manual");
    expect(called).toBe(0);
  });

  it("calls RPC and honors bucketIn=false", async () => {
    const client = {
      rpc: async (_name: string, _params: unknown) => ({ data: false, error: null }),
    };
    const r = await evaluateRollout(
      {
        userId: "u-1",
        planCode: "pessoal_premium",
        betaAllowed: true,
        rolloutEnabled: true,
        rolloutPercentage: 50,
      },
      client,
    );
    expect(r).toEqual({ allowed: false, reason: "bucket_out" });
  });

  it("fail-closes on RPC error (treats as bucket_out)", async () => {
    const client = {
      rpc: async () => ({ data: null, error: { code: "PGRST" } }),
    };
    const r = await evaluateRollout(
      {
        userId: "u-1",
        planCode: "pessoal_premium",
        betaAllowed: true,
        rolloutEnabled: true,
        rolloutPercentage: 50,
      },
      client,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("bucket_out");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Runtime config

describe("runtime-config: readRuntimeConfig", () => {
  it("returns FAIL_CLOSED on missing row", async () => {
    const client = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
    };
    const c = await readRuntimeConfig(client);
    expect(c).toEqual({ ...FAIL_CLOSED_RUNTIME });
  });

  it("returns FAIL_CLOSED on DB error", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: "42P01" } }) }),
        }),
      }),
    };
    const c = await readRuntimeConfig(client);
    expect(c.global_enabled).toBe(false);
    expect(c.rollout_percentage).toBe(0);
  });

  it("coerces booleans and clamps rollout percentage", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                global_enabled: 1, // não é boolean estrito
                inbound_enabled: true,
                outbound_enabled: "true",
                notification_creation_enabled: null,
                new_links_enabled: false,
                rollout_enabled: true,
                rollout_percentage: 250, // fora do range
                global_daily_outbound_limit: -5,
                maintenance_message_enabled: false,
                reason: "canary",
                updated_at: "2026-07-15T00:00:00Z",
                updated_by: "u-admin",
              },
              error: null,
            }),
          }),
        }),
      }),
    };
    const c = await readRuntimeConfig(client);
    expect(c.global_enabled).toBe(false); // 1 !== true
    expect(c.inbound_enabled).toBe(true);
    expect(c.outbound_enabled).toBe(false); // "true" string !== true
    expect(c.rollout_enabled).toBe(true);
    expect(c.rollout_percentage).toBe(100); // clamp
    expect(c.global_daily_outbound_limit).toBe(0); // clamp
    expect(c.reason).toBe("canary");
  });
});

describe("runtime-config: requiresReason", () => {
  it("requires reason for sensitive fields", () => {
    expect(requiresReason({ global_enabled: true })).toBe(true);
    expect(requiresReason({ outbound_enabled: false })).toBe(true);
    expect(requiresReason({ rollout_enabled: true })).toBe(true);
    expect(requiresReason({ rollout_percentage: 10 })).toBe(true);
    expect(requiresReason({ global_daily_outbound_limit: 100 })).toBe(true);
  });
  it("does not require reason for cosmetic fields", () => {
    expect(requiresReason({ maintenance_message_enabled: true })).toBe(false);
    expect(requiresReason({ new_links_enabled: true })).toBe(false);
    expect(requiresReason({ inbound_enabled: false })).toBe(false);
    expect(requiresReason({ notification_creation_enabled: true })).toBe(false);
  });
});

describe("runtime-config: updateRuntimeConfig", () => {
  it("rejects when reason is missing for sensitive change", async () => {
    const client = { from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) };
    const r = await updateRuntimeConfig(
      { global_enabled: true },
      { adminUserId: "admin-1", reason: null },
      client,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("reason_required");
  });

  it("rejects invalid percentage", async () => {
    const client = { from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) };
    const r = await updateRuntimeConfig(
      { rollout_percentage: 999 },
      { adminUserId: "admin-1", reason: "canary bump" },
      client,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_patch");
  });

  it("accepts valid patch with reason and returns fresh config", async () => {
    let updateCalled = 0;
    const rows = {
      global_enabled: true,
      inbound_enabled: false,
      outbound_enabled: false,
      notification_creation_enabled: false,
      new_links_enabled: false,
      rollout_enabled: false,
      rollout_percentage: 0,
      global_daily_outbound_limit: 0,
      maintenance_message_enabled: false,
      reason: "manual test",
      updated_at: "2026-07-16T00:00:00Z",
      updated_by: "admin-1",
    };
    const client = {
      from: () => ({
        update: (_v: unknown) => ({
          eq: async () => {
            updateCalled++;
            return { error: null };
          },
        }),
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: rows, error: null }) }),
        }),
      }),
    };
    const r = await updateRuntimeConfig(
      { global_enabled: true },
      { adminUserId: "admin-1", reason: "manual test" },
      client,
    );
    expect(r.ok).toBe(true);
    expect(updateCalled).toBe(1);
    if (r.ok) expect(r.config.global_enabled).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Quota helper

const CYCLE = {
  cycleStart: new Date("2026-07-01T03:00:00Z"),
  cycleEnd: new Date("2026-08-01T03:00:00Z"),
};

function stubRpc(response: { data: unknown; error: unknown }) {
  const calls: Array<{ name: string; params: unknown }> = [];
  const client = {
    rpc: async (name: string, params: unknown) => {
      calls.push({ name, params });
      return response;
    },
  };
  return { client, calls };
}

describe("quota: consumeInboundQuota", () => {
  it("returns denied+db_error on RPC failure (fail-closed)", async () => {
    const { client } = stubRpc({ data: null, error: { code: "PGRST" } });
    const r = await consumeInboundQuota(
      {
        userId: "u-1",
        inboundMessageId: "wamid.abc",
        planCode: "pessoal_premium",
        cycle: CYCLE,
      },
      client,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("db_error");
  });

  it("passes exact contract to the RPC", async () => {
    const { client, calls } = stubRpc({
      data: [
        {
          allowed: true,
          reason: null,
          limit: 150,
          used: 1,
          remaining: 149,
          duplicate: false,
          state: "consumed",
        },
      ],
      error: null,
    });
    const r = await consumeInboundQuota(
      {
        userId: "u-1",
        inboundMessageId: "wamid.abc",
        planCode: "pessoal_premium",
        cycle: CYCLE,
        now: new Date("2026-07-15T12:00:00Z"),
      },
      client,
    );
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(149);
    expect(calls[0].name).toBe("whatsapp_consume_inbound_quota_atomic");
    const p = calls[0].params as Record<string, string>;
    expect(p.p_user_id).toBe("u-1");
    expect(p.p_inbound_message_id).toBe("wamid.abc");
    expect(p.p_plan_code).toBe("pessoal_premium");
    expect(p.p_cycle_start).toBe("2026-07-01T03:00:00.000Z");
    expect(p.p_cycle_end).toBe("2026-08-01T03:00:00.000Z");
    expect(p.p_now).toBe("2026-07-15T12:00:00.000Z");
  });

  it("surfaces duplicate=true from RPC (idempotency)", async () => {
    const { client } = stubRpc({
      data: [
        {
          allowed: true,
          reason: null,
          limit: 150,
          used: 1,
          remaining: 149,
          duplicate: true,
          state: "consumed",
        },
      ],
      error: null,
    });
    const r = await consumeInboundQuota(
      { userId: "u-1", inboundMessageId: "wamid.abc", planCode: "pessoal_premium", cycle: CYCLE },
      client,
    );
    expect(r.duplicate).toBe(true);
    expect(r.allowed).toBe(true);
  });
});

describe("quota: consumeFinancialActionQuota", () => {
  it("calls the right RPC with idempotency_key", async () => {
    const { client, calls } = stubRpc({
      data: [
        {
          allowed: true,
          reason: null,
          limit: 100,
          used: 1,
          remaining: 99,
          duplicate: false,
          state: "consumed",
        },
      ],
      error: null,
    });
    await consumeFinancialActionQuota(
      {
        userId: "u-1",
        idempotencyKey: "wamid.abc:gasto",
        planCode: "pessoal_premium",
        cycle: CYCLE,
      },
      client,
    );
    expect(calls[0].name).toBe("whatsapp_consume_financial_action_quota_atomic");
    const p = calls[0].params as Record<string, unknown>;
    expect(p.p_idempotency_key).toBe("wamid.abc:gasto");
  });
});

describe("quota: reserve/commit/release outbound", () => {
  it("reserve returns reservationId", async () => {
    const { client } = stubRpc({
      data: [
        {
          allowed: true,
          reason: null,
          limit: 75,
          used: 0,
          remaining: 74,
          reservation_id: "res-1",
          duplicate: false,
          state: "reserved",
        },
      ],
      error: null,
    });
    const r = await reserveOutboundQuota(
      { userId: "u-1", notificationId: "n-1", planCode: "pessoal_premium", cycle: CYCLE },
      client,
    );
    expect(r.allowed).toBe(true);
    expect(r.reservationId).toBe("res-1");
    expect(r.state).toBe("reserved");
  });

  it("commit calls RPC and returns outcome/state", async () => {
    const { client, calls } = stubRpc({
      data: [{ outcome: "committed", state: "committed" }],
      error: null,
    });
    const r = await commitOutboundQuota(
      { userId: "u-1", notificationId: "n-1", providerMessageId: "pmid-1" },
      client,
    );
    expect(r.outcome).toBe("committed");
    expect(calls[0].name).toBe("whatsapp_commit_outbound_quota_atomic");
    const p = calls[0].params as Record<string, unknown>;
    expect(p.p_provider_message_id).toBe("pmid-1");
  });

  it("release surfaces ambiguous_preserved (never frees ambiguous)", async () => {
    const { client } = stubRpc({
      data: [{ outcome: "ambiguous_preserved", state: "ambiguous" }],
      error: null,
    });
    const r = await releaseOutboundQuota(
      { userId: "u-1", notificationId: "n-1", reason: "transport_error" },
      client,
    );
    expect(r.outcome).toBe("ambiguous_preserved");
    expect(r.state).toBe("ambiguous");
  });

  it("release fail-closes to db_error on RPC error", async () => {
    const { client } = stubRpc({ data: null, error: { code: "PGRST" } });
    const r = await releaseOutboundQuota(
      { userId: "u-1", notificationId: "n-1", reason: "test" },
      client,
    );
    expect(r.outcome).toBe("db_error");
  });
});

describe("quota: getUsageSnapshot", () => {
  it("returns null on error", async () => {
    const { client } = stubRpc({ data: null, error: { code: "PGRST" } });
    const s = await getUsageSnapshot(
      { userId: "u-1", planCode: "pessoal_premium", cycle: CYCLE },
      client,
    );
    expect(s).toBeNull();
  });

  it("normalizes numeric fields", async () => {
    const { client } = stubRpc({
      data: [
        {
          plan_code: "pessoal_premium",
          inbound_limit: 150,
          inbound_used: 10,
          outbound_limit: 75,
          outbound_reserved: 2,
          outbound_committed: 5,
          financial_limit: 100,
          financial_used: 3,
          daily_inbound_limit: 30,
          daily_inbound_used: 4,
          daily_outbound_limit: 15,
          daily_outbound_used: 1,
          cycle_start: "2026-07-01T03:00:00Z",
          cycle_end: "2026-08-01T03:00:00Z",
        },
      ],
      error: null,
    });
    const s = await getUsageSnapshot(
      { userId: "u-1", planCode: "pessoal_premium", cycle: CYCLE },
      client,
    );
    expect(s).not.toBeNull();
    if (s) {
      expect(s.inboundUsed).toBe(10);
      expect(s.outboundCommitted).toBe(5);
      expect(s.financialUsed).toBe(3);
    }
  });
});
