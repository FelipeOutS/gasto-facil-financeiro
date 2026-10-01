import { describe, expect, test } from "bun:test";
import { getBankLogo } from "@/lib/logos";

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
