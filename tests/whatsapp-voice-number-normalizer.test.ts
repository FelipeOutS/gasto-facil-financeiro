import { describe, it, expect } from "bun:test";
import { normalizeVoiceMoney } from "@/server/whatsapp-voice-number-normalizer.server";

const n = (s: string) => normalizeVoiceMoney(s).normalizedText;

describe("normalizeVoiceMoney", () => {
  it("quarenta e dois reais", () => {
    expect(n("Gastei quarenta e dois reais no almoço hoje no Pix.")).toBe(
      "Gastei R$ 42,00 no almoço hoje no Pix.",
    );
  });
  it("dez reais e cinquenta centavos", () => {
    expect(n("Paguei dez reais e cinquenta centavos no café.")).toBe("Paguei R$ 10,50 no café.");
  });
  it("cem reais", () => {
    expect(n("gastei cem reais")).toBe("gastei R$ 100,00");
  });
  it("dois mil reais", () => {
    expect(n("paguei dois mil reais")).toBe("paguei R$ 2.000,00");
  });
  it("dois mil e quinhentos reais", () => {
    expect(n("recebi dois mil e quinhentos reais de salário")).toBe(
      "recebi R$ 2.500,00 de salário",
    );
  });
  it("mil e vinte reais", () => {
    expect(n("mil e vinte reais")).toBe("R$ 1.020,00");
  });
  it("quarenta e dois reais e noventa centavos", () => {
    expect(n("quarenta e dois reais e noventa centavos")).toBe("R$ 42,90");
  });
  it("gastei 42 reais no almoço", () => {
    expect(n("gastei 42 reais no almoço")).toBe("gastei R$ 42,00 no almoço");
  });
  it("dia cinco", () => {
    expect(n("dia cinco vence minha conta")).toBe("dia cinco vence minha conta");
  });
  it("em três parcelas", () => {
    expect(n("comprei em três parcelas")).toBe("comprei em três parcelas");
  });
  it("cartão final quarenta e dois", () => {
    expect(n("cartão final quarenta e dois")).toBe("cartão final quarenta e dois");
  });
  it("às oito horas", () => {
    expect(n("chegou às oito horas")).toBe("chegou às oito horas");
  });
  it("comprei dois produtos", () => {
    expect(n("comprei dois produtos")).toBe("comprei dois produtos");
  });
  it("texto sem números mantido", () => {
    expect(n("oi, tudo bem?")).toBe("oi, tudo bem?");
  });
  it("contagem", () => {
    const r = normalizeVoiceMoney("gastei quarenta reais e paguei cinco reais");
    expect(r.normalizedValuesCount).toBe(2);
    expect(r.moneyDetected).toBe(true);
  });
});
