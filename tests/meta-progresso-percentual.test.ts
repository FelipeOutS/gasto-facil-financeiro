import { describe, expect, it } from "vitest";
import { pctMeta } from "@/lib/meta-progresso";

describe("pctMeta — percentual de progresso da meta", () => {
  it("1050 / 10000 = 10.5%", () => {
    expect(pctMeta(1050, 10000)).toBeCloseTo(10.5, 6);
    expect(Math.round(pctMeta(1050, 10000))).toBe(11);
  });

  it("não pode retornar 100% para 1050 / 10000", () => {
    expect(pctMeta(1050, 10000)).not.toBe(100);
  });

  it("5000 / 10000 = 50%", () => {
    expect(pctMeta(5000, 10000)).toBe(50);
  });

  it("10000 / 10000 = 100%", () => {
    expect(pctMeta(10000, 10000)).toBe(100);
  });

  it("12000 / 10000 = 100% (teto visual)", () => {
    expect(pctMeta(12000, 10000)).toBe(100);
  });

  it("0 / 10000 = 0%", () => {
    expect(pctMeta(0, 10000)).toBe(0);
  });

  it("objetivo 0 => fallback seguro", () => {
    expect(pctMeta(500, 0)).toBe(0);
  });

  it("null / undefined / NaN => fallback seguro", () => {
    expect(pctMeta(null, 10000)).toBe(0);
    expect(pctMeta(1050, null)).toBe(0);
    expect(pctMeta(undefined, undefined)).toBe(0);
    expect(pctMeta(Number.NaN, 10000)).toBe(0);
  });
});
