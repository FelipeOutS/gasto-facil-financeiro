import { expect, mock, test } from "bun:test";
import { resolveSubscriptionAccess } from "../src/lib/subscription-access";
import { planAllowsFeature } from "../src/lib/plans";
let queryFails = false;
const database = {
  from: () => {
    const q: any = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: () =>
        Promise.resolve({ data: null, error: queryFails ? { message: "unavailable" } : null }),
      then: (ok: any, bad: any) =>
        Promise.resolve({ data: [], error: queryFails ? { message: "unavailable" } : null }).then(
          ok,
          bad,
        ),
    };
    return q;
  },
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: database }));
mock.module("@/server/admin-master.server", () => ({ hasAdminMasterRole: async () => false }));
const { getSubscriptionForUserIdentity } = await import("../src/server/subscription.server");
const now = Date.now();
const future = new Date(now + 86400000).toISOString();
const past = new Date(now - 86400000).toISOString();
const base = { storedPlan: "pessoal_premium", status: "ativo", currentPeriodEnd: future };
const cases = [
  ["ativo", base, true, "ativo"],
  [
    "trial válido",
    {
      ...base,
      status: "teste",
      storedPlan: "free_ads",
      trialPlan: "pessoal_premium",
      trialEndsAt: future,
    },
    true,
    "teste",
  ],
  [
    "cancelado com período pago",
    { ...base, status: "cancelado", cancelledAt: past, accessUntil: future },
    true,
    "cancelado",
  ],
  [
    "cancelado vencido",
    { ...base, status: "cancelado", cancelledAt: past, accessUntil: past },
    false,
    "expirado",
  ],
  [
    "cancelado sem access_until não prorroga via período",
    { ...base, status: "cancelado" },
    false,
    "expirado",
  ],
  [
    "cancelado sem cancelled_at mas com limite válido",
    { ...base, status: "cancelado", accessUntil: future },
    true,
    "cancelado",
  ],
  ["ativo com período vencido", { ...base, currentPeriodEnd: past }, false, "expirado"],
  ["status expirado com data futura", { ...base, status: "expirado" }, false, "expirado"],
  [
    "trial vencido",
    { ...base, status: "teste", trialPlan: "pessoal_premium", trialEndsAt: past },
    false,
    "expirado",
  ],
  [
    "trial futuro não reativa expirado",
    { ...base, status: "expirado", trialPlan: "pessoal_premium", trialEndsAt: future },
    false,
    "expirado",
  ],
  [
    "sem assinatura",
    { ...base, storedPlan: "sem_assinatura", status: "sem_assinatura" },
    false,
    "sem_assinatura",
  ],
  [
    "aguardando pagamento",
    { ...base, status: "aguardando_pagamento" },
    false,
    "aguardando_pagamento",
  ],
  ["free_ads básico", { ...base, storedPlan: "free_ads", currentPeriodEnd: null }, true, "ativo"],
  ["legado ativo sem fim como SQL", { ...base, currentPeriodEnd: null }, true, "ativo"],
  ["data inválida não autoriza", { ...base, currentPeriodEnd: "invalid" }, false, "expirado"],
] as const;
for (const [name, input, expected, status] of cases) {
  test(`frontend/backend: ${name}`, async () => {
    const access = resolveSubscriptionAccess(input, now);
    expect(access.active).toBe(expected);
    expect(access.status).toBe(status);
    const row = {
      user_id: "fixture",
      plano: input.storedPlan,
      status: input.status,
      current_period_end: input.currentPeriodEnd,
      trial_plan_type: "trialPlan" in input ? input.trialPlan : null,
      trial_ends_at: "trialEndsAt" in input ? input.trialEndsAt : null,
      cancelled_at: "cancelledAt" in input ? input.cancelledAt : null,
      access_until: "accessUntil" in input ? input.accessUntil : null,
    };
    const server = await getSubscriptionForUserIdentity({
      userId: "fixture",
      preloaded: { isAdmin: false, planRow: row, payments: [] },
    });
    expect(server.active).toBe(expected);
    expect(server.plan).toBe(access.plan);
    expect(server.status).toBe(access.status);
    expect(resolveSubscriptionAccess(server).active).toBe(server.active);
    expect(server.active && planAllowsFeature(server.plan, "importacoes")).toBe(
      access.active && planAllowsFeature(access.plan, "importacoes"),
    );
  });
}
for (const status of ["ativo", "teste", "cancelado"]) {
  test(`limite final exclusivo: ${status}`, () => {
    const atEnd = new Date(now).toISOString();
    expect(
      resolveSubscriptionAccess(
        {
          ...base,
          status,
          currentPeriodEnd: atEnd,
          trialEndsAt: atEnd,
          trialPlan: "pessoal_premium",
          accessUntil: atEnd,
        },
        now,
      ).active,
    ).toBe(false);
  });
}
const receipt = {
  id: "receipt",
  user_id: "fixture",
  plano: "pessoal_premium",
  status: "approved",
  paid_at: past,
  created_at: past,
  months: 1,
};
for (const status of ["cancelado", "expirado", "ativo"]) {
  test(`pagamento antigo não prolonga ${status} vencido`, async () => {
    const server = await getSubscriptionForUserIdentity({
      userId: "fixture",
      preloaded: {
        isAdmin: false,
        planRow: {
          plano: "pessoal_premium",
          status,
          cancelled_at: past,
          access_until: past,
          current_period_end: past,
        },
        payments: [receipt],
      },
    });
    expect(server.active).toBe(false);
  });
}
test("cancelamento pago preserva status e datas mesmo com recibo aprovado", async () => {
  const server = await getSubscriptionForUserIdentity({
    userId: "fixture",
    preloaded: {
      isAdmin: false,
      planRow: {
        plano: "pessoal_premium",
        status: "cancelado",
        cancelled_at: past,
        access_until: future,
        current_period_end: future,
      },
      payments: [receipt],
    },
  });
  expect(server.active).toBe(true);
  expect(server.status).toBe("cancelado");
  expect(server.accessUntil).toBe(future);
  expect(server.cancelledAt).toBe(past);
});
test("pagamento aprovado válido continua autorizando sem plano reconciliado", async () => {
  const server = await getSubscriptionForUserIdentity({
    userId: "fixture",
    preloaded: { isAdmin: false, planRow: null, payments: [receipt] },
  });
  expect(server.active).toBe(true);
  expect(resolveSubscriptionAccess(server).active).toBe(true);
});
test("sem linha e sem pagamento não autoriza", async () => {
  expect(
    (
      await getSubscriptionForUserIdentity({
        userId: "fixture",
        preloaded: { isAdmin: false, planRow: null, payments: [] },
      })
    ).active,
  ).toBe(false);
});
test("role administrativa continua autorizada", async () => {
  const server = await getSubscriptionForUserIdentity({
    userId: "fixture",
    preloaded: { isAdmin: true, planRow: null, payments: [] },
  });
  expect(server.active).toBe(true);
  expect(resolveSubscriptionAccess(server).active).toBe(true);
});
test("erro de consulta não retorna assinatura ausente", async () => {
  queryFails = true;
  try {
    await expect(
      getSubscriptionForUserIdentity({ userId: "fixture", email: "fixture@example.invalid" }),
    ).rejects.toThrow("consultar");
  } finally {
    queryFails = false;
  }
});

test("pagamento aprovado respeita current_period_end persistido da mesma assinatura", async () => {
  const server = await getSubscriptionForUserIdentity({
    userId: "fixture",
    preloaded: {
      isAdmin: false,
      planRow: { plano: "pessoal_premium", status: "ativo", current_period_end: future },
      payments: [receipt],
    },
  });
  expect(server.currentPeriodEnd).toBe(future);
  expect(server.active).toBe(true);
  expect(resolveSubscriptionAccess(server, Date.parse(future)).active).toBe(false);
});
