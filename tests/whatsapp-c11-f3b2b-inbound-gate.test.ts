/**
 * WA-C11 FASE 3B.2.B — Testes de integração do gate inbound produtivo.
 *
 * Cobre a cadeia:
 *   runtime.global_enabled → runtime.inbound_enabled → entitlement
 *   → rollout → ciclo → quota inbound atômica (idempotência = external_id).
 *
 * Testes usam injeção de dependências (parâmetro `deps` de
 * `runInboundProductionGate`) para stubar cada gate sem tocar `mock.module`
 * — tornam-se puros e não dependem do runner de arquivos separados.
 *
 * Nenhum teste chama Meta, Graph API, Gemini, OCR, Whisper ou Supabase real.
 */
import { test, expect } from "bun:test";
import type {
  WhatsAppRuntimeConfig,
} from "@/server/whatsapp-runtime-config.server";
import type {
  EntitlementResult,
} from "@/server/whatsapp-entitlement.server";
import type {
  RolloutDecision,
} from "@/server/whatsapp-rollout.server";
import type {
  QuotaConsumeResult,
} from "@/server/whatsapp-quota.server";
import type { PlanRow } from "@/server/whatsapp-cycle-resolver.server";
import { runInboundProductionGate } from "@/server/whatsapp-c11-gates.server";

const USER = "3324b9f8-ea68-465c-8e1e-ab1cc8caebf1";
const EXT = "wamid.HBgL5511987654321FGh_test_1";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures

function rc(patch: Partial<WhatsAppRuntimeConfig> = {}): WhatsAppRuntimeConfig {
  return {
    global_enabled: true,
    inbound_enabled: true,
    outbound_enabled: false,
    notification_creation_enabled: false,
    new_links_enabled: false,
    rollout_enabled: true,
    rollout_percentage: 100,
    global_daily_outbound_limit: 0,
    maintenance_message_enabled: false,
    reason: null,
    updated_at: null,
    updated_by: null,
    ...patch,
  };
}

const RC_ALL_OFF = rc({
  global_enabled: false,
  inbound_enabled: false,
  rollout_enabled: false,
  rollout_percentage: 0,
});

function ent(patch: Partial<EntitlementResult> = {}): EntitlementResult {
  return {
    allowed: true,
    reason: "allowed",
    plan: null,
    planActive: true,
    featureIncluded: true,
    betaAllowed: true,
    adminMaster: false,
    linkActive: true,
    optInActive: true,
    checkedAt: new Date().toISOString(),
    ...patch,
  };
}

function plan(patch: Partial<PlanRow> = {}): PlanRow {
  const now = new Date();
  const start = new Date(now.getTime() - 5 * 86400_000).toISOString();
  const end = new Date(now.getTime() + 25 * 86400_000).toISOString();
  return {
    plano: "pessoal_premium",
    status: "ativa",
    current_period_start: start,
    current_period_end: end,
    access_until: end,
    ...patch,
  };
}

function quotaOk(patch: Partial<QuotaConsumeResult> = {}): QuotaConsumeResult {
  return {
    allowed: true,
    reason: null,
    limit: 150,
    used: 1,
    remaining: 149,
    duplicate: false,
    state: "committed",
    ...patch,
  };
}

function quotaDenied(reason: string): QuotaConsumeResult {
  return {
    allowed: false,
    reason,
    limit: 150,
    used: 150,
    remaining: 0,
    duplicate: false,
    state: null,
  };
}

interface DepsFactoryArgs {
  runtime?: WhatsAppRuntimeConfig;
  runtimeThrows?: boolean;
  planRow?: PlanRow | null;
  entitlement?: EntitlementResult;
  rollout?: RolloutDecision;
  quota?: QuotaConsumeResult;
  quotaSpy?: (args: unknown) => void;
  entSpy?: (userId: string) => void;
}

function makeDeps(a: DepsFactoryArgs = {}) {
  return {
    readRuntimeConfig: async () => {
      if (a.runtimeThrows) throw new Error("boom");
      return a.runtime ?? rc();
    },
    loadPlanRow: async () => a.planRow ?? plan(),
    getWhatsAppEntitlement: async (userId: string) => {
      a.entSpy?.(userId);
      return a.entitlement ?? ent();
    },
    evaluateRollout: async () =>
      a.rollout ?? ({ allowed: true, reason: null } as RolloutDecision),
    consumeInboundQuota: async (args: unknown) => {
      a.quotaSpy?.(args);
      return a.quota ?? quotaOk();
    },
  } as const;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Runtime OFF: global

test("runtime.global_enabled=false bloqueia mensagem produtiva", async () => {
  let quotaCalled = false;
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({ runtime: RC_ALL_OFF, quotaSpy: () => (quotaCalled = true) }),
  );
  expect(out.allowed).toBe(false);
  expect(out.reason).toBe("runtime_global_off");
  expect(out.quota).toBeNull();
  expect(quotaCalled).toBe(false);
});

test("runtime.inbound_enabled=false bloqueia mensagem produtiva", async () => {
  let quotaCalled = false;
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({
      runtime: rc({ inbound_enabled: false }),
      quotaSpy: () => (quotaCalled = true),
    }),
  );
  expect(out.allowed).toBe(false);
  expect(out.reason).toBe("runtime_inbound_off");
  expect(quotaCalled).toBe(false);
});

test("runtime read throws → fail-closed internal_error", async () => {
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({ runtimeThrows: true }),
  );
  expect(out.allowed).toBe(false);
  expect(out.reason).toBe("internal_error");
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Entitlement

test("entitlement.plan_not_eligible bloqueia (plano gratuito)", async () => {
  let quotaCalled = false;
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({
      planRow: plan({ plano: "free_ads" }),
      entitlement: ent({ allowed: false, reason: "plan_not_eligible" }),
      quotaSpy: () => (quotaCalled = true),
    }),
  );
  expect(out.allowed).toBe(false);
  expect(out.reason).toBe("entitlement_denied");
  expect(quotaCalled).toBe(false);
});

test("entitlement.beta_access_missing bloqueia", async () => {
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({
      entitlement: ent({ allowed: false, reason: "beta_access_missing" }),
    }),
  );
  expect(out.allowed).toBe(false);
  expect(out.reason).toBe("entitlement_denied");
});

test("entitlement.subscription_expired bloqueia", async () => {
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({
      entitlement: ent({ allowed: false, reason: "subscription_expired" }),
    }),
  );
  expect(out.allowed).toBe(false);
  expect(out.reason).toBe("entitlement_denied");
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Rollout

test("rollout_disabled bloqueia mesmo com entitlement OK", async () => {
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({
      runtime: rc({ rollout_enabled: false }),
      rollout: { allowed: false, reason: "rollout_disabled" },
    }),
  );
  expect(out.allowed).toBe(false);
  expect(out.reason).toBe("rollout_denied");
});

test("rollout_percentage=0 bloqueia", async () => {
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({
      runtime: rc({ rollout_percentage: 0 }),
      rollout: { allowed: false, reason: "percentage_zero" },
    }),
  );
  expect(out.allowed).toBe(false);
  expect(out.reason).toBe("rollout_denied");
});

test("rollout bucket_out bloqueia usuário fora do bucket", async () => {
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({ rollout: { allowed: false, reason: "bucket_out" } }),
  );
  expect(out.allowed).toBe(false);
  expect(out.reason).toBe("rollout_denied");
});

test("rollout plan_free_or_manual bloqueia plano gratuito", async () => {
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({
      planRow: plan({ plano: "free_ads" }),
      rollout: { allowed: false, reason: "plan_free_or_manual" },
    }),
  );
  expect(out.allowed).toBe(false);
  expect(out.reason).toBe("rollout_denied");
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Admin Master

test("admin master ignora rollout e quota", async () => {
  let quotaCalled = false;
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({
      entitlement: ent({ reason: "admin_master", adminMaster: true, plan: "admin_master" }),
      // se admin fosse checar rollout, seria negado:
      rollout: { allowed: false, reason: "bucket_out" },
      quotaSpy: () => (quotaCalled = true),
    }),
  );
  expect(out.allowed).toBe(true);
  expect(out.adminMaster).toBe(true);
  expect(out.reason).toBe("allowed");
  expect(quotaCalled).toBe(false); // admin master pula quota
});

test("admin master NÃO ignora runtime global OFF", async () => {
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({
      runtime: rc({ global_enabled: false }),
      entitlement: ent({ reason: "admin_master", adminMaster: true }),
    }),
  );
  expect(out.allowed).toBe(false);
  expect(out.reason).toBe("runtime_global_off");
});

test("admin master NÃO ignora runtime inbound OFF (kill switch)", async () => {
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({
      runtime: rc({ inbound_enabled: false }),
      entitlement: ent({ reason: "admin_master", adminMaster: true }),
    }),
  );
  expect(out.allowed).toBe(false);
  expect(out.reason).toBe("runtime_inbound_off");
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Ciclo

test("ciclo billing válido é preferido sobre calendar_month", async () => {
  const now = new Date("2026-07-15T12:00:00Z");
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    {
      ...makeDeps({
        planRow: plan({
          current_period_start: "2026-07-01T00:00:00Z",
          current_period_end: "2026-08-01T00:00:00Z",
        }),
      }),
      now: () => now,
    },
  );
  expect(out.allowed).toBe(true);
  expect(out.cycleSource).toBe("billing_cycle");
});

test("fallback calendar_month quando plan sem period", async () => {
  const now = new Date("2026-07-15T12:00:00Z");
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    {
      ...makeDeps({
        planRow: plan({ current_period_start: null, current_period_end: null }),
      }),
      now: () => now,
    },
  );
  expect(out.allowed).toBe(true);
  expect(out.cycleSource).toBe("calendar_month");
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Quota

test("quota disponível: consome e libera", async () => {
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({ quota: quotaOk({ used: 42, remaining: 108 }) }),
  );
  expect(out.allowed).toBe(true);
  expect(out.reason).toBe("allowed");
  expect(out.duplicate).toBe(false);
  expect(out.quota?.remaining).toBe(108);
});

test("quota mensal atingida bloqueia (limit_reached)", async () => {
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({ quota: quotaDenied("monthly_limit_reached") }),
  );
  expect(out.allowed).toBe(false);
  expect(out.reason).toBe("quota_denied");
  expect(out.quota?.remaining).toBe(0);
});

test("quota diária atingida bloqueia (daily_limit_reached)", async () => {
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({ quota: quotaDenied("daily_limit_reached") }),
  );
  expect(out.allowed).toBe(false);
  expect(out.reason).toBe("quota_denied");
});

test("quota per_minute atingida bloqueia", async () => {
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({ quota: quotaDenied("per_minute_limit_reached") }),
  );
  expect(out.allowed).toBe(false);
  expect(out.reason).toBe("quota_denied");
});

test("RPC quota com erro bloqueia (fail-closed db_error)", async () => {
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({ quota: quotaDenied("db_error") }),
  );
  expect(out.allowed).toBe(false);
  expect(out.reason).toBe("quota_denied");
});

test("mensagem duplicada: retorna duplicate=true, allowed=true", async () => {
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({ quota: quotaOk({ duplicate: true }) }),
  );
  expect(out.allowed).toBe(true);
  expect(out.duplicate).toBe(true);
  expect(out.reason).toBe("duplicate");
});

test("idempotency key = external_message_id (não timestamp, não texto)", async () => {
  const captured: Array<Record<string, unknown>> = [];
  await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({
      quotaSpy: (args) => captured.push(args as Record<string, unknown>),
    }),
  );
  expect(captured.length).toBe(1);
  expect((captured[0] as { inboundMessageId?: string }).inboundMessageId).toBe(EXT);
  expect((captured[0] as { userId?: string }).userId).toBe(USER);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Invariantes de segurança

test("userId inválido bloqueia sem tocar em runtime/quota", async () => {
  let ran = false;
  const out = await runInboundProductionGate(
    { userId: "", externalMessageId: EXT },
    {
      readRuntimeConfig: async () => {
        ran = true;
        return rc();
      },
    },
  );
  expect(out.allowed).toBe(false);
  expect(out.reason).toBe("internal_error");
  expect(ran).toBe(false);
});

test("externalMessageId vazio bloqueia sem consumir quota", async () => {
  let quotaCalled = false;
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: "" },
    makeDeps({ quotaSpy: () => (quotaCalled = true) }),
  );
  expect(out.allowed).toBe(false);
  expect(out.reason).toBe("internal_error");
  expect(quotaCalled).toBe(false);
});

test("ordem de gates: runtime bloqueia ANTES de entitlement/quota", async () => {
  let entCalled = false;
  let quotaCalled = false;
  const out = await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({
      runtime: RC_ALL_OFF,
      entSpy: () => (entCalled = true),
      quotaSpy: () => (quotaCalled = true),
    }),
  );
  expect(out.allowed).toBe(false);
  expect(entCalled).toBe(false);
  expect(quotaCalled).toBe(false);
});

test("ordem de gates: entitlement bloqueia ANTES de quota", async () => {
  let quotaCalled = false;
  await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({
      entitlement: ent({ allowed: false, reason: "plan_not_eligible" }),
      quotaSpy: () => (quotaCalled = true),
    }),
  );
  expect(quotaCalled).toBe(false);
});

test("ordem: rollout bloqueia ANTES de quota", async () => {
  let quotaCalled = false;
  await runInboundProductionGate(
    { userId: USER, externalMessageId: EXT },
    makeDeps({
      rollout: { allowed: false, reason: "bucket_out" },
      quotaSpy: () => (quotaCalled = true),
    }),
  );
  expect(quotaCalled).toBe(false);
});
