import { beforeEach, describe, expect, it, mock } from "bun:test";
import { fakeAdmin, resetState, state } from "./_whatsapp-fake";

mock.module("@/integrations/supabase/client", () => ({ supabase: fakeAdmin }));
const store = await import("../src/lib/store");
const fatura = await import("../src/server/cartao-fatura.server");
const { competenciaPorData } = await import("../src/lib/fatura-competencia");

type Card = {
  id: string;
  user_id: string;
  nome: string;
  banco: string;
  limite_total: number;
  dia_fechamento: number;
  dia_vencimento: number;
  cor: string;
  observacao: null;
  created_at: string;
  updated_at: string;
};

const card = (closing: number, due: number): Card => ({
  id: "card-1",
  user_id: "u1",
  nome: "Cartão teste",
  banco: "Teste",
  limite_total: 1000,
  dia_fechamento: closing,
  dia_vencimento: due,
  cor: "#000000",
  observacao: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

function expense(
  id: string,
  date: string,
  value: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    user_id: "u1",
    cartao_id: "card-1",
    descricao: id,
    estabelecimento: id,
    valor: value,
    data: date,
    mes: Number(date.slice(5, 7)),
    ano: Number(date.slice(0, 4)),
    categoria_id: null,
    forma_pagamento: "credito",
    tipo_gasto: "unico",
    confirmado: true,
    invoice_month: null,
    fatura_competencia: null,
    parcela_atual: null,
    total_parcelas: null,
    created_at: `${date}T12:00:00Z`,
    updated_at: `${date}T12:00:00Z`,
    ...overrides,
  };
}

async function loadFixture(c: Card, rows: Record<string, unknown>[]) {
  resetState({ cartoes: [c], gastos: rows });
  store.setActiveUserId(null);
  store.setActiveUserId("u1");
  await store.hydrateUser("u1");
  expect(store.getHydrationStatus()).toBe("ready");
}

async function expectParity(c: Card, now: Date, expectedIds: string[], expectedTotal: number) {
  const ref = store.faturaCorrente(store.getCartoes()[0], now);
  const siteItems = store.gastosDaFatura(c.id, ref.mes, ref.ano);
  const siteSummary = store.resumoFaturaPorMes(c.id, ref.mes, ref.ano);
  const waSummary = await fatura.getFaturaAtualPorCartao("u1", c, now);
  const waItems = await fatura.getItensFaturaAtualPorCartao("u1", c, now);

  expect(waSummary.competencia).toBe(
    competenciaPorData(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`, c.dia_fechamento, c.dia_vencimento)?.competencia,
  );
  expect(siteItems.map((g) => g.id).sort()).toEqual(expectedIds.slice().sort());
  expect(waItems.map((g) => g.id).sort()).toEqual(expectedIds.slice().sort());
  expect(siteSummary.total).toBe(expectedTotal);
  expect(waSummary.total).toBe(siteSummary.total);
  expect(waSummary.qtd).toBe(siteSummary.qtd);
  expect(waItems.reduce((sum, item) => sum + item.valor, 0)).toBe(expectedTotal);
  expect(waSummary.limite).toBe(siteSummary.limite);
  expect(waSummary.total).toBe(expectedTotal); // limite utilizado
  expect(waSummary.disponivel).toBe(siteSummary.disponivel);
}

beforeEach(() => {
  store.setActiveUserId(null);
});

describe("paridade da fatura do site e do WhatsApp", () => {
  it("inclui invoice_month legado fora da janela e deduplica as três buscas pelo id", async () => {
    const c = card(1, 10);
    await loadFixture(c, [
      // 02/10 está na janela, no mês legado e na competência: três buscas, um ID.
      expense("three-sources", "2026-10-02", 50, {
        invoice_month: "2026-10",
        fatura_competencia: "2026-11",
      }),
      // Compra antiga movida manualmente para o ciclo de outubro.
      expense("legacy-outside", "2026-09-25", 25, { invoice_month: "2026-10" }),
      expense("new-outside", "2026-09-26", 30, { fatura_competencia: "2026-11" }),
      expense("next-invoice", "2026-10-03", 90, { fatura_competencia: "2026-12" }),
      expense("cash", "2026-10-03", 10, { cartao_id: null, forma_pagamento: "dinheiro" }),
      expense("unconfirmed", "2026-10-03", 10, { confirmado: false }),
      expense("other-owner", "2026-10-03", 500, { user_id: "u2" }),
    ]);
    await expectParity(c, new Date(2026, 9, 2, 12), ["three-sources", "legacy-outside", "new-outside"], 105);
    const byMonth = await fatura.getFaturaPorMes("u1", c, "2026-10");
    expect(byMonth?.total).toBe(105);
    expect(byMonth?.qtd).toBe(3);
  });

  it("dia 1 e virada de mês: antes do fechamento fica na fatura anterior; depois, na próxima", async () => {
    const c = card(1, 10);
    await loadFixture(c, [
      expense("before", "2026-10-01", 40),
      expense("after", "2026-10-02", 60),
      expense("month-turn", "2026-11-01", 20),
    ]);
    expect(competenciaPorData("2026-10-01", 1, 10)?.competencia).toBe("2026-10");
    expect(competenciaPorData("2026-10-02", 1, 10)?.competencia).toBe("2026-11");
    expect(competenciaPorData("2026-11-01", 1, 10)?.competencia).toBe("2026-11");
    await expectParity(c, new Date(2026, 9, 1, 12), ["before"], 40);
    await expectParity(c, new Date(2026, 9, 2, 12), ["after", "month-turn"], 80);
  });

  it("fechamento dia 25 e vencimento dia 5 atravessam o mês corretamente", async () => {
    const c = card(25, 5);
    await loadFixture(c, [
      expense("before", "2026-10-25", 40),
      expense("after", "2026-10-26", 60),
      expense("month-turn", "2026-11-01", 20),
    ]);
    expect(competenciaPorData("2026-10-25", 25, 5)?.competencia).toBe("2026-11");
    expect(competenciaPorData("2026-10-26", 25, 5)?.competencia).toBe("2026-12");
    expect(competenciaPorData("2026-11-01", 25, 5)?.competencia).toBe("2026-12");
    await expectParity(c, new Date(2026, 9, 25, 12), ["before"], 40);
    await expectParity(c, new Date(2026, 9, 26, 12), ["after", "month-turn"], 80);
  });

  for (const source of ["date", "invoice_month", "fatura_competencia"] as const) {
    it(`falha de leitura em ${source} não vira fatura zero ou lista vazia`, async () => {
      const c = card(1, 10);
      await loadFixture(c, [expense("purchase", "2026-10-02", 50)]);
      state.gastosSelectError = source;
      const now = new Date(2026, 9, 2, 12);
      await expect(fatura.getFaturaAtualPorCartao("u1", c, now)).rejects.toThrow(
        "Não foi possível consultar os gastos da fatura.",
      );
      await expect(fatura.getItensFaturaAtualPorCartao("u1", c, now)).rejects.toThrow(
        "Não foi possível consultar os gastos da fatura.",
      );
      await expect(fatura.getFaturaPorMes("u1", c, "2026-10")).rejects.toThrow(
        "Não foi possível consultar os gastos da fatura.",
      );
    });
  }
});
