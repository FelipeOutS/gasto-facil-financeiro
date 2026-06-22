/**
 * WA-G5B — gate único `canUseWhatsAppForSender`.
 *
 * Garante que somente usuários com vínculo ativo + consentimento + plano
 * elegível (ou Admin Master, ou beta explícita + plano pago) podem usar
 * o WhatsApp. Qualquer outro caso → `{ allowed: false }`.
 *
 * Também valida o rate-limit (1×/24h) da resposta neutra de bloqueio.
 */
import { test, expect, beforeEach, mock } from "bun:test";

// -------- mocks --------
const linkState: {
  link: null | {
    user_id: string;
    ativo: boolean;
    opt_in_em: string | null;
    revogado_em: string | null;
  };
  betaOk: boolean;
  subscription: { active: boolean; plan: string };
  email: string;
  rateBlocked: boolean;
} = {
  link: null,
  betaOk: false,
  subscription: { active: false, plan: "free" },
  email: "user@example.com",
  rateBlocked: false,
};

const fakeAdmin = {
  from: () => {
    const b: any = {
      select: () => b,
      in: () => b,
      eq: () => b,
      limit: () => b,
      maybeSingle: async () => ({ data: linkState.link, error: null }),
    };
    return b;
  },
  rpc: async (name: string) => {
    if (name === "can_use_whatsapp") return { data: linkState.betaOk, error: null };
    return { data: null, error: null };
  },
  auth: {
    admin: {
      getUserById: async () => ({ data: { user: { email: linkState.email } } }),
    },
  },
};

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin }));
mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin }));
mock.module("@/server/subscription.server", () => ({
  getSubscriptionForUserIdentity: async () => linkState.subscription,
}));
mock.module("./subscription.server", () => ({
  getSubscriptionForUserIdentity: async () => linkState.subscription,
}));
mock.module("@/server/rate-limit.server", () => ({
  checkRateLimit: async () => ({
    blocked: linkState.rateBlocked,
    count: linkState.rateBlocked ? 2 : 1,
    limit: 1,
    retryAfterSeconds: 86400,
  }),
}));
mock.module("./rate-limit.server", () => ({
  checkRateLimit: async () => ({
    blocked: linkState.rateBlocked,
    count: linkState.rateBlocked ? 2 : 1,
    limit: 1,
    retryAfterSeconds: 86400,
  }),
}));

const {
  canUseWhatsAppForSender,
  shouldSendBlockedReply,
  normalizePhone,
  WHATSAPP_BLOCKED_REPLY,
} = await import("../src/server/whatsapp-authz.server");

const PHONE = "5511999998888";
const ACTIVE_LINK = {
  user_id: "u1",
  ativo: true,
  opt_in_em: "2026-01-01T00:00:00Z",
  revogado_em: null,
};

beforeEach(() => {
  linkState.link = null;
  linkState.betaOk = false;
  linkState.subscription = { active: false, plan: "free" };
  linkState.email = "user@example.com";
  linkState.rateBlocked = false;
});

// ---------------- normalização ----------------

test("normalizePhone aceita E.164 BR e rejeita vazio/curto", () => {
  expect(normalizePhone(PHONE)).toBe(PHONE);
  expect(normalizePhone("+55 (11) 99999-8888")).toBe(PHONE);
  expect(normalizePhone("")).toBeNull();
  expect(normalizePhone("123")).toBeNull();
  expect(normalizePhone(null)).toBeNull();
});

// ---------------- vínculo ----------------

test("número sem conta vinculada → não autorizado", async () => {
  linkState.link = null;
  const r = await canUseWhatsAppForSender(PHONE);
  expect(r.allowed).toBe(false);
  expect(r.userId).toBeUndefined();
});

test("vínculo revogado → não autorizado", async () => {
  linkState.link = { ...ACTIVE_LINK, revogado_em: "2026-06-01T00:00:00Z" };
  const r = await canUseWhatsAppForSender(PHONE);
  expect(r.allowed).toBe(false);
});

test("vínculo sem consentimento (opt_in_em null) → não autorizado", async () => {
  linkState.link = { ...ACTIVE_LINK, opt_in_em: null };
  const r = await canUseWhatsAppForSender(PHONE);
  expect(r.allowed).toBe(false);
});

test("vínculo inativo → não autorizado", async () => {
  linkState.link = { ...ACTIVE_LINK, ativo: false };
  const r = await canUseWhatsAppForSender(PHONE);
  expect(r.allowed).toBe(false);
});

// ---------------- planos ----------------

test("usuário free_ads (mesmo com beta ativa) → não autorizado", async () => {
  linkState.link = ACTIVE_LINK;
  linkState.betaOk = true;
  linkState.subscription = { active: true, plan: "free_ads" };
  const r = await canUseWhatsAppForSender(PHONE);
  expect(r.allowed).toBe(false);
});

test("usuário free → não autorizado", async () => {
  linkState.link = ACTIVE_LINK;
  linkState.betaOk = true;
  linkState.subscription = { active: true, plan: "free" };
  const r = await canUseWhatsAppForSender(PHONE);
  expect(r.allowed).toBe(false);
});

test("usuário sem assinatura → não autorizado", async () => {
  linkState.link = ACTIVE_LINK;
  linkState.betaOk = true;
  linkState.subscription = { active: false, plan: "sem_assinatura" };
  const r = await canUseWhatsAppForSender(PHONE);
  expect(r.allowed).toBe(false);
});

test("plano pago SEM acesso ao canary/beta → bloqueado durante beta fechada", async () => {
  linkState.link = ACTIVE_LINK;
  linkState.betaOk = false; // não está na lista beta
  linkState.subscription = { active: true, plan: "pessoal_premium" };
  const r = await canUseWhatsAppForSender(PHONE);
  expect(r.allowed).toBe(false);
});

test("plano pago + beta liberada → autorizado", async () => {
  linkState.link = ACTIVE_LINK;
  linkState.betaOk = true;
  linkState.subscription = { active: true, plan: "pessoal_premium" };
  const r = await canUseWhatsAppForSender(PHONE);
  expect(r.allowed).toBe(true);
  expect(r.userId).toBe("u1");
});

test("Admin Master continua autorizado mesmo sem beta/plano", async () => {
  linkState.link = ACTIVE_LINK;
  linkState.email = "felipe.out.silva@outlook.com";
  linkState.betaOk = false;
  linkState.subscription = { active: false, plan: "free" };
  const r = await canUseWhatsAppForSender(PHONE);
  expect(r.allowed).toBe(true);
});

// ---------------- canary ----------------

test("modo canary: SOMENTE Admin Master passa, mesmo com beta+plano pago", async () => {
  linkState.link = ACTIVE_LINK;
  linkState.betaOk = true;
  linkState.subscription = { active: true, plan: "pessoal_premium" };
  // usuário comum no canary
  const r1 = await canUseWhatsAppForSender(PHONE, { canaryOnly: true });
  expect(r1.allowed).toBe(false);
  // admin master no canary
  linkState.email = "felipe.out.silva@outlook.com";
  const r2 = await canUseWhatsAppForSender(PHONE, { canaryOnly: true });
  expect(r2.allowed).toBe(true);
});

// ---------------- rate-limit do reply ----------------

test("primeiro envio de bloqueio é permitido", async () => {
  linkState.rateBlocked = false;
  expect(await shouldSendBlockedReply(PHONE)).toBe(true);
});

test("segundo envio dentro de 24h é bloqueado pelo rate-limit", async () => {
  linkState.rateBlocked = true;
  expect(await shouldSendBlockedReply(PHONE)).toBe(false);
});

test("mensagem neutra de bloqueio não revela conta/plano", () => {
  expect(WHATSAPP_BLOCKED_REPLY).toContain("não está autorizado");
  expect(WHATSAPP_BLOCKED_REPLY).not.toMatch(/plano gratuito|free|conta inexistente|usuário não encontrado/i);
});
