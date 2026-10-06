import { test, expect, mock } from "bun:test";
mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: async () => ({ data: null, error: { code: "test" } }) },
}));
const {
  createLinkToken, hashLinkToken, parseLinkConfirmation, canonicalWhatsAppPhone,
} = await import("../src/server/whatsapp-link-verification.server");

test("token é aleatório, não ambíguo, hash não revela o segredo e só a frase exata é aceita", () => {
  const tokens = new Set(Array.from({ length: 100 }, () => createLinkToken()));
  expect(tokens.size).toBe(100);
  for (const token of tokens) {
    expect(token).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    expect(hashLinkToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashLinkToken(token)).not.toContain(token);
    expect(parseLinkConfirmation(`Confirmar Gasto Inteligente ${token}`)).toBe(token);
    expect(parseLinkConfirmation(`gastei 30 CONFIRMAR GASTO INTELIGENTE ${token}`)).toBeNull();
  }
  expect(canonicalWhatsAppPhone("+55 (11) 99999-8888")).toBe("5511999998888");
  expect(canonicalWhatsAppPhone("11999998888")).toBe("5511999998888");
  expect(canonicalWhatsAppPhone("invalido")).toBeNull();
});
