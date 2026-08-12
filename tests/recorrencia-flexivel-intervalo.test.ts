/**
 * Recorrência flexível — "a cada X períodos" (intervalo dinâmico).
 *
 * Roda via: bun test tests/recorrencia-flexivel-intervalo.test.ts
 */
import { describe, expect, it } from "bun:test";
import {
  generateOccurrencesISO,
  normalizeRule,
  occurrenceDateISO,
  isRecurrenceUnit,
} from "../src/lib/recurrence-date";

const serie = (base: string, n: number, interval: number, unit: string) =>
  generateOccurrencesISO(base, n, { interval, unit: unit as never });

describe("intervalos em meses — dinâmicos, sem hardcode", () => {
  it("a cada 1 mês (compatível com o comportamento antigo)", () => {
    expect(serie("2026-08-10", 4, 1, "mes")).toEqual([
      "2026-08-10",
      "2026-09-10",
      "2026-10-10",
      "2026-11-10",
    ]);
  });

  it("a cada 2 meses", () => {
    expect(serie("2026-08-10", 5, 2, "mes")).toEqual([
      "2026-08-10",
      "2026-10-10",
      "2026-12-10",
      "2027-02-10",
      "2027-04-10",
    ]);
  });

  it("a cada 3 meses", () => {
    expect(serie("2026-08-10", 4, 3, "mes")).toEqual([
      "2026-08-10",
      "2026-11-10",
      "2027-02-10",
      "2027-05-10",
    ]);
  });

  it("a cada 4 meses (caso do medicamento)", () => {
    expect(serie("2026-08-10", 4, 4, "mes")).toEqual([
      "2026-08-10",
      "2026-12-10",
      "2027-04-10",
      "2027-08-10",
    ]);
  });

  it("a cada 5 meses", () => {
    expect(serie("2026-08-10", 4, 5, "mes")).toEqual([
      "2026-08-10",
      "2027-01-10",
      "2027-06-10",
      "2027-11-10",
    ]);
  });

  it("a cada 6 meses", () => {
    expect(serie("2026-08-10", 3, 6, "mes")).toEqual(["2026-08-10", "2027-02-10", "2027-08-10"]);
  });

  it("a cada 7 meses", () => {
    expect(serie("2026-08-10", 4, 7, "mes")).toEqual([
      "2026-08-10",
      "2027-03-10",
      "2027-10-10",
      "2028-05-10",
    ]);
  });

  it("a cada 10, 12, 18 e 24 meses", () => {
    expect(serie("2026-08-10", 3, 10, "mes")).toEqual(["2026-08-10", "2027-06-10", "2028-04-10"]);
    expect(serie("2026-08-10", 3, 12, "mes")).toEqual(["2026-08-10", "2027-08-10", "2028-08-10"]);
    expect(serie("2026-08-10", 3, 18, "mes")).toEqual(["2026-08-10", "2028-02-10", "2029-08-10"]);
    expect(serie("2026-08-10", 3, 24, "mes")).toEqual(["2026-08-10", "2028-08-10", "2030-08-10"]);
  });
});

describe("dias e semanas", () => {
  it("a cada 10 dias", () => {
    expect(serie("2026-08-10", 4, 10, "dia")).toEqual([
      "2026-08-10",
      "2026-08-20",
      "2026-08-30",
      "2026-09-09",
    ]);
  });

  it("a cada 15 dias", () => {
    expect(serie("2026-08-10", 4, 15, "dia")).toEqual([
      "2026-08-10",
      "2026-08-25",
      "2026-09-09",
      "2026-09-24",
    ]);
  });

  it("a cada 2 semanas", () => {
    expect(serie("2026-08-10", 4, 2, "semana")).toEqual([
      "2026-08-10",
      "2026-08-24",
      "2026-09-07",
      "2026-09-21",
    ]);
  });

  it("a cada 3 semanas", () => {
    expect(serie("2026-08-10", 3, 3, "semana")).toEqual([
      "2026-08-10",
      "2026-08-31",
      "2026-09-21",
    ]);
  });
});

describe("anos", () => {
  it("a cada 1 ano e a cada 2 anos", () => {
    expect(serie("2026-08-10", 3, 1, "ano")).toEqual(["2026-08-10", "2027-08-10", "2028-08-10"]);
    expect(serie("2026-08-10", 3, 2, "ano")).toEqual(["2026-08-10", "2028-08-10", "2030-08-10"]);
  });

  it("29/02 anual: clamp em anos não bissextos, dia-base preservado depois", () => {
    expect(serie("2028-02-29", 5, 1, "ano")).toEqual([
      "2028-02-29",
      "2029-02-28",
      "2030-02-28",
      "2031-02-28",
      "2032-02-29",
    ]);
  });
});

describe("fim de mês e ano bissexto", () => {
  it("31/01 mensal preserva o dia original após fevereiro", () => {
    expect(serie("2027-01-31", 5, 1, "mes")).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
      "2027-05-31",
    ]);
  });

  it("30/04 e 31/03 bimestrais", () => {
    expect(serie("2027-04-30", 3, 2, "mes")).toEqual(["2027-04-30", "2027-06-30", "2027-08-30"]);
    expect(serie("2027-03-31", 3, 2, "mes")).toEqual(["2027-03-31", "2027-05-31", "2027-07-31"]);
  });

  it("28/02 e ano bissexto trimestral", () => {
    expect(serie("2028-02-28", 3, 3, "mes")).toEqual(["2028-02-28", "2028-05-28", "2028-08-28"]);
    expect(serie("2028-02-29", 3, 3, "mes")).toEqual(["2028-02-29", "2028-05-29", "2028-08-29"]);
  });

  it("atravessa a virada de ano", () => {
    expect(serie("2026-11-30", 3, 3, "mes")).toEqual(["2026-11-30", "2027-02-28", "2027-05-30"]);
  });

  it("nenhuma data gerada é inválida", () => {
    for (const unit of ["dia", "semana", "mes", "ano"]) {
      for (let interval = 1; interval <= 24; interval++) {
        for (const base of ["2027-01-31", "2028-02-29", "2027-04-30", "2026-12-31"]) {
          for (const iso of serie(base, 6, interval, unit)) {
            expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            const [y, m, d] = iso.split("-").map(Number);
            const dt = new Date(y!, m! - 1, d!);
            expect(dt.getMonth()).toBe(m! - 1);
            expect(dt.getDate()).toBe(d!);
          }
        }
      }
    }
  });
});

describe("compatibilidade e defaults seguros", () => {
  it("sem regra informada, comporta-se como mensal antigo (intervalo 1 mês)", () => {
    expect(occurrenceDateISO("2027-01-31", 1)).toBe("2027-02-28");
    expect(generateOccurrencesISO("2026-08-10", 3)).toEqual([
      "2026-08-10",
      "2026-09-10",
      "2026-10-10",
    ]);
  });

  it("normalizeRule sanitiza valores inválidos", () => {
    expect(normalizeRule(null)).toEqual({ interval: 1, unit: "mes" });
    expect(normalizeRule({ interval: 0, unit: "mes" })).toEqual({ interval: 1, unit: "mes" });
    expect(normalizeRule({ interval: 3.7, unit: "semana" })).toEqual({
      interval: 3,
      unit: "semana",
    });
    expect(normalizeRule({ interval: 4, unit: "trimestre" as never }).unit).toBe("mes");
    expect(isRecurrenceUnit("ano")).toBe(true);
    expect(isRecurrenceUnit("quinzena")).toBe(false);
  });

  it("intervalo ≠ duração: a duração só define a contagem de ocorrências", () => {
    const s = serie("2026-08-10", 6, 4, "mes");
    expect(s.length).toBe(6);
    expect(s.at(-1)).toBe("2028-04-10");
    // intervalo 4 meses nunca produz ocorrências em setembro/outubro/novembro
    expect(s.filter((d) => ["2026-09", "2026-10", "2026-11"].includes(d.slice(0, 7)))).toEqual([]);
  });
});
