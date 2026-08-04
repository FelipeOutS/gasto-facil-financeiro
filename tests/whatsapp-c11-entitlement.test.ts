/**
 * WA-C11 FASE 1 — fonte única `getWhatsAppEntitlement`.
 */
import { test, expect, beforeEach, mock } from "bun:test";

const state = {
  email: "user@example.com",
  featureAccess: false,
  betaOk: false,
  subscription: { active: false, plan: "free_ads", status: "ativa" },
  rpcThrows: false,
  userIdPassedToRoles: null as string | null,
};

const ADMIN_USER = "admin-user-id";
const USER = "3324b9f8-ea68-465c-8e1e-ab1cc8caebf1";
const ADMIN_MASTER_EMAIL = "felipe.out.silva@outlook.com";

mock.module("@/server/admin-master.server", () => ({
  hasAdminMasterRole: async (userId: string) => userId === ADMIN_USER,
  isAdminMasterEmail: (email: string) => email === ADMIN_MASTER_EMAIL,
  assertAdminMaster: async (user: any) => { if (user?.id !== ADMIN_USER) throw new Error("Forbidden"); }
}));

mock.module("@/server/subscription.server", () => ({
  getSubscriptionForUserIdentity: async (params: any) => {
    return state.subscription;
  },
}));

mock.module("@/integrations/supabase/client.server", () => ({ 
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => ({
        eq: (col: string, val: string) => {
          if (table === "user_roles" && col === "user_id") state.userIdPassedToRoles = val;
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
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: state.email } } }) } },
  }
}));

import { getWhatsAppEntitlement, assertWhatsAppEntitlement } from "../src/server/whatsapp-entitlement.server";

beforeEach(() => {
  state.email = "user@example.com";
  state.featureAccess = false;
  state.betaOk = false;
  state.subscription = { active: false, plan: "free_ads", status: "ativa" };
  state.rpcThrows = false;
  state.userIdPassedToRoles = null;
});

test("plano free → NÃO autorizado", async () => {
  state.subscription = { active: true, plan: "free", status: "ativa" };
  const r = await getWhatsAppEntitlement(USER);
  expect(r.allowed).toBe(false);
});

test("Admin Master → autorizado", async () => {
  const r = await getWhatsAppEntitlement(ADMIN_USER);
  expect(r.allowed).toBe(true);
  expect(r.reason).toBe("admin_master");
});

test("plano pago + beta → autorizado", async () => {
  state.subscription = { active: true, plan: "pessoal_premium", status: "ativa" };
  state.featureAccess = true;
  state.betaOk = true;
  const r = await getWhatsAppEntitlement(USER);
  expect(r.allowed).toBe(true);
});

test("assert throws 403 on block", async () => {
  let caught: any = null;
  try { await assertWhatsAppEntitlement(USER); } catch (e) { caught = e; }
  expect(caught.status).toBe(403);
});
