import { describe, it, expect, mock, afterEach } from "bun:test";
import { handleWhatsAppShopping, SHOPPING_RELEASE_AUTHORIZED } from "../src/server/shopping/whatsapp-shopping.server";

const U = "11111111-1111-4111-8111-111111111111";
const MSG = { userId: U, phone: "5511900000001", externalId: "wamid.x", text: "quero comprar uma geladeira até 3000" };
const boom = mock(() => { throw new Error("rede proibida"); });

describe("Pré-publicação: Assistente de Compras travado em código", () => {
  const saved = { ...process.env };
  afterEach(() => { for (const k of ["WHATSAPP_SHOPPING_ENABLED","WHATSAPP_SHOPPING_PILOT_USER_IDS","SERPAPI_API_KEY"]) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } boom.mockClear(); });
  it("constante de liberação está false", () => expect(SHOPPING_RELEASE_AUTHORIZED).toBe(false));
  for (const [nome, val] of [["ativa", "true"], ["ausente", undefined], ["inválida", "TRUE "]] as const) {
    it(`flag ${nome} + piloto preenchido no ambiente real → indisponível (null), sem rede`, async () => {
      if (val === undefined) delete process.env.WHATSAPP_SHOPPING_ENABLED; else process.env.WHATSAPP_SHOPPING_ENABLED = val;
      process.env.WHATSAPP_SHOPPING_PILOT_USER_IDS = U;
      process.env.SERPAPI_API_KEY = "x";
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
