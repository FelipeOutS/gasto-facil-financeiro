import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import type { ResearchContext } from "../src/server/whatsapp-research-core";

let persistedContext: ResearchContext | null = null;
let pendingUpdate: Record<string, unknown> | null = null;
let nextClaim = 0;
const savedUpdates: Array<Record<string, unknown>> = [];

function requestQuery() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    gt: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: persistedContext
      ? { context: persistedContext, context_expires_at: "2099-01-01T00:00:00Z" }
      : null, error: null }),
    update: (value: Record<string, unknown>) => { pendingUpdate = value; return chain; },
    then: (resolve: (value: { error: null }) => unknown) => {
      if (pendingUpdate) {
        savedUpdates.push(pendingUpdate);
        persistedContext = pendingUpdate.context as ResearchContext | null;
        pendingUpdate = null;
      }
      return Promise.resolve({ error: null }).then(resolve);
    },
  };
  return chain;
}

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== "whatsapp_research_requests") throw new Error(`unexpected table: ${table}`);
      return requestQuery();
    },
    rpc: async () => ({ data: { claim_state: "claimed", request_id: `claim-${++nextClaim}` }, error: null }),
  },
}));
mock.module("@/server/whatsapp-entitlement.server", () => ({
  getWhatsAppEntitlement: async () => ({ allowed: true }),
}));
mock.module("@/server/rate-limit.server", () => ({
  checkRateLimit: async () => ({ blocked: false, dbError: false }),
}));

const { handleWhatsAppResearch } = await import("../src/server/whatsapp-research.server");
const oldFlag = process.env.WHATSAPP_RESEARCH_ENABLED;
beforeAll(() => { process.env.WHATSAPP_RESEARCH_ENABLED = "true"; });
afterAll(() => {
  if (oldFlag === undefined) delete process.env.WHATSAPP_RESEARCH_ENABLED;
  else process.env.WHATSAPP_RESEARCH_ENABLED = oldFlag;
});

test("WA-HOMO-004: oferta em parcelas preserva contexto sem atribuir preço ao produto", async () => {
  const base = { userId: "user-1", phone: "5511999999999", wikimedia: { lookup: async (topic: string) => ({
    title: topic, extract: "Artigo público sobre o produto.", url: "https://pt.wikipedia.org/wiki/Galaxy_S25", language: "pt" as const,
  }) } };
  const first = await handleWhatsAppResearch({ ...base, externalId: "msg-1", text: "pesquise Galaxy S25" });
  expect(first?.resposta).toContain("Artigo público");
  expect(persistedContext?.products[0].priceCents).toBeNull();

  const offer = await handleWhatsAppResearch({ ...base, externalId: "msg-2", text: "10x de 199" });
  expect(offer?.resposta).toContain("R$ 1.990,00");
  expect(offer?.resposta).toContain("condição informada por você");
  expect(savedUpdates[1].context).toEqual(savedUpdates[0].context);
  expect(persistedContext?.products[0].priceCents).toBeNull();
  expect(persistedContext?.products[0].priceOrigin).toBeNull();

  const followup = await handleWhatsAppResearch({ ...base, externalId: "msg-3", text: "e em 10x?" });
  expect(followup?.resposta).toContain("Informe o preço");
  expect(savedUpdates[2].context).toEqual(savedUpdates[0].context);
});
