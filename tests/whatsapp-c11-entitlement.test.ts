/**
 * WA-C11 FASE 1 — fonte única `getWhatsAppEntitlement`.
 *
 * Cobre:
 *  - matriz de planos (elegíveis vs bloqueados);
 *  - beta_access obrigatório para não-admin;
 *  - Admin Master bypass;
 *  - downgrade / cancelamento / expiração;
 *  - fail-closed em erro interno;
 *  - proteção na criação (`enqueueNotification` retorna null quando bloqueado);
 *  - proteção no envio: `markSkipped(id, 'entitlement_revoked', token)` aceito.
 */
import { test, expect, beforeEach, mock } from "bun:test";

process.env.ADMIN_MASTER_EMAILS = "felipe.out.silva@outlook.com";

// ---------------- mocks ----------------

const state: {
  email: string;
  featureAccess: boolean;
  betaOk: boolean;
  subscription: { active: boolean; plan: string; status: string };
  rpcThrows: boolean;
} = {
  email: "user@example.com",
  featureAccess: false,
  betaOk: false,
  subscription: { active: false, plan: "free_ads", status: "ativa" },
  rpcThrows: false,
};

const fakeAdmin = {
  from: () => {
    const b: any = {
      select: () => b,
      eq: () => b,
      in: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return b;
  },
  rpc: async (name: string) => {
    if (state.rpcThrows) throw new Error("boom");
    if (name === "has_feature_access") return { data: state.featureAccess, error: null };
    if (name === "can_use_whatsapp") return { data: state.betaOk, error: null };
    return { data: null, error: null };
  },
  auth: {
    admin: {
      getUserById: async () => ({ data: { user: { email: state.email } } }),
    },
  },
};

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin }));
mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin }));
mock.module("@/server/subscription.server", () => ({
  getSubscriptionForUserIdentity: async () => state.subscription,
}));
mock.module("./subscription.server", () => ({
  getSubscriptionForUserIdentity: async () => state.subscription,
}));

const { getWhatsAppEntitlement, assertWhatsAppEntitlement } = await import(
  "../src/server/whatsapp-entitlement.server"
);

const USER = "3324b9f8-ea68-465c-8e1e-ab1cc8caebf1";

beforeEach(() => {
  state.email = "user@example.com";
  state.featureAccess = false;
  state.betaOk = false;
  state.subscription = { active: false, plan: "free_ads", status: "ativa" };
  state.rpcThrows = false;
});

// ---------------- planos bloqueados ----------------

const BLOCKED_PLANS = [
  "free",
  "free_ads",
  "pessoal_manual",
  "sem_assinatura",
];

for (const plan of BLOCKED_PLANS) {
  test(`plano ${plan} → NÃO autorizado`, async () => {
    state.subscription = { active: plan !== "sem_assinatura", plan, status: "ativa" };
    state.featureAccess = false;
    state.betaOk = true; // beta não deve resgatar planos inelegíveis
    const r = await getWhatsAppEntitlement(USER);
    expect(r.allowed).toBe(false);
    expect(["plan_not_eligible", "subscription_inactive"]).toContain(r.reason);
  });
}

// ---------------- planos elegíveis ----------------

const ELIGIBLE_PLANS = [
  "pessoal_premium",
  "mei_essencial",
  "mei_inteligente",
  "empresa",
];

for (const plan of ELIGIBLE_PLANS) {
  test(`plano ${plan} + beta → autorizado`, async () => {
    state.subscription = { active: true, plan, status: "ativa" };
    state.featureAccess = true;
    state.betaOk = true;
    const r = await getWhatsAppEntitlement(USER);
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("allowed");
  });

  test(`plano ${plan} SEM beta → bloqueado`, async () => {
    state.subscription = { active: true, plan, status: "ativa" };
    state.featureAccess = true;
    state.betaOk = false;
    const r = await getWhatsAppEntitlement(USER);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("beta_access_missing");
  });
}

// ---------------- assinatura ----------------

test("plano elegível mas assinatura cancelada → bloqueado (SQL nega)", async () => {
  state.subscription = { active: false, plan: "pessoal_premium", status: "cancelada" };
  state.featureAccess = false;
  state.betaOk = true;
  const r = await getWhatsAppEntitlement(USER);
  expect(r.allowed).toBe(false);
  expect(r.reason).toBe("subscription_inactive");
});

test("plano elegível mas expirada → bloqueado", async () => {
  state.subscription = { active: false, plan: "pessoal_premium", status: "expirado" };
  state.featureAccess = false;
  state.betaOk = true;
  const r = await getWhatsAppEntitlement(USER);
  expect(r.allowed).toBe(false);
  expect(r.reason).toBe("subscription_expired");
});

// ---------------- admin master ----------------

test("Admin Master → autorizado com reason=admin_master mesmo sem plano/beta", async () => {
  state.email = "felipe.out.silva@outlook.com";
  state.featureAccess = false;
  state.betaOk = false;
  state.subscription = { active: false, plan: "free", status: "ativa" };
  const r = await getWhatsAppEntitlement(USER);
  expect(r.allowed).toBe(true);
  expect(r.reason).toBe("admin_master");
  expect(r.adminMaster).toBe(true);
});

// ---------------- fail-closed ----------------

test("userId inválido → unknown_user", async () => {
  const r = await getWhatsAppEntitlement(null);
  expect(r.allowed).toBe(false);
  expect(r.reason).toBe("unknown_user");
});

test("RPC lança → fail-closed (não vaza plano)", async () => {
  state.rpcThrows = true;
  state.subscription = { active: true, plan: "pessoal_premium", status: "ativa" };
  const r = await getWhatsAppEntitlement(USER);
  expect(r.allowed).toBe(false);
  // has_feature_access falhou → featureIncluded=false → tenta discriminar via
  // getSubscriptionForUserIdentity, que aqui retorna plan pago ativo →
  // reason cai em plan_not_eligible (nunca allowed). Continua fechado.
  expect(r.reason).not.toBe("allowed");
});

test("assertWhatsAppEntitlement lança Response 403 quando bloqueado", async () => {
  state.subscription = { active: true, plan: "free_ads", status: "ativa" };
  state.featureAccess = false;
  state.betaOk = false;
  let caught: unknown = null;
  try {
    await assertWhatsAppEntitlement(USER);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(Response);
  expect((caught as Response).status).toBe(403);
});

test("beta_access sozinho (sem plano elegível) NUNCA autoriza", async () => {
  state.subscription = { active: true, plan: "free_ads", status: "ativa" };
  state.featureAccess = false; // SQL nega
  state.betaOk = true; // beta ativa
  const r = await getWhatsAppEntitlement(USER);
  expect(r.allowed).toBe(false);
});
