/**
 * WA-C11 FASE 1 — fonte única `getWhatsAppEntitlement`.
 */
import { test, expect, beforeEach, mock } from "bun:test";

const ADMIN_MASTER_EMAIL = "felipe.out.silva@outlook.com";
process.env.ADMIN_MASTER_EMAILS = ADMIN_MASTER_EMAIL;

const USER = "3324b9f8-ea68-465c-8e1e-ab1cc8caebf1";
const ADMIN_USER = "admin-user-id";

// ---------------- state ----------------

const state = {
  email: "user@example.com",
  featureAccess: false,
  betaOk: false,
  subscription: { active: false, plan: "free_ads", status: "ativa" },
  rpcThrows: false,
  userIdPassedToRoles: null as string | null,
};

// ---------------- mocks ----------------

mock.module("@/server/admin-master.server", () => {
  return {
    hasAdminMasterRole: async (userId: string) => {
      // console.info(`[mock-admin] check user=${userId} result=${userId === ADMIN_USER}`);
      return userId === ADMIN_USER;
    },
    isAdminMasterEmail: (email: string) => email === ADMIN_MASTER_EMAIL,
    assertAdminMaster: async (user: any) => {
      if (user?.id !== ADMIN_USER) throw new Error("Forbidden");
    }
  };
});

mock.module("@/integrations/supabase/client.server", () => ({ 
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => ({
        eq: (col: string, val: string) => {
          if (table === "user_roles" && col === "user_id") {
            state.userIdPassedToRoles = val;
          }
          return {
            maybeSingle: async () => {
              if (table === "user_roles") {
                const isOwner = state.userIdPassedToRoles === ADMIN_USER;
                return { data: isOwner ? { role: "owner" } : null, error: null };
              }
              return { data: null, error: null };
            },
            order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
          };
        }
      })
    }),
    rpc: async (name: string) => {
      if (state.rpcThrows) throw new Error("boom");
      if (name === "has_feature_access") return { data: state.featureAccess, error: null };
      if (name === "can_use_whatsapp") return { data: state.betaOk, error: null };
      return { data: null, error: null };
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: { email: state.email } } }),
      },
    },
  }
}));

mock.module("@/server/subscription.server", () => ({
  getSubscriptionForUserIdentity: async () => state.subscription,
}));

// Agora importa o módulo que usa esses mocks
import * as Entitlement from "../src/server/whatsapp-entitlement.server";

// Injeta o mock explicitamente
Entitlement.__inject_sb_for_testing({
  from: (table: string) => ({
    select: () => ({
      eq: (col: string, val: string) => {
        if (table === "user_roles" && col === "user_id") {
          state.userIdPassedToRoles = val;
        }
        return {
          maybeSingle: async () => {
            if (table === "user_roles") {
              const isOwner = state.userIdPassedToRoles === ADMIN_USER;
              return { data: isOwner ? { role: "owner" } : null, error: null };
            }
            if (table === "whatsapp_links") {
               return { data: null, error: null };
            }
            return { data: null, error: null };
          },
          order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
        };
      }
    })
  }),
  rpc: async (name: string) => {
    if (state.rpcThrows) throw new Error("boom");
    if (name === "has_feature_access") return { data: state.featureAccess, error: null };
    if (name === "can_use_whatsapp") return { data: state.betaOk, error: null };
    return { data: null, error: null };
  },
  auth: {
    admin: {
      getUserById: async (id: string) => ({ data: { user: { email: state.email } } }),
    },
  },
});


beforeEach(() => {
  state.email = "user@example.com";
  state.featureAccess = false;
  state.betaOk = false;
  state.subscription = { active: false, plan: "free_ads", status: "ativa" };
  state.rpcThrows = false;
  state.userIdPassedToRoles = null;
});

// ---------------- planos bloqueados ----------------

const BLOCKED_PLANS = ["free", "free_ads", "pessoal_manual", "sem_assinatura"];

for (const plan of BLOCKED_PLANS) {
  test(`plano ${plan} → NÃO autorizado`, async () => {
    state.subscription = { active: plan !== "sem_assinatura", plan, status: "ativa" };
    state.featureAccess = false;
    state.betaOk = true;
    const r = await Entitlement.getWhatsAppEntitlement(USER);
    expect(r.allowed).toBe(false);
  });
}

// ---------------- planos elegíveis ----------------

const ELIGIBLE_PLANS = ["pessoal_premium", "mei_essencial", "mei_inteligente", "empresa"];

for (const plan of ELIGIBLE_PLANS) {
  test(`plano ${plan} + beta → autorizado`, async () => {
    state.subscription = { active: true, plan, status: "ativa" };
    state.featureAccess = true;
    state.betaOk = true;
    const r = await Entitlement.getWhatsAppEntitlement(USER);
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("allowed");
  });

  test(`plano ${plan} SEM beta → bloqueado`, async () => {
    state.subscription = { active: true, plan, status: "ativa" };
    state.featureAccess = true;
    state.betaOk = false;
    const r = await Entitlement.getWhatsAppEntitlement(USER);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("beta_access_missing");
  });
}

// ---------------- assinatura ----------------

test("plano elegível mas assinatura cancelada → bloqueado (SQL nega)", async () => {
  state.subscription = { active: false, plan: "pessoal_premium", status: "cancelada" };
  state.featureAccess = false;
  state.betaOk = true;
  const r = await Entitlement.getWhatsAppEntitlement(USER);
  expect(r.allowed).toBe(false);
});

test("plano elegível mas expirada → bloqueado", async () => {
  state.subscription = { active: false, plan: "pessoal_premium", status: "expirado" };
  state.featureAccess = false;
  state.betaOk = true;
  const r = await Entitlement.getWhatsAppEntitlement(USER);
  expect(r.allowed).toBe(false);
});

// ---------------- admin master ----------------

test("Admin Master → autorizado com reason=admin_master mesmo sem plano/beta", async () => {
  state.email = ADMIN_MASTER_EMAIL;
  state.featureAccess = false;
  state.betaOk = false;
  state.subscription = { active: false, plan: "free", status: "ativa" };
  const r = await Entitlement.getWhatsAppEntitlement(ADMIN_USER);
  expect(r.allowed).toBe(true);
  expect(r.reason).toBe("admin_master");
});

// ---------------- fail-closed ----------------

test("userId inválido → unknown_user", async () => {
  const r = await Entitlement.getWhatsAppEntitlement(null);
  expect(r.allowed).toBe(false);
  expect(r.reason).toBe("unknown_user");
});

test("RPC lança → fail-closed (não vaza plano)", async () => {
  state.rpcThrows = true;
  const r = await Entitlement.getWhatsAppEntitlement(USER);
  expect(r.allowed).toBe(false);
});

test("assertWhatsAppEntitlement lança Response 403 quando bloqueado", async () => {
  state.subscription = { active: true, plan: "free_ads", status: "ativa" };
  state.featureAccess = false;
  state.betaOk = false;
  let caught: any = null;
  try {
    await Entitlement.assertWhatsAppEntitlement(USER);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(Response);
  expect(caught.status).toBe(403);
});
