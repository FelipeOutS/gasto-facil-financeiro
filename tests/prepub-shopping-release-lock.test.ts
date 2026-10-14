import { describe, it, expect, vi, afterEach } from "vitest";
import { handleWhatsAppShopping, SHOPPING_RELEASE_AUTHORIZED } from "../src/server/shopping/whatsapp-shopping.server";

const U = "11111111-1111-4111-8111-111111111111";
const MSG = { userId: U, phone: "5511900000001", externalId: "wamid.x", text: "quero comprar uma geladeira até 3000" };
const boom = vi.fn(() => { throw new Error("rede proibida"); });

describe("Pré-publicação: Assistente de Compras travado em código", () => {
  afterEach(() => { vi.unstubAllEnvs(); boom.mockClear(); });
  it("constante de liberação está false", () => expect(SHOPPING_RELEASE_AUTHORIZED).toBe(false));
  for (const [nome, val] of [["ativa", "true"], ["ausente", undefined], ["inválida", "TRUE "]] as const) {
    it(`flag ${nome} + piloto preenchido no ambiente real → indisponível (null), sem rede`, async () => {
      if (val !== undefined) vi.stubEnv("WHATSAPP_SHOPPING_ENABLED", val);
      vi.stubEnv("WHATSAPP_SHOPPING_PILOT_USER_IDS", U);
      vi.stubEnv("SERPAPI_API_KEY", "x");
      const r = await handleWhatsAppShopping(MSG, { fetchImpl: boom as unknown as typeof fetch, isEntitled: async () => true });
      expect(r).toBeNull();
      expect(boom).not.toHaveBeenCalled();
    });
  }
  it("releaseAuthorized=false vence env injetada ativa", async () => {
    const r = await handleWhatsAppShopping(MSG, { env: { WHATSAPP_SHOPPING_ENABLED: "true", WHATSAPP_SHOPPING_PILOT_USER_IDS: U, SERPAPI_API_KEY: "x" }, releaseAuthorized: false, fetchImpl: boom as unknown as typeof fetch });
    expect(r).toBeNull();
  });
});
