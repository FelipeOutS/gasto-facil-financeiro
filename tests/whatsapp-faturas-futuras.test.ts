/**
 * WA-F4 — Próximas faturas, parcelas futuras e saldo de compras parceladas.
 *
 * Nenhum teste toca Supabase, Meta, Graph, OCR ou transcrição reais.
 * Toda a infra é fake (`_whatsapp-fake.ts`).
 */
import { describe, it, expect, beforeEach } from "bun:test";
import "./_whatsapp-fake";
import { resetState, state, gastosInserts } from "./_whatsapp-fake";

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const {
  detectFutureFaturaIntent,
  resolveTargetInvoiceMonth,
  isBeyondHorizon,
  handleFutureFaturaIntent,
} = await import("../src/server/whatsapp-faturas.server");
const {
  getFaturaPorMes,
  getResumoFaturasPorMes,
  getComprasParceladasEmAberto,
  getDetalheCompraParcelada,
  findCompraParceladaByTerm,
} = await import("../src/server/cartao-fatura.server");

function msg(texto: string, externalId = "e-1") {
  return {
    external_id: externalId,
    telefone: "5511999998888",
    texto,
    recebida_em: new Date().toISOString(),
    authorizedUserId: "u1",
  };
}

const cartaoNubank = {
  id: "c-nu",
  nome: "Nubank",
  banco: "Nubank",
  limite_total: 0,
  dia_fechamento: 1,
  dia_vencimento: 10,
  cor: "#000",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};
const cartaoInter = {
  id: "c-int",
  nome: "Inter",
  banco: "Inter",
  limite_total: 0,
  dia_fechamento: 1,
  dia_vencimento: 15,
  cor: "#000",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// Hoje fictício para tornar mês determinístico.
const HOJE = new Date(2026, 5, 15); // 15/jun/2026

function gastoCredito(args: {
  cartaoId: string;
  invoiceMonth: string;
  valor: number;
  user_id?: string;
  parcela?: { atual: number; total: number; grupo: string; desc: string };
}) {
  return {
    id: `g-${Math.random().toString(36).slice(2, 9)}`,
    user_id: args.user_id ?? "u1",
    cartao_id: args.cartaoId,
    categoria_id: "cat-out",
    descricao: args.parcela?.desc ?? "Compra",
    estabelecimento: args.parcela?.desc ?? "Compra",
    valor: args.valor,
    data: `${args.invoiceMonth}-15`,
    mes: Number(args.invoiceMonth.split("-")[1]),
    ano: Number(args.invoiceMonth.split("-")[0]),
    invoice_month: args.invoiceMonth,
    forma_pagamento: "credito",
    tipo_gasto: args.parcela ? "parcelado" : "credito",
    parcela_atual: args.parcela?.atual ?? null,
    total_parcelas: args.parcela?.total ?? null,
    grupo_parcelamento_id: args.parcela?.grupo ?? null,
    origem: "whatsapp",
    confirmado: true,
  };
}

describe("WA-F4 — resolveTargetInvoiceMonth", () => {
  it("mês futuro do mesmo ano", () => {
    const r = resolveTargetInvoiceMonth("fatura de agosto", HOJE);
    expect(r?.ym).toBe("2026-08");
  });
  it("mês passado vira próximo ano", () => {
    const r = resolveTargetInvoiceMonth("fatura de janeiro", HOJE);
    expect(r?.ym).toBe("2027-01");
  });
  it("respeita ano explícito", () => {
    const r = resolveTargetInvoiceMonth("fatura de marco de 2027", HOJE);
    expect(r?.ym).toBe("2027-03");
  });
  it("bloqueia além de 12 meses", () => {
    const r = resolveTargetInvoiceMonth("fatura de janeiro de 2028", HOJE);
    expect(r).toBeNull();
    expect(isBeyondHorizon("fatura de janeiro de 2028", HOJE)).toBe(true);
  });
});

describe("WA-F4 — detectFutureFaturaIntent", () => {
  it('"próxima fatura" → future_invoice_total', () => {
    const out = detectFutureFaturaIntent("quanto vai dar minha próxima fatura?", HOJE);
    expect(out?.kind).toBe("future_invoice_total");
  });
  it('"fatura do mês que vem"', () => {
    const out = detectFutureFaturaIntent("quanto vai dar minha fatura do mês que vem?", HOJE);
    expect(out?.kind).toBe("future_invoice_total");
  });
  it('"próxima fatura do Nubank"', () => {
    const out = detectFutureFaturaIntent("próxima fatura do Nubank", HOJE);
    expect(out?.kind).toBe("future_invoice_card");
    if (out?.kind === "future_invoice_card") expect(out.termo).toBe("nubank");
  });
  it('"fatura de agosto" sem cartão', () => {
    const out = detectFutureFaturaIntent("fatura de agosto", HOJE);
    expect(out?.kind).toBe("future_invoice_total");
    if (out?.kind === "future_invoice_total") expect(out.invoiceMonth).toBe("2026-08");
  });
  it('"quanto vou pagar no Nubank em julho"', () => {
    const out = detectFutureFaturaIntent("quanto vou pagar no Nubank em julho?", HOJE);
    expect(out?.kind).toBe("future_invoice_card");
  });
  it('"minhas compras parceladas"', () => {
    const out = detectFutureFaturaIntent("minhas compras parceladas", HOJE);
    expect(out?.kind).toBe("installment_list");
  });
  it('"quais parcelas ainda faltam"', () => {
    const out = detectFutureFaturaIntent("quais parcelas ainda faltam?", HOJE);
    expect(out?.kind).toBe("installment_list");
  });
  it('"quanto falta pagar do tenis"', () => {
    const out = detectFutureFaturaIntent("quanto falta pagar do tênis?", HOJE);
    expect(out?.kind).toBe("installment_detail");
    if (out?.kind === "installment_detail") expect(out.termo).toBe("tenis");
  });
  it("não interpreta mensagem neutra como fatura", () => {
    expect(detectFutureFaturaIntent("Uber 29,90", HOJE)).toBeNull();
    expect(detectFutureFaturaIntent("oi", HOJE)).toBeNull();
  });
});

describe("WA-F4 — helpers financeiros", () => {
  beforeEach(() =>
    resetState({
      cartoes: [cartaoNubank, cartaoInter],
      gastos: [
        // Nubank agosto: 200 + parcela 100
        gastoCredito({ cartaoId: "c-nu", invoiceMonth: "2026-08", valor: 200 }),
        gastoCredito({
          cartaoId: "c-nu",
          invoiceMonth: "2026-08",
          valor: 100,
          parcela: { atual: 2, total: 3, grupo: "grp-tenis", desc: "Tênis" },
        }),
        gastoCredito({
          cartaoId: "c-nu",
          invoiceMonth: "2026-09",
          valor: 100,
          parcela: { atual: 3, total: 3, grupo: "grp-tenis", desc: "Tênis" },
        }),
        gastoCredito({
          cartaoId: "c-nu",
          invoiceMonth: "2026-06",
          valor: 100,
          parcela: { atual: 1, total: 3, grupo: "grp-tenis", desc: "Tênis" },
        }),
        // Inter agosto: 50
        gastoCredito({ cartaoId: "c-int", invoiceMonth: "2026-08", valor: 50 }),
        // Pix / débito devem ser ignorados em fatura
        {
          id: "g-pix",
          user_id: "u1",
          cartao_id: "c-nu",
          invoice_month: "2026-08",
          valor: 999,
          data: "2026-08-10",
          forma_pagamento: "pix",
          confirmado: true,
        },
        {
          id: "g-deb",
          user_id: "u1",
          cartao_id: "c-nu",
          invoice_month: "2026-08",
          valor: 999,
          data: "2026-08-10",
          forma_pagamento: "debito",
          confirmado: true,
        },
        // Outro usuário não deve vazar.
        gastoCredito({
          cartaoId: "c-nu",
          invoiceMonth: "2026-08",
          valor: 5000,
          user_id: "u-other",
        }),
      ],
    }),
  );

  it("getFaturaPorMes filtra crédito, mês e usuário", async () => {
    const f = await getFaturaPorMes("u1", cartaoNubank, "2026-08");
    expect(f?.total).toBe(300); // 200 + parcela 100, sem pix/débito/outro user
  });

  it("getResumoFaturasPorMes soma cartões com lançamento", async () => {
    const rs = await getResumoFaturasPorMes("u1", "2026-08");
    const total = rs.reduce((s, r) => s + r.total, 0);
    expect(total).toBe(350); // 300 nubank + 50 inter
  });

  it("getComprasParceladasEmAberto retorna grupo Tênis (não concluído)", async () => {
    const compras = await getComprasParceladasEmAberto("u1", HOJE);
    expect(compras.length).toBe(1);
    expect(compras[0].grupoId).toBe("grp-tenis");
    // ciclo atual = 2026-06 (dia 15, fechamento 1 → mês atual). Restantes: 2 (ago + set)
    expect(compras[0].parcelasRestantes.length).toBe(2);
    expect(compras[0].saldoRestante).toBe(200);
  });

  it("compra parcelada totalmente concluída NÃO aparece", async () => {
    resetState({
      cartoes: [cartaoNubank],
      gastos: [
        gastoCredito({
          cartaoId: "c-nu",
          invoiceMonth: "2026-01",
          valor: 100,
          parcela: { atual: 1, total: 2, grupo: "grp-old", desc: "Antigo" },
        }),
        gastoCredito({
          cartaoId: "c-nu",
          invoiceMonth: "2026-02",
          valor: 100,
          parcela: { atual: 2, total: 2, grupo: "grp-old", desc: "Antigo" },
        }),
      ],
    });
    const compras = await getComprasParceladasEmAberto("u1", HOJE);
    expect(compras.length).toBe(0);
  });

  it("getDetalheCompraParcelada por grupo retorna saldo correto", async () => {
    const d = await getDetalheCompraParcelada("u1", "grp-tenis", HOJE);
    expect(d?.totalCompra).toBe(300);
    expect(d?.saldoRestante).toBe(200);
    expect(d?.proximaParcela?.invoiceMonth).toBe("2026-08");
  });

  it("findCompraParceladaByTerm encontra por nome (case/acento insensível)", async () => {
    const m = await findCompraParceladaByTerm("u1", "tenis", HOJE);
    expect(m.length).toBe(1);
    expect(m[0].grupoId).toBe("grp-tenis");
  });

  it("nunca vaza dados de outro usuário", async () => {
    const f = await getFaturaPorMes("u-other", cartaoNubank, "2026-08");
    // outro usuário não tem o cartão c-nu na sua lista; passamos o cartão
    // explicitamente, mas a query é estritamente filtrada por user_id.
    expect(f?.total).toBe(5000); // só a linha desse outro user
    const compras = await getComprasParceladasEmAberto("u-other", HOJE);
    expect(compras.length).toBe(0);
  });
});

describe("WA-F4 — handleFutureFaturaIntent (consolidado e por cartão)", () => {
  beforeEach(() =>
    resetState({
      cartoes: [cartaoNubank, cartaoInter],
      gastos: [
        gastoCredito({ cartaoId: "c-nu", invoiceMonth: "2026-08", valor: 520 }),
        gastoCredito({ cartaoId: "c-int", invoiceMonth: "2026-08", valor: 320.5 }),
      ],
    }),
  );

  it("consolida próxima fatura somando cartões", async () => {
    const r = await handleFutureFaturaIntent(
      "u1",
      { kind: "future_invoice_total", invoiceMonth: "2026-08" },
      HOJE,
    );
    expect(r.status).toBe("answered");
    expect(r.resposta).toContain("Nubank");
    expect(r.resposta).toContain("Inter");
    expect(r.resposta.toLowerCase()).toContain("agosto");
  });

  it("por cartão (Nubank) mostra apenas o cartão pedido", async () => {
    const r = await handleFutureFaturaIntent(
      "u1",
      { kind: "future_invoice_card", termo: "nubank", invoiceMonth: "2026-08" },
      HOJE,
    );
    expect(r.status).toBe("answered");
    expect(r.resposta).toContain("Nubank");
    expect(r.resposta).not.toContain("Inter");
  });

  it("cartão inexistente → card_not_found", async () => {
    const r = await handleFutureFaturaIntent(
      "u1",
      { kind: "future_invoice_card", termo: "santander", invoiceMonth: "2026-08" },
      HOJE,
    );
    expect(r.status).toBe("card_not_found");
  });

  it("sem dados → no_future_data", async () => {
    resetState({ cartoes: [cartaoNubank], gastos: [] });
    const r = await handleFutureFaturaIntent(
      "u1",
      { kind: "future_invoice_total", invoiceMonth: "2026-08" },
      HOJE,
    );
    expect(r.status).toBe("no_future_data");
  });
});

describe("WA-F4 — lista de parceladas, paginação e detalhe ambíguo", () => {
  beforeEach(() => {
    // 6 grupos abertos para forçar paginação (5 por página).
    const gastos: Record<string, unknown>[] = [];
    for (let i = 1; i <= 6; i++) {
      gastos.push(
        gastoCredito({
          cartaoId: "c-nu",
          invoiceMonth: "2026-08",
          valor: 100,
          parcela: { atual: 1, total: 2, grupo: `grp-${i}`, desc: `Compra ${i}` },
        }),
        gastoCredito({
          cartaoId: "c-nu",
          invoiceMonth: "2026-09",
          valor: 100,
          parcela: { atual: 2, total: 2, grupo: `grp-${i}`, desc: `Compra ${i}` },
        }),
      );
    }
    resetState({ cartoes: [cartaoNubank], gastos });
  });

  it("lista mostra no máximo 5 grupos e expõe 'ver mais'", async () => {
    const r = await handleFutureFaturaIntent("u1", { kind: "installment_list" }, HOJE);
    expect(r.status).toBe("answered");
    expect(r.resposta).toContain("6 compras parceladas em aberto");
    expect(r.resposta).toContain("ver mais");
    expect("nextSession" in r).toBe(true);
  });

  it("detalhe ambíguo cria sessão com IDs dos grupos", async () => {
    // duas compras "Curso A" e "Curso B" → busca por "curso"
    resetState({
      cartoes: [cartaoNubank],
      gastos: [
        gastoCredito({
          cartaoId: "c-nu",
          invoiceMonth: "2026-08",
          valor: 100,
          parcela: { atual: 1, total: 2, grupo: "g-a", desc: "Curso A" },
        }),
        gastoCredito({
          cartaoId: "c-nu",
          invoiceMonth: "2026-09",
          valor: 100,
          parcela: { atual: 2, total: 2, grupo: "g-a", desc: "Curso A" },
        }),
        gastoCredito({
          cartaoId: "c-nu",
          invoiceMonth: "2026-08",
          valor: 200,
          parcela: { atual: 1, total: 2, grupo: "g-b", desc: "Curso B" },
        }),
        gastoCredito({
          cartaoId: "c-nu",
          invoiceMonth: "2026-09",
          valor: 200,
          parcela: { atual: 2, total: 2, grupo: "g-b", desc: "Curso B" },
        }),
      ],
    });
    const r = await handleFutureFaturaIntent(
      "u1",
      { kind: "installment_detail", termo: "curso" },
      HOJE,
    );
    expect(r.status).toBe("ambiguous_installment");
    expect("nextSession" in r).toBe(true);
  });
});

describe("WA-F4 — pipeline (não cria/altera/exclui nada)", () => {
  beforeEach(() => {
    resetState({
      cartoes: [cartaoNubank],
      gastos: [
        gastoCredito({
          cartaoId: "c-nu",
          invoiceMonth: "2026-08",
          valor: 100,
          parcela: { atual: 2, total: 3, grupo: "grp-tenis", desc: "Tênis" },
        }),
      ],
    });
  });

  it("'minhas compras parceladas' não cria gasto/cartão/categoria", async () => {
    const before = state.inserts.filter((i) => i.table !== "whatsapp_messages").length;
    await processarMensagemWhatsApp(msg("minhas compras parceladas"));
    const after = state.inserts.filter((i) => i.table !== "whatsapp_messages").length;
    expect(after).toBe(before);
    expect(gastosInserts().length).toBe(0);
  });

  it("'fatura de agosto' não cria gasto", async () => {
    await processarMensagemWhatsApp(msg("fatura de agosto"));
    expect(gastosInserts().length).toBe(0);
  });

  it("mês acima do horizonte → mensagem segura, sem criar dados", async () => {
    const out = await processarMensagemWhatsApp(msg("fatura de agosto de 2028"));
    expect(out.resposta).toContain("12 meses");
    expect(gastosInserts().length).toBe(0);
  });
});
