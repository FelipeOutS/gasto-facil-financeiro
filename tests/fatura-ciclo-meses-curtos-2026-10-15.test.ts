import { describe, expect, it } from "vitest";
import {
  cicloLegadoPorData,
  competenciaPorData,
  competenciasParcelas,
  periodoCiclo,
  proximoFechamento,
  vencimentoDoFechamento,
  fechamentoNoMes,
} from "@/lib/fatura-competencia";
import {
  cicloFatura as cicloServer,
  faturaCorrenteRef,
  proximoFechamentoData as proxFechServer,
  proximoVencimentoFaturaAberta as proxVencServer,
} from "@/server/cartao-fatura.server";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Todas as datas de um ciclo pela regra de classificação (fonte da verdade). */
function datasDoCiclo(diaFech: number, ciclo: string): string[] {
  const out: string[] = [];
  const [a, m] = ciclo.split("-").map(Number);
  for (let d = new Date(a, m - 1, 1); d < new Date(a, m + 1, 1); d.setDate(d.getDate() + 1)) {
    if (cicloLegadoPorData(iso(d), diaFech) === ciclo) out.push(iso(d));
  }
  return out;
}

describe("ciclo com fechamento 28-31 em meses curtos", () => {
  const casos: Array<[number, number, number]> = [];
  for (const f of [28, 29, 30, 31]) for (const ano of [2024, 2026, 2027]) for (let mes = 1; mes <= 12; mes++) casos.push([f, mes, ano]);

  it.each(casos)("fech %i ciclo %i/%i: janela por data == classificação", (f, mes, ano) => {
    const ciclo = `${ano}-${String(mes).padStart(2, "0")}`;
    const datas = datasDoCiclo(f, ciclo);
    const { inicio, fim } = periodoCiclo(f, mes, ano);
    expect(iso(inicio)).toBe(datas[0]);
    expect(iso(fim)).toBe(datas[datas.length - 1]);
    // WhatsApp espelha o site
    const s = cicloServer(f, mes, ano);
    expect(iso(s.inicio)).toBe(datas[0]);
    expect(iso(s.fim)).toBe(datas[datas.length - 1]);
  });

  it("fech 31, ciclo fev/2026 cobre 01/03 a 31/03 (antes começava em 04/03)", () => {
    const { inicio, fim } = cicloServer(31, 2, 2026);
    expect(iso(inicio)).toBe("2026-03-01");
    expect(iso(fim)).toBe("2026-03-31");
  });

  it("fech 30, ciclo fev bissexto 2024 começa 01/03", () => {
    expect(iso(cicloServer(30, 2, 2024).inicio)).toBe("2024-03-01");
    expect(iso(cicloServer(30, 1, 2024).fim)).toBe("2024-02-29");
  });

  it("fechamento exibido: fech 31 em abril = 30/04, não 01/05", () => {
    expect(iso(proxFechServer(31, new Date(2026, 3, 15))!)).toBe("2026-04-30");
    expect(iso(proximoFechamento(31, new Date(2026, 3, 30)))).toBe("2026-04-30");
    expect(iso(proximoFechamento(31, new Date(2026, 4, 1)))).toBe("2026-05-31");
    expect(iso(proximoFechamento(30, new Date(2026, 1, 10)))).toBe("2026-02-28");
    expect(iso(proximoFechamento(29, new Date(2024, 1, 10)))).toBe("2024-02-29");
    expect(iso(proximoFechamento(29, new Date(2026, 1, 10)))).toBe("2026-02-28");
    expect(iso(proximoFechamento(31, new Date(2026, 5, 30)))).toBe("2026-06-30");
    expect(iso(proximoFechamento(31, new Date(2026, 8, 30)))).toBe("2026-09-30");
    expect(iso(proximoFechamento(31, new Date(2026, 10, 30)))).toBe("2026-11-30");
  });

  it("dia do fechamento x dia seguinte, com virada de ano", () => {
    expect(faturaCorrenteRef(31, new Date(2026, 11, 31, 23, 59))).toEqual({ mes: 11, ano: 2026 });
    expect(faturaCorrenteRef(31, new Date(2027, 0, 1, 0, 1))).toEqual({ mes: 12, ano: 2026 });
    expect(competenciaPorData("2026-12-31", 31, 10)!.competencia).toBe("2027-01");
    expect(competenciaPorData("2027-01-01", 31, 10)!.competencia).toBe("2027-02");
    expect(competenciaPorData("2026-02-28", 30, 10)!.competencia).toBe("2026-03");
    expect(competenciaPorData("2026-03-01", 30, 10)!.competencia).toBe("2026-04");
  });

  it("vencimento segue offsetVencimento e limita ao mês", () => {
    // fech 31 venc 10: fechou 30/04 → vence 10/05
    expect(iso(proxVencServer(31, 10, new Date(2026, 3, 15))!)).toBe("2026-05-10");
    // fech 25 venc 31 em fevereiro → 28/02 (não 03/03)
    expect(iso(vencimentoDoFechamento(2026, 1, 25, 31))).toBe("2026-02-28");
    // fech 31 venc 30, fecha 28/02 → vence 30/03
    expect(iso(vencimentoDoFechamento(2026, 1, 31, 30))).toBe("2026-03-30");
    // dezembro → janeiro
    expect(iso(vencimentoDoFechamento(2026, 11, 31, 10))).toBe("2027-01-10");
    expect(iso(fechamentoNoMes(2026, 12, 31))).toBe("2027-01-31");
  });

  it("parcelamento 100/3 em cartão fech 31 a partir de dezembro", () => {
    const c = competenciaPorData("2026-12-15", 31, 10)!.competencia;
    expect(competenciasParcelas(c, 3)).toEqual(["2027-01", "2027-02", "2027-03"]);
  });

  it("dois cartões com fechamentos diferentes no mesmo dia de compra", () => {
    expect(competenciaPorData("2026-04-30", 31, 10)!.competencia).toBe("2026-05");
    expect(competenciaPorData("2026-04-30", 5, 15)!.competencia).toBe("2026-05");
    expect(competenciaPorData("2026-04-30", 29, 5)!.competencia).toBe("2026-06");
  });
});
