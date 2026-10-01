import { describe, expect, test } from "bun:test";
import { mock } from "bun:test";

// Bun não entende imports `?url` do Vite: cada asset local vira o próprio caminho.
for (const p of ["/public/logos/bancos/Banco_Bradesco.svg?url", "/public/logos/bancos/banco-do-brasil-novo.svg?url", "/public/logos/bancos/banco-inter.svg?url", "/public/logos/bancos/banco-itau.svg?url", "/public/logos/bancos/Logo_C6_Bank.svg?url", "/public/logos/bancos/logo-caixa.svg?url", "/public/logos/bancos/logo-santander.svg?url", "/public/logos/bancos/mercadopago-branco.svg?url", "/public/logos/bancos/nubank.svg?url", "/public/logos/bancos/picpay.svg?url", "/public/logos/bancos/will-bank.svg?url", "/public/logos/bancos/neon.svg?url", "/public/logos/empresas/adobe.svg?url", "/public/logos/empresas/amazon.svg?url", "/public/logos/empresas/apple.svg?url", "/public/logos/empresas/cobasi.svg?url", "/public/logos/empresas/coursera.svg?url", "/public/logos/empresas/google.svg?url", "/public/logos/empresas/ifood.svg?url", "/public/logos/empresas/mercado-livre.svg?url", "/public/logos/empresas/microsoft.svg?url", "/public/logos/empresas/netflix.svg?url", "/public/logos/empresas/spotify.svg?url", "/public/logos/empresas/totalpass.svg?url", "/public/logos/empresas/uber-eats.svg?url", "/public/logos/empresas/uber.svg?url", "/public/logos/empresas/youtube.svg?url"]) {
  mock.module(p, () => ({ default: p.replace(/\?url$/, "") }));
}
const { getBankLogo } = await import("@/lib/logos");

describe("Identidade visual do cartão", () => {
  test("Nubank resolve o asset local, sem depender de caixa/acentos/espaços", () => {
    for (const n of ["Nubank", "nubank", "NUBANK", "  Nubank  ", "Nu Pagamentos"]) {
      const r = getBankLogo(n);
      expect(r.slug).toBe("nubank");
      expect(r.logoUrl).toBeTruthy();
      expect(r.logoUrl).not.toMatch(/^https?:/);
    }
  });

  test("outros bancos com asset resolvem", () => {
    for (const [n, slug] of [
      ["Mercado Pago", "mercadopago-branco"],
      ["Itaú", "banco-itau"],
      ["C6 Bank", "Logo_C6_Bank"],
      ["PicPay", "picpay"],
      ["Banco do Brasil", "banco-do-brasil"],
    ]) {
      expect(getBankLogo(n).slug).toBe(slug);
    }
  });

  test("banco sem logo conhecido cai no fallback (sem URL local)", () => {
    const r = getBankLogo("Banco Xyz Inexistente");
    expect(r.logoUrl).toBeFalsy();
    expect(r.initial).toBe("B");
  });
});
