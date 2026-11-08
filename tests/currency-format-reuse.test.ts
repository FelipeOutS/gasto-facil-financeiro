import { expect, test } from "bun:test";
import { formatBRL, formatBRLCompact } from "../src/lib/format";

test("formatadores reutilizados preservam exatamente moeda, arredondamento e limiar compacto", () => {
  for (const value of [0, -0, NaN, Infinity, -Infinity, 0.01, -0.01, 1.005, 56, 999.99, 1000, -1000, 3065.8, 1e6, 1e12]) {
    const full = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
    const compact = Math.abs(value) >= 1000
      ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 1, notation: "compact" }).format(value)
      : full;
    expect(formatBRL(value)).toBe(full);
    expect(formatBRLCompact(value)).toBe(compact);
  }
});
