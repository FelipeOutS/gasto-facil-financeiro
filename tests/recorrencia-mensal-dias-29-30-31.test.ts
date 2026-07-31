/**
 * Prompt 2 — Recorrência mensal sem overflow de dia (BUG-01).
 *
 * Roda via: bun test tests/recorrencia-mensal-dias-29-30-31.test.ts
 *
 * Puro (sem DB, sem browser). Cobre `addMonthsPreservingDay` /
 * `addMonthsPreservingDayISO`, usados pela geração de séries mensais de
 * receitas, gastos parcelados/recorrentes e contas a pagar.
 */
import { describe, expect, it } from "bun:test";
import {
  addMonthsPreservingDay,
  addMonthsPreservingDayISO,
  daysInMonth,
} from "../src/lib/recurrence-date";

const iso = (s: string, i: number) => addMonthsPreservingDayISO(s, i);

describe("addMonthsPreservingDay — clamp para o último dia do mês", () => {
  it("dia 28 nunca muda", () => {
    expect(iso("2026-01-28", 1)).toBe("2026-02-28");
    expect(iso("2026-01-28", 2)).toBe("2026-03-28");
  });

  it("31/01 → 28/02 em ano comum", () => {
    expect(iso("2027-01-31", 1)).toBe("2027-02-28");
  });

  it("31/01 → 29/02 em ano bissexto", () => {
    expect(iso("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("31/01 → 31/03 (dia-base preservado após fevereiro)", () => {
    expect(iso("2027-01-31", 2)).toBe("2027-03-31");
  });

  it("30/01 → 28/02 (comum) e 29/02 (bissexto)", () => {
    expect(iso("2027-01-30", 1)).toBe("2027-02-28");
    expect(iso("2028-01-30", 1)).toBe("2028-02-29");
  });

  it("29/01 → 28/02 em ano comum e 29/03 no mês seguinte", () => {
    expect(iso("2027-01-29", 1)).toBe("2027-02-28");
    expect(iso("2027-01-29", 2)).toBe("2027-03-29");
  });

  it("31/03 → 30/04 e 31/05 → 30/06", () => {
    expect(iso("2026-03-31", 1)).toBe("2026-04-30");
    expect(iso("2026-05-31", 1)).toBe("2026-06-30");
  });

  it("fevereiro → março mantém o dia existente", () => {
    expect(iso("2026-02-15", 1)).toBe("2026-03-15");
  });

  it("daysInMonth cobre fevereiro comum e bissexto", () => {
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
  });
});

describe("séries de 12 meses", () => {
  function serie(base: string, meses = 12): string[] {
    return Array.from({ length: meses }, (_, i) => iso(base, i));
  }

  it("dia 31: uma ocorrência por mês, sem mês faltante nem duplicado", () => {
    const s = serie("2027-01-31");
    const chaves = s.map((d) => d.slice(0, 7));
    expect(new Set(chaves).size).toBe(12);
    expect(chaves).toEqual([
      "2027-01",
      "2027-02",
      "2027-03",
      "2027-04",
      "2027-05",
      "2027-06",
      "2027-07",
      "2027-08",
      "2027-09",
      "2027-10",
      "2027-11",
      "2027-12",
    ]);
  });

  it("atravessa a virada de ano", () => {
    const s = serie("2026-11-30");
    expect(s[0]).toBe("2026-11-30");
    expect(s[2]).toBe("2027-01-30");
    expect(s[3]).toBe("2027-02-28");
    expect(s[4]).toBe("2027-03-30");
  });

  it("atravessa ano bissexto (2028)", () => {
    const s = serie("2027-12-31", 4);
    expect(s).toEqual(["2027-12-31", "2028-01-31", "2028-02-29", "2028-03-31"]);
  });

  it("caso descoberto no diagnóstico: dia 29 não transborda para 2027-03-01", () => {
    const s = serie("2026-12-29");
    expect(s).toContain("2027-02-28");
    expect(s).not.toContain("2027-03-01");
    const marco = s.filter((d) => d.startsWith("2027-03"));
    expect(marco).toEqual(["2027-03-29"]);
  });

  it("preserva o dia-base (não fixa o dia ajustado de fevereiro)", () => {
    const s = serie("2027-01-29");
    expect(s[1]).toBe("2027-02-28");
    expect(s[2]).toBe("2027-03-29");
    expect(s[3]).toBe("2027-04-29");
  });

  it("versão Date se comporta como a versão ISO", () => {
    const d = addMonthsPreservingDay(new Date(2027, 0, 31, 12, 0, 0), 1);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(28);
  });
});
