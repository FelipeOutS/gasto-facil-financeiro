import { describe, expect, test } from "bun:test";
import { parseValor, parseWhatsAppExpenseMessage } from "@/lib/whatsappParser";

describe("parseValor — milhar PT-BR (P0)", () => {
  const ok: Array<[string, number]> = [
    ["gastei 1 real no teste hoje", 1],
    ["Mercado 1.950", 1950],
    ["Aluguel 1.500", 1500],
    ["R$ 2.000", 2000],
    ["R$ 2.500", 2500],
    ["Notebook 2.500 cartao", 2500],
    ["Aluguel 10.000", 10000],
    ["R$ 1.234,56", 1234.56],
    ["R$ 2.500,00", 2500],
    ["R$ 1.950,00", 1950],
    ["1234,56", 1234.56],
    ["1234.56", 1234.56],
    ["R$ 19,90", 19.9],
    ["R$ 19.90", 19.9],
    ["950", 950],
    ["2.500", 2500],
    ["uber 50.", 50],
  ];
  for (const [txt, v] of ok) test(`${txt} => ${v}`, () => expect(parseValor(txt)).toBe(v));

  for (const bad of ["0", "1.95.0", "2.500.00", "1.234,567", "12,345", "sem valor"]) {
    test(`rejeita ${bad}`, () => expect(parseValor(bad)).toBeNull());
  }

  test("R$ 2.500 nunca vira 2,50", () => expect(parseValor("R$ 2.500")).not.toBe(2.5));
});

describe("parseWhatsAppExpenseMessage — fluxo textual", () => {
  test("Mercado 1.950 hoje no pix => 1950", () => {
    expect(parseWhatsAppExpenseMessage("Mercado 1.950 hoje no pix").valor).toBe(1950);
  });
  test("R$ 1.950,00 mercado => 1950", () => {
    expect(parseWhatsAppExpenseMessage("R$ 1.950,00 mercado").valor).toBe(1950);
  });
  test("mercado 50 ontem continua 50", () => {
    expect(parseWhatsAppExpenseMessage("mercado 50 ontem").valor).toBe(50);
  });
});
