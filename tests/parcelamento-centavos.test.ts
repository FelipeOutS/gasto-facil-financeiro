import { expect, test } from "bun:test";
import { parcelasEmCentavos, gruposParcelas } from "../src/lib/parcelamento";
import { calcularParcelasCentavos } from "../src/server/cartao-parcelamento.server";
const cases = [
  [100, 3],
  [10, 3],
  [1, 3],
  [0.1, 3],
  [999.99, 7],
  [1000, 12],
  [10000.01, 24],
  [89.9, 2],
  [1200, 12],
  [0.03, 3],
  [999999999.99, 36],
];
for (const [total, n] of cases)
  test(`${total} / ${n} conserves every cent`, () => {
    const parts = parcelasEmCentavos(total, n);
    expect(parts.length).toBe(n);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(Math.round(total * 100));
    expect(parts.every((p) => Number.isSafeInteger(p) && p > 0)).toBe(true);
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
    expect(parts).toEqual(calcularParcelasCentavos(Math.round(total * 100), n));
  });
test("first installments receive remainder, exactly matching preview", () => {
  expect(parcelasEmCentavos(100, 3)).toEqual([3334, 3333, 3333]);
  expect(gruposParcelas(100, 3)).toEqual([
    { quantidade: 1, valor: 33.34 },
    { quantidade: 2, valor: 33.33 },
  ]);
  expect(gruposParcelas(10, 6)).toEqual([
    { quantidade: 4, valor: 1.67 },
    { quantidade: 2, valor: 1.66 },
  ]);
});
test("deterministic property: 20000 totals/counts retain exact integer sum", () => {
  let seed = 20260921;
  for (let i = 0; i < 20000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const n = 1 + (seed % 1000);
    const cents = n + (seed % 1000000000);
    const parts = parcelasEmCentavos(cents / 100, n);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(cents);
    expect(parts.every((p) => Number.isSafeInteger(p) && p > 0)).toBe(true);
  }
});
test("large count and low values", () => {
  const parts = parcelasEmCentavos(100.01, 10000);
  expect(parts[0]).toBe(2);
  expect(parts.slice(1).every((p) => p === 1)).toBe(true);
});
test("invalid amounts/counts never produce negative NaN or zero installments", () => {
  for (const [v, n] of [
    [NaN, 3],
    [Infinity, 3],
    [-1, 3],
    [0, 3],
    [1.001, 3],
    [1, NaN],
    [1, Infinity],
    [1, 0],
    [1, -3],
    [1, 2.5],
    [0.01, 3],
    [Number.MAX_SAFE_INTEGER, 3],
  ]) {
    expect(() => parcelasEmCentavos(v, n)).toThrow();
    expect(gruposParcelas(v, n)).toBeNull();
  }
});
test("draft total/count edits recalculate without modifying earlier result", () => {
  const original = parcelasEmCentavos(100, 3);
  expect(parcelasEmCentavos(100.01, 3)).toEqual([3334, 3334, 3333]);
  expect(parcelasEmCentavos(100, 4)).toEqual([2500, 2500, 2500, 2500]);
  expect(original).toEqual([3334, 3333, 3333]);
});
