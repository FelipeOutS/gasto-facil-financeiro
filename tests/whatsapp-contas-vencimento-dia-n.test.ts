/**
 * WA-3.28 — "vence dia N" resolve automaticamente para a próxima
 * ocorrência aplicável em America/Sao_Paulo.
 *
 * Contrato:
 *   - dia futuro no mês corrente → usa o mês corrente;
 *   - dia = hoje → hoje;
 *   - dia já passado no mês corrente → mesmo dia no próximo mês;
 *   - dia inválido no mês corrente (ex. 31 em setembro) → avança até
 *     o próximo mês que possua esse dia;
 *   - fev/leap: dia 29 em fevereiro bissexto = 29/02; em ano não
 *     bissexto avança para 29/03 do próximo ciclo;
 *   - datas completas ("05/08/2026", "5 de agosto") mantêm prioridade;
 *   - nunca produz data no passado.
 *
 * Usa relógio controlado passando `hoje` diretamente para
 * `extrairDataVencimento` (fuso SP).
 */
import { describe, expect, it } from "bun:test";
import { extrairDataVencimento } from "../src/server/whatsapp-contas-criar.server";

function d(y: number, m: number, day: number): Date {
  // Wallclock SP — a função aceita Date "local".
  return new Date(y, m - 1, day, 12, 0, 0);
}

describe("WA-3.28 — extrairDataVencimento('vence dia N')", () => {
  it("dia futuro no mês corrente", () => {
    const r = extrairDataVencimento("vence dia 5", d(2026, 7, 2));
    expect(r).toEqual({ iso: "2026-07-05", dia: 5, mes: 7, ano: 2026 });
  });

  it("dia = hoje", () => {
    const r = extrairDataVencimento("vence dia 2", d(2026, 7, 2));
    expect(r).toEqual({ iso: "2026-07-02", dia: 2, mes: 7, ano: 2026 });
  });

  it("dia já passado no mês corrente → próximo mês", () => {
    const r = extrairDataVencimento("vence dia 1", d(2026, 7, 2));
    expect(r).toEqual({ iso: "2026-08-01", dia: 1, mes: 8, ano: 2026 });
  });

  it("dia 31 em setembro → outubro", () => {
    const r = extrairDataVencimento("vence dia 31", d(2026, 9, 15));
    expect(r).toEqual({ iso: "2026-10-31", dia: 31, mes: 10, ano: 2026 });
  });

  it("dia 31 em julho, hoje = 31/07 → hoje", () => {
    const r = extrairDataVencimento("vence dia 31", d(2026, 7, 31));
    expect(r).toEqual({ iso: "2026-07-31", dia: 31, mes: 7, ano: 2026 });
  });

  it("dia 29 em fev bissexto (2028) → 29/02", () => {
    const r = extrairDataVencimento("vence dia 29", d(2028, 2, 1));
    expect(r).toEqual({ iso: "2028-02-29", dia: 29, mes: 2, ano: 2028 });
  });

  it("dia 29 em fev não bissexto → março", () => {
    const r = extrairDataVencimento("vence dia 29", d(2027, 2, 1));
    expect(r).toEqual({ iso: "2027-03-29", dia: 29, mes: 3, ano: 2027 });
  });

  it("virada de ano: dia já passado em dezembro → janeiro do próximo ano", () => {
    const r = extrairDataVencimento("vence dia 5", d(2026, 12, 20));
    expect(r).toEqual({ iso: "2027-01-05", dia: 5, mes: 1, ano: 2027 });
  });

  it("data completa 'vence 05/08/2026' tem prioridade", () => {
    const r = extrairDataVencimento("vence 05/08/2026", d(2026, 7, 2));
    expect(r).toEqual({ iso: "2026-08-05", dia: 5, mes: 8, ano: 2026 });
  });

  it("data completa '5 de agosto' sem ano usa ano corrente", () => {
    const r = extrairDataVencimento("vence 5 de agosto", d(2026, 7, 2));
    expect(r).toEqual({ iso: "2026-08-05", dia: 5, mes: 8, ano: 2026 });
  });

  it("nunca retorna 'dia_somente' para 'dia N'", () => {
    for (const hoje of [d(2026, 7, 2), d(2026, 12, 31), d(2027, 2, 28)]) {
      const r = extrairDataVencimento("vence dia 10", hoje);
      expect(r && "iso" in r).toBe(true);
    }
  });

  it("nunca gera data anterior a hoje", () => {
    for (let dia = 1; dia <= 31; dia++) {
      const hoje = d(2026, 7, 15);
      const r = extrairDataVencimento(`vence dia ${dia}`, hoje);
      expect(r && "iso" in r).toBe(true);
      if (r && "iso" in r) {
        expect(r.iso >= "2026-07-15").toBe(true);
      }
    }
  });
});
