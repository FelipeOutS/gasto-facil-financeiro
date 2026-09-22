import { beforeEach, expect, mock, test } from "bun:test";
let writes: any[] = [];
mock.module("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const q: any = {
        insert: (rows: any) => {
          writes.push(...(Array.isArray(rows) ? rows : [rows]));
          return q;
        },
        update: () => q,
        eq: () => q,
        like: () => q,
        in: () => q,
        select: () => q,
        single: () => q,
        then: (ok: any) => Promise.resolve({ error: null }).then(ok),
      };
      return q;
    },
  },
}));
const store = await import("../src/lib/store");
const { buildResumoMensal } = await import("../src/lib/relatorios");
const { sumValores } = await import("../src/lib/gastos-export");
const input = {
  valor: 100,
  data: "2026-01-31",
  descricao: "Compra",
  categoriaId: "outros",
  formaPagamento: "credito" as const,
  tipoGasto: "parcelado" as const,
  totalParcelas: 3,
  cartaoId: "card",
};
beforeEach(() => {
  store.setActiveUserId(null);
  store.setActiveUserId("owner");
  store.setStoreCanWrite(true);
  input.cartaoId = store.addCartao({
    nome: "Card",
    banco: "Fixture",
    limiteTotal: 100000,
    diaFechamento: 5,
    diaVencimento: 10,
    cor: "#000000",
  })!.id;
  writes = [];
});
for (const [total, n] of [
  [100, 3],
  [10, 3],
  [1, 3],
  [0.1, 3],
  [999.99, 7],
  [1000, 12],
  [10000.01, 24],
])
  test(`store/card persists ${total}/${n} with matching client values`, () => {
    const created = store.addGasto({ ...input, valor: total, totalParcelas: n });
    expect(writes.map((r) => r.valor)).toEqual(created.map((r) => r.valor));
    expect(writes.reduce((s, r) => s + Math.round(r.valor * 100), 0)).toBe(Math.round(total * 100));
    expect(sumValores(created.map((r) => r.valor))).toBe(total);
    const summaryCents = created.reduce(
      (s, g) =>
        s +
        Math.round(
          buildResumoMensal({
            mes: g.mes,
            ano: g.ano,
            gastos: created,
            receitas: [],
            contas: [],
            movMetas: [],
            categorias: [],
          }).totalDespesas * 100,
        ),
      0,
    );
    expect(summaryCents).toBe(Math.round(total * 100));
    const invoiceCents = created.reduce(
      (s, g) => s + Math.round(store.resumoFaturaPorMes(input.cartaoId, g.mes, g.ano).total * 100),
      0,
    );
    expect(invoiceCents).toBe(Math.round(total * 100));
    const dashboardCents = created.reduce(
      (s, g) =>
        s +
        Math.round(
          store.gastosNoMesEfetivo(created, g.mes, g.ano).reduce((a, b) => a + b.valor, 0) * 100,
        ),
      0,
    );
    expect(dashboardCents).toBe(Math.round(total * 100));
  });
test("dates and group metadata are preserved", () => {
  const rows = store.addGasto(input);
  expect(rows.map((r) => r.data)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  expect(rows.map((r) => r.parcelaAtual)).toEqual([1, 2, 3]);
  expect(new Set(rows.map((r) => r.grupoParcelamentoId)).size).toBe(1);
});
test("imported individual installment is not divided again", () => {
  const created = store.addGasto({ ...input, valor: 33.33, parcelaAtual: 2, origem: "fatura" });
  expect(created.length).toBe(1);
  expect(created[0].valor).toBe(33.33);
});
test("editing one persisted installment leaves the other installments intact", () => {
  const rows = store.addGasto(input);
  store.updateGasto(rows[1].id, { valor: 35 });
  expect(store.getGastos().map((r) => r.valor)).toEqual([33.34, 35, 33.33]);
});
test("creating another schedule does not recalculate an existing one", () => {
  const previous = store.addGasto(input);
  store.addGasto({ ...input, valor: 100.01, totalParcelas: 4 });
  expect(
    store
      .getGastos()
      .filter((r) => previous.some((p) => p.id === r.id))
      .map((r) => r.valor),
  ).toEqual([33.34, 33.33, 33.33]);
});
test("recurrence repeats occurrence value, not a purchase total", () => {
  const rows = store.addGasto({ ...input, tipoGasto: "recorrente", recorrenteMeses: 3 });
  expect(rows.map((r) => r.valor)).toEqual([100, 100, 100]);
});

test("partially paid purchase retains paid invoice and other installments after an individual edit", async () => {
  const rows = store.addGasto(input);
  await store.marcarFaturaPaga(input.cartaoId, 1, 2026, { dataPagamento: "2026-02-10" });
  expect(store.getFatura(input.cartaoId, 1, 2026)?.valorPago).toBe(33.34);
  store.updateGasto(rows[1].id, { valor: 35 });
  expect(store.getFatura(input.cartaoId, 1, 2026)?.status).toBe("paga");
  expect(store.getFatura(input.cartaoId, 1, 2026)?.valorPago).toBe(33.34);
  expect(store.getGastos().map((r) => r.valor)).toEqual([33.34, 35, 33.33]);
});
test("accounts payable recurrence preserves the full amount per occurrence", () => {
  const rows = store.addContaAPagar({
    nome: "Conta",
    valor: 100,
    dataVencimento: "2026-01-31",
    recorrente: true,
    recorrenteMeses: 3,
  });
  expect(rows.map((r) => r.valor)).toEqual([100, 100, 100]);
});
