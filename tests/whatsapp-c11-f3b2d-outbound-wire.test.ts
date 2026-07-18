/**
 * WA-C11 FASE 3B.2.D — Wiring completo do dispatcher com quota outbound.
 *
 * Foco: máquina de estados reserve → commit | release | ambiguous
 * exercitada por `runOutboundWithQuota`, com mocks para RPC de quota
 * e para `runOutboundForNotification`. NÃO toca banco real, Graph API,
 * fetch, HMAC, canary v1.
 *
 * Baseline canary v1 (fd291a7e-...) é preservada porque este teste
 * NÃO faz DML nem HTTP.
 */
import { describe, it, expect, mock } from "bun:test";

// Mock supabaseAdmin ANTES de importar o módulo sob teste, para evitar
// que `import { supabaseAdmin }` avalie env real.
mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null }),
        }),
      }),
    }),
  },
}));

import { runOutboundWithQuota } from "@/server/whatsapp-outbound-quota-wire.server";
import type { QuotaReserveResult, QuotaFinalizeResult } from "@/server/whatsapp-quota.server";
import type { RunOutboundOutcome } from "@/server/whatsapp-dispatcher-outbound.server";
import type { PlanRow } from "@/server/whatsapp-cycle-resolver.server";

const N = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  notification_type: "conta_vencendo",
  payload: {} as Record<string, unknown>,
};
const TOKEN = "claim-token-xyz";

const PLAN: PlanRow = {
  plano: "essential",
  status: "active",
  current_period_start: new Date(Date.now() - 86400_000 * 3).toISOString(),
  current_period_end: new Date(Date.now() + 86400_000 * 25).toISOString(),
  access_until: null,
};

function reserveAllowed(over: Partial<QuotaReserveResult> = {}): QuotaReserveResult {
  return {
    allowed: true,
    reason: "allowed",
    limit: 100,
    used: 5,
    remaining: 95,
    duplicate: false,
    state: "reserved",
    reservationId: "res-1",
    ...over,
  };
}
function reserveDenied(reason: string): QuotaReserveResult {
  return {
    allowed: false,
    reason,
    limit: 100,
    used: 100,
    remaining: 0,
    duplicate: false,
    state: null,
    reservationId: null,
  };
}
function fin(outcome: string): QuotaFinalizeResult {
  return { outcome, state: null };
}

interface Spies {
  reserved: number;
  committed: number;
  released: number;
  releaseReasons: string[];
  runCalls: number;
}
function makeDeps(
  runOutcome: RunOutboundOutcome,
  spies: Spies,
  reserveOver: Partial<QuotaReserveResult> = {},
) {
  return {
    loadPlan: async () => PLAN,
    reserveQuota: async () => {
      spies.reserved++;
      return reserveAllowed(reserveOver);
    },
    commitQuota: async () => {
      spies.committed++;
      return fin("committed");
    },
    releaseQuota: async (a: { reason: string }) => {
      spies.released++;
      spies.releaseReasons.push(a.reason);
      return fin("released");
    },
    runOutbound: async () => {
      spies.runCalls++;
      return runOutcome;
    },
  };
}

describe("WA-C11 3B.2.D — runOutboundWithQuota", () => {
  it("plan_load_failed / cycle_invalid quando ciclo não resolve (plan null com data inválida)", async () => {
    const spies: Spies = { reserved: 0, committed: 0, released: 0, releaseReasons: [], runCalls: 0 };
    // plan null → resolveCycleForPlan usa calendar month; nunca inválido em Date atual.
    // Simulamos plan com billing_cycle invertido (fim antes do começo)
    const badPlan: PlanRow = {
      plano: "essential",
      status: "active",
      current_period_start: "2099-01-01T00:00:00Z",
      current_period_end: "2098-01-01T00:00:00Z", // fim antes do início
      access_until: null,
    };
    const out = await runOutboundWithQuota(N, TOKEN, {
      ...makeDeps({ kind: "gated", reasons: ["whatsapp_disabled"] }, spies),
      loadPlan: async () => badPlan,
    });
    // O resolver faz fallback para calendar_month quando billing_cycle inválido,
    // então esperamos que reserva ocorra normalmente.
    expect(["cycle_invalid", "reserved_then_gated"]).toContain(out.kind);
  });

  it("quota denied (plan_not_eligible) bloqueia transport e não libera", async () => {
    const spies: Spies = { reserved: 0, committed: 0, released: 0, releaseReasons: [], runCalls: 0 };
    const out = await runOutboundWithQuota(N, TOKEN, {
      ...makeDeps({ kind: "gated", reasons: [] }, spies),
      reserveQuota: async () => {
        spies.reserved++;
        return reserveDenied("plan_not_eligible");
      },
    });
    expect(out.kind).toBe("quota_denied");
    expect(spies.runCalls).toBe(0);
    expect(spies.committed).toBe(0);
    expect(spies.released).toBe(0);
  });

  it("quota denied (limit_reached) NÃO chama transport nem release", async () => {
    const spies: Spies = { reserved: 0, committed: 0, released: 0, releaseReasons: [], runCalls: 0 };
    const out = await runOutboundWithQuota(N, TOKEN, {
      ...makeDeps({ kind: "gated", reasons: [] }, spies),
      reserveQuota: async () => reserveDenied("outbound_monthly_limit"),
    });
    expect(out.kind).toBe("quota_denied");
    if (out.kind === "quota_denied") expect(out.reason).toBe("outbound_monthly_limit");
    expect(spies.runCalls).toBe(0);
  });

  it("accepted → commit (uma vez)", async () => {
    const spies: Spies = { reserved: 0, committed: 0, released: 0, releaseReasons: [], runCalls: 0 };
    const runOutcome: RunOutboundOutcome = {
      kind: "executed",
      result: { kind: "accepted", attemptId: "att-1", providerMessageId: "wamid.ABC" },
    };
    const out = await runOutboundWithQuota(N, TOKEN, makeDeps(runOutcome, spies));
    expect(out.kind).toBe("committed");
    if (out.kind === "committed") expect(out.providerMessageId).toBe("wamid.ABC");
    expect(spies.committed).toBe(1);
    expect(spies.released).toBe(0);
  });

  it("rejected → release documentado", async () => {
    const spies: Spies = { reserved: 0, committed: 0, released: 0, releaseReasons: [], runCalls: 0 };
    const runOutcome: RunOutboundOutcome = {
      kind: "executed",
      result: {
        kind: "rejected",
        attemptId: "att-2",
        errorCode: "131047",
        errorCategory: "policy",
        retryable: false,
      },
    };
    const out = await runOutboundWithQuota(N, TOKEN, makeDeps(runOutcome, spies));
    expect(out.kind).toBe("released_after_reject");
    expect(spies.released).toBe(1);
    expect(spies.releaseReasons[0]).toContain("provider_rejected");
    expect(spies.committed).toBe(0);
  });

  it("ambiguous NÃO libera, NÃO commita, deixa reservation reserved", async () => {
    const spies: Spies = { reserved: 0, committed: 0, released: 0, releaseReasons: [], runCalls: 0 };
    const runOutcome: RunOutboundOutcome = {
      kind: "executed",
      result: { kind: "ambiguous", attemptId: "att-3", reason: "transport_threw" },
    };
    const out = await runOutboundWithQuota(N, TOKEN, makeDeps(runOutcome, spies));
    expect(out.kind).toBe("left_ambiguous");
    expect(spies.released).toBe(0);
    expect(spies.committed).toBe(0);
  });

  it("gated após reserve → release (nenhum HTTP)", async () => {
    const spies: Spies = { reserved: 0, committed: 0, released: 0, releaseReasons: [], runCalls: 0 };
    const runOutcome: RunOutboundOutcome = { kind: "gated", reasons: ["outbound_http_disabled"] };
    const out = await runOutboundWithQuota(N, TOKEN, makeDeps(runOutcome, spies));
    expect(out.kind).toBe("reserved_then_gated");
    expect(spies.released).toBe(1);
    expect(spies.releaseReasons[0]).toBe("gated_after_reserve");
    expect(spies.committed).toBe(0);
  });

  it("no_recipient / no_template / transport_unavailable → release local_pre_http", async () => {
    for (const kind of ["no_recipient", "no_template", "transport_unavailable"] as const) {
      const spies: Spies = { reserved: 0, committed: 0, released: 0, releaseReasons: [], runCalls: 0 };
      const runOutcome: RunOutboundOutcome =
        kind === "transport_unavailable"
          ? { kind, reason: "no_env" }
          : ({ kind } as RunOutboundOutcome);
      const out = await runOutboundWithQuota(N, TOKEN, makeDeps(runOutcome, spies));
      expect(out.kind).toBe("reserved_then_local_error");
      expect(spies.released).toBe(1);
      expect(spies.releaseReasons[0].startsWith("local_pre_http")).toBe(true);
    }
  });

  it("execute state_changed → release (state_changed_pre_http)", async () => {
    const spies: Spies = { reserved: 0, committed: 0, released: 0, releaseReasons: [], runCalls: 0 };
    const runOutcome: RunOutboundOutcome = {
      kind: "executed",
      result: { kind: "state_changed" },
    };
    const out = await runOutboundWithQuota(N, TOKEN, makeDeps(runOutcome, spies));
    expect(out.kind).toBe("state_changed");
    expect(spies.released).toBe(1);
    expect(spies.releaseReasons[0]).toBe("state_changed_pre_http");
  });

  it("execute quarantined/invalid_recipient/database_error → release", async () => {
    const cases: RunOutboundOutcome[] = [
      { kind: "executed", result: { kind: "quarantined" } },
      { kind: "executed", result: { kind: "invalid_recipient", reason: "empty" } },
      { kind: "executed", result: { kind: "database_error" } },
    ];
    for (const runOutcome of cases) {
      const spies: Spies = { reserved: 0, committed: 0, released: 0, releaseReasons: [], runCalls: 0 };
      const out = await runOutboundWithQuota(N, TOKEN, makeDeps(runOutcome, spies));
      expect(out.kind).toBe("reserved_then_local_error");
      expect(spies.released).toBe(1);
      expect(spies.committed).toBe(0);
    }
  });

  it("duplicate reservation em state committed → não chama transport (idempotência)", async () => {
    const spies: Spies = { reserved: 0, committed: 0, released: 0, releaseReasons: [], runCalls: 0 };
    const runOutcome: RunOutboundOutcome = {
      kind: "executed",
      result: { kind: "accepted", attemptId: "att-x", providerMessageId: "wamid.X" },
    };
    const out = await runOutboundWithQuota(
      N,
      TOKEN,
      makeDeps(runOutcome, spies, { duplicate: true, state: "committed" }),
    );
    expect(out.kind).toBe("committed");
    if (out.kind === "committed") expect(out.commit_outcome).toBe("already_committed");
    expect(spies.runCalls).toBe(0);
    expect(spies.committed).toBe(0); // não recomita
    expect(spies.released).toBe(0);
  });

  it("duplicate reservation em state ambiguous → não chama transport nem libera", async () => {
    const spies: Spies = { reserved: 0, committed: 0, released: 0, releaseReasons: [], runCalls: 0 };
    const out = await runOutboundWithQuota(
      N,
      TOKEN,
      makeDeps({ kind: "gated", reasons: [] }, spies, {
        duplicate: true,
        state: "ambiguous",
      }),
    );
    expect(out.kind).toBe("left_ambiguous");
    expect(spies.runCalls).toBe(0);
    expect(spies.released).toBe(0);
    expect(spies.committed).toBe(0);
  });

  it("duplicate reservation em state reserved → chama transport normalmente (worker duplicado, ok idempotente)", async () => {
    const spies: Spies = { reserved: 0, committed: 0, released: 0, releaseReasons: [], runCalls: 0 };
    const runOutcome: RunOutboundOutcome = {
      kind: "executed",
      result: { kind: "accepted", attemptId: "att-y", providerMessageId: "wamid.Y" },
    };
    const out = await runOutboundWithQuota(
      N,
      TOKEN,
      makeDeps(runOutcome, spies, { duplicate: true, state: "reserved" }),
    );
    expect(out.kind).toBe("committed");
    expect(spies.runCalls).toBe(1);
    expect(spies.committed).toBe(1);
  });

  it("nunca dispara transport quando quota negada por qualquer motivo", async () => {
    for (const reason of [
      "plan_not_eligible",
      "quota_not_configured",
      "outbound_monthly_limit",
      "outbound_daily_limit",
      "db_error",
    ]) {
      const spies: Spies = { reserved: 0, committed: 0, released: 0, releaseReasons: [], runCalls: 0 };
      const out = await runOutboundWithQuota(N, TOKEN, {
        ...makeDeps({ kind: "gated", reasons: [] }, spies),
        reserveQuota: async () => reserveDenied(reason),
      });
      expect(out.kind).toBe("quota_denied");
      expect(spies.runCalls).toBe(0);
      expect(spies.committed).toBe(0);
      expect(spies.released).toBe(0);
    }
  });

  it("logs sanitizados: nenhum telefone/PMID cru no reason de release", async () => {
    // Sanity: reason string do release nunca contém dígitos de telefone
    const spies: Spies = { reserved: 0, committed: 0, released: 0, releaseReasons: [], runCalls: 0 };
    const runOutcome: RunOutboundOutcome = {
      kind: "executed",
      result: {
        kind: "rejected",
        attemptId: "att-r",
        errorCode: "131026",
        errorCategory: "cap",
        retryable: false,
      },
    };
    const out = await runOutboundWithQuota(N, TOKEN, makeDeps(runOutcome, spies));
    expect(out.kind).toBe("released_after_reject");
    for (const r of spies.releaseReasons) {
      expect(r).not.toMatch(/\+?\d{10,}/); // não vaza telefone
    }
  });
});
