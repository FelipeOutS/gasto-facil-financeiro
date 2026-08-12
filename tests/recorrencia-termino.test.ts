/**
 * Término da recorrência — ocorrências, data final e sem data final.
 * Roda via: bun test tests/recorrencia-termino.test.ts
 */
import { describe, expect, it } from "bun:test";
import {
  countOccurrencesUntilISO,
  generateOccurrencesISO,
  previewOccurrences,
  resolveOccurrenceCount,
  validateRecurrence,
  MAX_MATERIALIZED_OCCURRENCES,
} from "../src/lib/recurrence-date";

const rule = (interval: number, unit: string) => ({ interval, unit: unit as never });

describe("número de ocorrências (primeira data conta)", () => {
  it("4 ocorrências a cada 4 meses", () => {
    const n = resolveOccurrenceCount("2026-08-10", rule(4, "mes"), { mode: "count", count: 4 });
    expect(n).toBe(4);
    expect(generateOccurrencesISO("2026-08-10", n, rule(4, "mes"))).toEqual([
      "2026-08-10",
      "2026-12-10",
      "2027-04-10",
      "2027-08-10",
    ]);
  });
});

describe("até uma data", () => {
  it("a cada 3 meses até 31/05/2027", () => {
    const n = resolveOccurrenceCount("2026-08-10", rule(3, "mes"), {
      mode: "until",
      until: "2027-05-31",
    });
    expect(generateOccurrencesISO("2026-08-10", n, rule(3, "mes"))).toEqual([
      "2026-08-10",
      "2026-11-10",
      "2027-02-10",
      "2027-05-10",
    ]);
  });

  it("não inclui ocorrência após a data final", () => {
    expect(countOccurrencesUntilISO("2026-08-10", "2027-05-09", rule(3, "mes"))).toBe(3);
  });
});

describe("sem data final", () => {
  it("materializa horizonte limitado, nunca infinito", () => {
    const n = resolveOccurrenceCount("2026-08-10", rule(1, "mes"), { mode: "forever" });
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(60);
    expect(n).toBeLessThan(MAX_MATERIALIZED_OCCURRENCES);
  });

  it("prévia limitada e sem total definido", () => {
    const p = previewOccurrences("2026-08-10", rule(4, "mes"), { mode: "forever" }, 4);
    expect(p.dates).toEqual(["2026-08-10", "2026-12-10", "2027-04-10", "2027-08-10"]);
    expect(p.remaining).toBeNull();
    expect(p.openEnded).toBe(true);
  });
});

describe("prévia usa o mesmo motor", () => {
  it("fim de mês: 31/01/2027 mensal", () => {
    const p = previewOccurrences("2027-01-31", rule(1, "mes"), { mode: "count", count: 5 }, 5);
    expect(p.dates).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
      "2027-05-31",
    ]);
    expect(p.remaining).toBe(0);
  });

  it("29/02 anual", () => {
    const p = previewOccurrences("2028-02-29", rule(1, "ano"), { mode: "count", count: 3 }, 3);
    expect(p.dates).toEqual(["2028-02-29", "2029-02-28", "2030-02-28"]);
  });

  it("intervalos personalizados: 7 meses, 15 dias, 2 semanas, 2 anos", () => {
    const cases: [number, string, string[]][] = [
      [7, "mes", ["2026-08-10", "2027-03-10", "2027-10-10", "2028-05-10"]],
      [15, "dia", ["2026-08-10", "2026-08-25", "2026-09-09", "2026-09-24"]],
      [2, "semana", ["2026-08-10", "2026-08-24", "2026-09-07", "2026-09-21"]],
      [2, "ano", ["2026-08-10", "2028-08-10", "2030-08-10", "2032-08-10"]],
    ];
    for (const [interval, unit, expected] of cases) {
      const p = previewOccurrences(
        "2026-08-10",
        rule(interval, unit),
        { mode: "count", count: 12 },
        4,
      );
      expect(p.dates).toEqual(expected);
      expect(p.remaining).toBe(8);
      // prévia == geração real
      expect(p.dates).toEqual(generateOccurrencesISO("2026-08-10", 4, rule(interval, unit)));
    }
  });
});

describe("validações", () => {
  it("recusa data final anterior à inicial", () => {
    expect(
      validateRecurrence("2026-08-10", rule(1, "mes"), { mode: "until", until: "2026-07-01" }),
    ).toEqual({ ok: false, code: "untilBeforeStart" });
  });

  it("recusa contagem 0 e intervalo 0", () => {
    expect(
      validateRecurrence("2026-08-10", rule(1, "mes"), { mode: "count", count: 0 }).ok,
    ).toBe(false);
    expect(validateRecurrence("2026-08-10", rule(0, "mes"), { mode: "forever" }).ok).toBe(false);
  });

  it("aceita configuração válida", () => {
    expect(
      validateRecurrence("2026-08-10", rule(4, "mes"), { mode: "count", count: 12 }),
    ).toEqual({ ok: true });
  });
});

describe("edição: dedução da regra a partir das ocorrências", () => {
  it("reconstrói 'a cada 4 meses' (não vira mensal)", async () => {
    const { inferRuleFromISODates } = await import("../src/lib/recurrence-date");
    expect(
      inferRuleFromISODates(["2026-08-10", "2026-12-10", "2027-04-10", "2027-08-10"]),
    ).toEqual({ interval: 4, unit: "mes" });
    expect(inferRuleFromISODates(["2026-08-10", "2026-09-10"])).toEqual({
      interval: 1,
      unit: "mes",
    });
    expect(inferRuleFromISODates(["2026-08-10", "2028-08-10"])).toEqual({
      interval: 2,
      unit: "ano",
    });
    expect(inferRuleFromISODates(["2026-08-10", "2026-08-24"])).toEqual({
      interval: 2,
      unit: "semana",
    });
    expect(inferRuleFromISODates(["2026-08-10", "2026-08-25"])).toEqual({
      interval: 15,
      unit: "dia",
    });
    expect(inferRuleFromISODates(["2026-08-10"])).toBeNull();
  });
});
