/**
 * WA-F — Beta fechada do WhatsApp.
 */
import { test, expect, beforeEach, mock } from "bun:test";

const TEST_USER_ID = "3324b9f8-ea68-465c-8e1e-ab1cc8caebf1";

const state = {
  betaAllowed: true,
  adminMaster: true,
  entitlementAllowed: true,
};

mock.module("@/server/rate-limit.server", () => ({
  enforceUserRateLimit: async () => null,
  checkRateLimit: async () => ({ blocked: false, count: 0, limit: 100, retryAfterSeconds: 0 }),
  RATE_LIMIT_PRESETS: {
    whatsappWebhook: { limit: 60, windowSeconds: 60 },
    aiPerUser: { limit: 20, windowSeconds: 3600 }
  },
  userRateLimitedResponse: (s: number) => new Response("Rate limited", { status: 429 }),
  rateLimitedResponse: (s: number) => new Response("Rate limited", { status: 429 }),
}));

mock.module("@/server/whatsapp-entitlement.server", () => ({
  getWhatsAppEntitlement: async () => ({
    allowed: state.entitlementAllowed,
    reason: state.entitlementAllowed ? "allowed" : "beta_access_missing",
    featureIncluded: true,
    betaAllowed: state.betaAllowed,
    adminMaster: state.adminMaster,
    planActive: true,
  }),
  assertWhatsAppEntitlement: async () => {
    if (!state.entitlementAllowed) throw new Response("Forbidden", { status: 403 });
    return { allowed: true };
  }
}));

import { resetState, gastosInserts } from "./_whatsapp-fake";
import { processarMensagemWhatsApp } from "../src/server/whatsapp.server";

const tel = "5511999998888";

beforeEach(() => {
  resetState();
  state.betaAllowed = true;
  state.adminMaster = true;
  state.entitlementAllowed = true;
});

test("usuário sem beta não cria sessão nem gasto", async () => {
  state.entitlementAllowed = false;
  state.betaAllowed = false;
  state.adminMaster = false;
  const out = await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 48,90 hoje", external_id: "beta-1" });
  expect(out.status).toBe("sem_plano");
  expect(gastosInserts().length).toBe(0);
});

test("beta ativa libera o fluxo", async () => {
  state.entitlementAllowed = true;
  state.betaAllowed = true;
  state.adminMaster = false;
  const out = await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 48,90 hoje", external_id: "beta-2" });
  expect(out.status).not.toBe("sem_plano");
});
