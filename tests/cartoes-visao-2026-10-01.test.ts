import { describe, expect, test } from "bun:test";
import {
  VISAO_GERAL,
  comprasDaVisao,
  normalizarVisao,
  totaisDaVisao,
  vencimentosDaVisao,
  visaoInicial,
} from "@/lib/cartoes-visao";

const mp = { id: "mp", nome: "Mercado pago", banco: "Mercado Pago", limiteTotal: 8800, diaVencimento: 11 };
const nu = { id: "nu", nome: "Nubank", banco: "Nubank", limiteTotal: 5000, diaVencimento: 5 };
const cartoes = [mp, nu];
const resumos = new Map([
  ["mp", { usadoMes: 297, limite: 8800, disponivel: 8503, pct: 3.4 }],
  ["nu", { usadoMes: 56, limite: 5000, disponivel: 4944, pct: 1.1 }],
]);
const faturas = new Map([
  ["mp", { status: "aberta", pendente: 297 }],
  ["nu", { status: "aberta", pendente: 56 }],
]);
const dias = (d: number) => (d === 5 ? 4 : 10);
const gastos = [
  { id: "1", formaPagamento: "credito", cartaoId: "nu", data: "2026-10-01", valor: 56 },
  { id: "2", formaPagamento: "credito", cartaoId: "mp", data: "2026-10-01", valor: 15 },
  { id: "3", formaPagamento: "credito", cartaoId: "mp", data: "2026-09-30", valor: 257 },
  { id: "4", formaPagamento: "credito", cartaoId: "mp", data: "2026-09-30", valor: 25 },
  { id: "5", formaPagamento: "pix", cartaoId: undefined, data: "2026-10-01", valor: 99 },
] as const;

describe("Cartões — visão geral × cartão selecionado", () => {
  test("1 cartão abre selecionado; 2+ abre em Visão geral", () => {
    expect(visaoInicial([mp])).toBe("mp");
    expect(visaoInicial(cartoes)).toBe(VISAO_GERAL);
    expect(visaoInicial([])).toBe(VISAO_GERAL);
  });

  test("Visão geral soma tudo (13.800 / 353 / 13.447)", () => {
    expect(totaisDaVisao(cartoes, resumos, VISAO_GERAL)).toEqual({ limite: 13800, usado: 353, disponivel: 13447 });
  });

  test("Mercado Pago selecionado mostra só Mercado Pago", () => {
    const t = totaisDaVisao(cartoes, resumos, "mp");
    expect(t).toEqual({ limite: 8800, usado: 297, disponivel: 8503 });
    expect(t.limite).not.toBe(13800);
  });

  test("Nubank selecionado mostra só Nubank", () => {
    expect(totaisDaVisao(cartoes, resumos, "nu")).toEqual({ limite: 5000, usado: 56, disponivel: 4944 });
  });

  test("compras filtradas pelo cartão, sem duplicar", () => {
    expect(comprasDaVisao([...gastos], "nu").map((g) => g.id)).toEqual(["1"]);
    expect(comprasDaVisao([...gastos], "mp").map((g) => g.id).sort()).toEqual(["2", "3", "4"]);
    const geral = comprasDaVisao([...gastos], VISAO_GERAL).map((g) => g.id);
    expect(geral.sort()).toEqual(["1", "2", "3", "4"]);
    expect(new Set(geral).size).toBe(geral.length);
  });

  test("próximos vencimentos filtrados e ordenados", () => {
    expect(vencimentosDaVisao(cartoes, faturas, "nu", dias).map((v) => v.cartao.id)).toEqual(["nu"]);
    expect(vencimentosDaVisao(cartoes, faturas, "mp", dias).map((v) => v.cartao.id)).toEqual(["mp"]);
    expect(vencimentosDaVisao(cartoes, faturas, VISAO_GERAL, dias).map((v) => v.cartao.id)).toEqual(["nu", "mp"]);
  });

  test("trocar MP → Nubank → Visão geral atualiza tudo", () => {
    let v: string = "mp";
    expect(totaisDaVisao(cartoes, resumos, v).limite).toBe(8800);
    v = "nu";
    expect(totaisDaVisao(cartoes, resumos, v).limite).toBe(5000);
    expect(comprasDaVisao([...gastos], v).every((g) => g.cartaoId === "nu")).toBe(true);
    v = VISAO_GERAL;
    expect(totaisDaVisao(cartoes, resumos, v).limite).toBe(13800);
  });

  test("cartão removido volta para visão válida", () => {
    expect(normalizarVisao("xx", cartoes)).toBe(VISAO_GERAL);
    expect(normalizarVisao("xx", [nu])).toBe("nu");
  });

  test("logo/banco não altera os cálculos", () => {
    const semBanco = cartoes.map((c) => ({ ...c, banco: "Banco Desconhecido" }));
    expect(totaisDaVisao(semBanco, resumos, "nu")).toEqual(totaisDaVisao(cartoes, resumos, "nu"));
  });
});
