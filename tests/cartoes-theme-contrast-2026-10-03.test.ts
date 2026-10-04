import { describe, expect, test } from "bun:test";
import { getAutomaticCardColor, getCardTheme } from "../src/lib/card-theme";

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channels = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe("Cartões — contraste da superfície", () => {
  test("o formulário deriva cor do emissor e mantém desconhecidos neutros", () => {
    expect(getAutomaticCardColor("")).toBe("#34383f");
    expect(getAutomaticCardColor("Banco Desconhecido")).toBe("#34383f");
    expect(getAutomaticCardColor("Nubank")).toBe("#820ad1");
    expect(getAutomaticCardColor("Itaú")).toBe("#ec7000");
    expect(getAutomaticCardColor("Banco Itau")).toBe("#ec7000");
    expect(getAutomaticCardColor("Itau Unibanco")).toBe("#ec7000");
    expect(getAutomaticCardColor("Inter")).toBe("#ff7a00");
    expect(getAutomaticCardColor("Santander")).toBe("#ec0000");
    expect(getAutomaticCardColor("Mercado Pago")).toBe("#00b1ea");
    expect(getAutomaticCardColor("Bradesco")).toBe("#cc092f");
    expect(getAutomaticCardColor("neon")).toBe("#00d563");
    expect(getAutomaticCardColor("Cartao Atacadao")).toBe("#006943");
    expect(getAutomaticCardColor("Assai Atacadista")).toBe("#f4f0e8");
    expect(getAutomaticCardColor("Outro")).toBe("#34383f");
  });

  test("texto e marca mantêm contraste nas cores disponíveis e tons claros", () => {
    for (const color of [
      "#820ad1", "#ec7000", "#ec0000", "#00b1ea", "#ff7a00", "#3a3a3a",
      "#cc092f", "#1c5aa8", "#21c25e", "#0f9b5e", "#8b5cf6", "#0ea5e9",
      "#fae128", "#f5f5f5", "#ffffff", "#000000", "#777777", "#006943", "#f4f0e8",
    ]) {
      const theme = getCardTheme(color);
      const stops = theme.background.match(/#[0-9a-f]{6}/gi) ?? [];
      expect(stops.length).toBe(3);
      for (const stop of stops) {
        expect(contrast(stop, theme.fg)).toBeGreaterThanOrEqual(4.5);
      }
      expect(theme.logoTone).toBe(theme.fg === "#000000" ? "dark" : "light");
    }
  });

  test("emissores premium mantêm o gradiente escuro e marca clara", () => {
    for (const issuer of ["Mercado Pago", "C6 Bank"]) {
      const theme = getCardTheme("#ffffff", issuer);
      expect(theme.premium).toBe(true);
      expect(theme.logoTone).toBe("light");
      for (const stop of theme.background.match(/#[0-9a-f]{6}/gi) ?? []) {
        expect(contrast(stop, theme.fg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test("laranja saturado recebe marca clara sem alterar o HEX escolhido", () => {
    const color = "#ec7000";
    const theme = getCardTheme(color, "Itaú");
    expect(color).toBe("#ec7000");
    expect(theme.primary).toBe(color);
    expect(theme.logoTone).toBe("light");
    for (const stop of theme.background.match(/#[0-9a-f]{6}/gi) ?? []) {
      expect(contrast(stop, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }
    expect(getCardTheme("#f5f5f5", "Itaú").logoTone).toBe("dark");
  });
});
