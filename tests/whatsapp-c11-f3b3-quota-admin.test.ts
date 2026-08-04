/**
 * WA-C11 FASE 3B.3 — Plan Quotas Admin.
 */
import { describe, test, expect } from "bun:test";

type QuotaFields = {
  plan_code: string;
  inbound_monthly_limit: number;
  outbound_monthly_limit: number;
  financial_actions_monthly_limit: number;
  daily_inbound_limit: number;
  daily_outbound_limit: number;
  per_minute_limit: number;
  enabled: boolean;
  updated_at?: string | null;
  updated_by?: string | null;
};

function zeroFor(plan: string): QuotaFields {
  return {
    plan_code: plan,
    inbound_monthly_limit: 0,
    outbound_monthly_limit: 0,
    financial_actions_monthly_limit: 0,
    daily_inbound_limit: 0,
    daily_outbound_limit: 0,
    per_minute_limit: 0,
    enabled: true,
    updated_at: null,
    updated_by: null,
  };
}

function makeQuotaClient(rows: QuotaFields[], mode: "none" | "db_error" = "none") {
  const store = new Map<string, QuotaFields>();
  for (const r of rows) store.set(r.plan_code, { ...r });
  return {
    dump: () => Array.from(store.values()),
    from(table: string) {
      if (table !== "whatsapp_plan_quotas") throw new Error(`unexpected table: ${table}`);
      return {
        select(_cols?: string) {
          const chain = {
            _plan: null as string | null,
            eq(_c: string, v: string) {
              chain._plan = v;
              return chain;
            },
            async maybeSingle() {
              if (mode === "db_error") return { data: null, error: { message: "boom" } };
              const p = chain._plan;
              return { data: p ? (store.get(p) ?? null) : null, error: null };
            },
            order() {
              return this;
            },
            then(resolve: (v: unknown) => unknown) {
              // Resolve como array quando await sem .maybeSingle
              const arr = Array.from(store.values());
              return Promise.resolve({ data: arr, error: null }).then(resolve);
            },
          };
          return chain;
        },
        update(patch: Partial<QuotaFields>) {
          return {
            eq(_c: string, v: string) {
              const chain = {
                _plan: v,
                select(_cols?: string) {
                  return {
                    async maybeSingle() {
                      if (mode === "db_error") return { data: null, error: { message: "boom" } };
                      const existing = store.get(chain._plan);
                      if (!existing) return { data: null, error: null };
                      const merged = {
                        ...existing,
                        ...patch,
                        updated_at: new Date().toISOString(),
                      };
                      store.set(chain._plan, merged);
                      return { data: merged, error: null };
                    },
                  };
                },
              };
              return chain;
            },
          };
        },
      };
    },
  };
}

describe("WA-C11 3B.3 — validateQuotaPatch", () => {
  test("plano permitido", async () => {
    const { validateQuotaPatch } = await import("../src/server/whatsapp-quota-admin.server");
    const r = validateQuotaPatch("pessoal_premium", { outbound_monthly_limit: 100 });
    expect(r.ok).toBe(true);
  });

  test("plano desconhecido é rejeitado", async () => {
    const { validateQuotaPatch } = await import("../src/server/whatsapp-quota-admin.server");
    const r = validateQuotaPatch("pirata", { outbound_monthly_limit: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unknown_plan");
  });

  test("valor negativo", async () => {
    const { validateQuotaPatch } = await import("../src/server/whatsapp-quota-admin.server");
    const r = validateQuotaPatch("empresa", { outbound_monthly_limit: -1 });
    expect(r.ok).toBe(false);
  });

  test("valor decimal, NaN, Infinity", async () => {
    const { validateQuotaPatch } = await import("../src/server/whatsapp-quota-admin.server");
    expect(validateQuotaPatch("empresa", { outbound_monthly_limit: 1.5 }).ok).toBe(false);
    expect(validateQuotaPatch("empresa", { outbound_monthly_limit: NaN }).ok).toBe(false);
    expect(validateQuotaPatch("empresa", { outbound_monthly_limit: Infinity }).ok).toBe(false);
  });

  test("valor acima do teto", async () => {
    const { validateQuotaPatch } = await import("../src/server/whatsapp-quota-admin.server");
    const r = validateQuotaPatch("empresa", { outbound_monthly_limit: 2_000_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("value_too_large");
  });

  test("plano gratuito com valor > 0 é rejeitado", async () => {
    const { validateQuotaPatch } = await import("../src/server/whatsapp-quota-admin.server");
    const r = validateQuotaPatch("free_ads", { outbound_monthly_limit: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("free_plan_must_be_zero");
  });

  test("plano gratuito pode ter enabled alterado", async () => {
    const { validateQuotaPatch } = await import("../src/server/whatsapp-quota-admin.server");
    const r = validateQuotaPatch("free_ads", { enabled: false });
    expect(r.ok).toBe(true);
  });

  test("diário > mensal no mesmo patch ⇒ inconsistente", async () => {
    const { validateQuotaPatch } = await import("../src/server/whatsapp-quota-admin.server");
    const r = validateQuotaPatch("empresa", {
      daily_outbound_limit: 100,
      outbound_monthly_limit: 50,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("daily_exceeds_monthly");
  });

  test("patch vazio ⇒ empty_patch", async () => {
    const { validateQuotaPatch } = await import("../src/server/whatsapp-quota-admin.server");
    const r = validateQuotaPatch("empresa", {});
    expect(r.ok).toBe(false);
  });
});

describe("WA-C11 3B.3 — updatePlanQuota", () => {
  test("aplica alteração válida em plano pago", async () => {
    const { updatePlanQuota } = await import("../src/server/whatsapp-quota-admin.server");
    const c = makeQuotaClient([
      { ...zeroFor("empresa"), outbound_monthly_limit: 100, inbound_monthly_limit: 200 },
    ]);
    const r = await updatePlanQuota(
      "empresa",
      { outbound_monthly_limit: 500 },
      { adminUserId: "u1", reason: "ampliar beta" },
      c,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.outbound_monthly_limit).toBe(500);
  });

  test("motivo ausente ⇒ reason_required", async () => {
    const { updatePlanQuota } = await import("../src/server/whatsapp-quota-admin.server");
    const c = makeQuotaClient([zeroFor("empresa")]);
    const r = await updatePlanQuota(
      "empresa",
      { outbound_monthly_limit: 100 },
      { adminUserId: "u1", reason: null },
      c,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("reason_required");
  });

  test("plano desconhecido bloqueado", async () => {
    const { updatePlanQuota } = await import("../src/server/whatsapp-quota-admin.server");
    const c = makeQuotaClient([zeroFor("empresa")]);
    const r = await updatePlanQuota(
      "hacker",
      { outbound_monthly_limit: 100 },
      { adminUserId: "u1", reason: "válido" },
      c,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unknown_plan");
  });

  test("plano gratuito não aceita valor > 0", async () => {
    const { updatePlanQuota } = await import("../src/server/whatsapp-quota-admin.server");
    const c = makeQuotaClient([zeroFor("free_ads")]);
    const r = await updatePlanQuota(
      "free_ads",
      { outbound_monthly_limit: 10 },
      { adminUserId: "u1", reason: "tentativa" },
      c,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("free_plan_must_be_zero");
  });

  test("consistência diário/mensal após merge com estado atual", async () => {
    const { updatePlanQuota } = await import("../src/server/whatsapp-quota-admin.server");
    // Estado atual: mensal=50. Patch aumenta diário para 100 ⇒ diário > mensal.
    const c = makeQuotaClient([{ ...zeroFor("empresa"), outbound_monthly_limit: 50 }]);
    const r = await updatePlanQuota(
      "empresa",
      { daily_outbound_limit: 100 },
      { adminUserId: "u1", reason: "ajuste" },
      c,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("daily_exceeds_monthly");
  });

  test("erro de banco propaga db_error", async () => {
    const { updatePlanQuota } = await import("../src/server/whatsapp-quota-admin.server");
    const c = makeQuotaClient([zeroFor("empresa")], "db_error");
    const r = await updatePlanQuota(
      "empresa",
      { outbound_monthly_limit: 1 },
      { adminUserId: "u1", reason: "válido" },
      c,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("db_error");
  });

  test("client não define updated_by — helper força adminUserId", async () => {
    const { updatePlanQuota } = await import("../src/server/whatsapp-quota-admin.server");
    const c = makeQuotaClient([{ ...zeroFor("empresa"), outbound_monthly_limit: 10 }]);
    const r = await updatePlanQuota(
      "empresa",
      // Tentativa mal-intencionada de sobrescrever updated_by via patch.
      // Nosso validador só aceita whitelist de campos; updated_by é ignorado.
      { outbound_monthly_limit: 20, updated_by: "attacker" } as never,
      { adminUserId: "admin-real", reason: "ajuste" },
      c,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.updated_by).toBe("admin-real");
  });
});

describe("WA-C11 3B.3 — planos permitidos e livres (whitelist)", () => {
  test("todos os 8 planos obrigatórios estão na whitelist", async () => {
    const { ALLOWED_PLAN_CODES } = await import("../src/server/whatsapp-quota-admin.server");
    for (const p of [
      "free",
      "free_ads",
      "sem_assinatura",
      "pessoal_manual",
      "pessoal_premium",
      "mei_essencial",
      "mei_inteligente",
      "empresa",
    ]) {
      expect((ALLOWED_PLAN_CODES as readonly string[]).includes(p)).toBe(true);
    }
  });

  test("planos gratuitos incluem free, free_ads, sem_assinatura, pessoal_manual", async () => {
    const { isFreePlan } = await import("../src/server/whatsapp-quota-admin.server");
    for (const p of ["free", "free_ads", "sem_assinatura", "pessoal_manual"]) {
      expect(isFreePlan(p)).toBe(true);
    }
    expect(isFreePlan("empresa")).toBe(false);
    expect(isFreePlan("pessoal_premium")).toBe(false);
  });
});
