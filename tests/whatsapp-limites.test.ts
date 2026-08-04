/**
 * WA-F5 — Testes de consulta de LIMITE, UTILIZAÇÃO e VALOR COMPROMETIDO
 * de cartões via WhatsApp.
 *
 * Cobre: detector puro `detectLimiteIntent`, helper compartilhado
 * `cartao-limite.server`, handler `handleLimiteIntent`, integração no
 * pipeline (preserva sessão de gasto pendente, não cria gasto/cartão),
 * privacidade (regras de filtro de cartão), regras de não-dupla-contagem
 * (parcelas no ciclo atual / próximo não somam de novo no comprometimento
 * pós-próximo ciclo), exibição transparente de disponibilidade e logs
 * seguros.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { state, resetState } from "./_whatsapp-fake";

const { detectLimiteIntent, handleLimiteIntent } =
  await import("../src/server/whatsapp-limites.server");
const { getResumoLimiteCartao, getResumoLimitesUsuario, getComprometimentoFuturoCartao } =
  await import("../src/server/cartao-limite.server");
const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { faturaCorrenteRef, nowInAppTz } = await import("../src/server/cartao-fatura.server");

const NBSP = "\u00a0";
const BRL = (s: string) => s.replace(/R\$ /g, `R$${NBSP}`);

function isoToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nextInvoiceYm(): string {
  const hoje = nowInAppTz();
  const { mes, ano } = faturaCorrenteRef(1, hoje);
  const nm = mes === 12 ? 1 : mes + 1;
  const ny = mes === 12 ? ano + 1 : ano;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

function ymPlus(months: number): string {
  const hoje = nowInAppTz();
  const { mes, ano } = faturaCorrenteRef(1, hoje);
  let m0 = mes - 1 + months;
  let y = ano;
  while (m0 < 0) {
    m0 += 12;
    y -= 1;
  }
  while (m0 > 11) {
    m0 -= 12;
    y += 1;
  }
  return `${y}-${String(m0 + 1).padStart(2, "0")}`;
}

const baseCartoes = (extras: Record<string, unknown>[] = []) => [
  {
    id: "c-nu",
    user_id: "u1",
    nome: "Nubank",
    banco: "Nubank",
    limite_total: 3000,
    dia_fechamento: 1,
    dia_vencimento: 10,
    cor: "#000",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  ...extras,
];

describe("detectLimiteIntent (puro)", () => {
  it("reconhece consulta consolidada", () => {
    expect(detectLimiteIntent("qual meu limite?")?.kind).toBe("limit_total");
    expect(detectLimiteIntent("quanto tenho de limite nos cartões?")?.kind).toBe("limit_total");
    expect(detectLimiteIntent("quanto ainda tenho disponível?")?.kind).toBe("limit_total");
  });
  it("reconhece consulta de cartão específico", () => {
    const a = detectLimiteIntent("limite do Nubank");
    expect(a?.kind).toBe("limit_card");
    const b = detectLimiteIntent("quanto já usei do Inter?");
    expect(b?.kind).toBe("limit_card");
    const c = detectLimiteIntent("quanto tenho disponível no cartão Caixa");
    expect(c?.kind).toBe("limit_card");
  });
  it("reconhece ranking", () => {
    expect(detectLimiteIntent("qual cartão tem menos limite?")?.kind).toBe("limit_lowest");
    expect(detectLimiteIntent("qual cartão está mais comprometido?")?.kind).toBe("commitment");
    expect(detectLimiteIntent("qual cartão tem mais limite disponível?")?.kind).toBe(
      "limit_highest",
    );
  });
  it("reconhece comprometimento", () => {
    expect(detectLimiteIntent("quanto está comprometido no cartão?")?.kind).toBe("commitment");
    expect(detectLimiteIntent("quanto tenho em parcelas futuras?")?.kind).toBe("commitment");
  });
  it("ignora frases neutras / fatura", () => {
    expect(detectLimiteIntent("Uber 29,90")).toBeNull();
    expect(detectLimiteIntent("comprei pão")).toBeNull();
    expect(detectLimiteIntent("fatura")).toBeNull();
  });
});

describe("getResumoLimiteCartao — regras financeiras", () => {
  beforeEach(() => {
    resetState({ cartoes: baseCartoes() });
  });

  it("cartão com fatura atual: disponível = limite - fatura", async () => {
    state.gastosData = [
      {
        user_id: "u1",
        cartao_id: "c-nu",
        valor: 820,
        data: isoToday(),
        forma_pagamento: "credito",
        confirmado: true,
        invoice_month: null,
      },
    ];
    const r = await getResumoLimiteCartao("u1", state.cartoesData[0] as never);
    expect(r.faturaAtual).toBe(820);
    expect(r.proximaFaturaEstimada).toBe(0);
    expect(r.parcelasFuturasAposProximo).toBe(0);
    expect(r.disponivelEstimado).toBe(2180);
    expect(r.hasLimite).toBe(true);
  });

  it("sem limite cadastrado: disponivelEstimado é null", async () => {
    state.cartoesData = [
      {
        id: "c-nu",
        user_id: "u1",
        nome: "Nubank",
        banco: "Nubank",
        limite_total: 0,
        dia_fechamento: 1,
        dia_vencimento: 10,
      },
    ];
    const r = await getResumoLimiteCartao("u1", state.cartoesData[0] as never);
    expect(r.hasLimite).toBe(false);
    expect(r.disponivelEstimado).toBeNull();
  });

  it("parcelas no ciclo atual NÃO entram em parcelasFuturasAposProximo", async () => {
    const proxYm = nextInvoiceYm();
    const ymAtual = ymPlus(0);
    state.gastosData = [
      {
        id: "g-1",
        user_id: "u1",
        cartao_id: "c-nu",
        valor: 100,
        data: isoToday(),
        forma_pagamento: "credito",
        confirmado: true,
        invoice_month: ymAtual,
        grupo_parcelamento_id: "grp1",
        parcela_atual: 1,
        total_parcelas: 4,
      },
      {
        id: "g-2",
        user_id: "u1",
        cartao_id: "c-nu",
        valor: 100,
        data: isoToday(),
        forma_pagamento: "credito",
        confirmado: true,
        invoice_month: proxYm,
        grupo_parcelamento_id: "grp1",
        parcela_atual: 2,
        total_parcelas: 4,
      },
      {
        id: "g-3",
        user_id: "u1",
        cartao_id: "c-nu",
        valor: 100,
        data: isoToday(),
        forma_pagamento: "credito",
        confirmado: true,
        invoice_month: ymPlus(2),
        grupo_parcelamento_id: "grp1",
        parcela_atual: 3,
        total_parcelas: 4,
      },
      {
        id: "g-4",
        user_id: "u1",
        cartao_id: "c-nu",
        valor: 100,
        data: isoToday(),
        forma_pagamento: "credito",
        confirmado: true,
        invoice_month: ymPlus(3),
        grupo_parcelamento_id: "grp1",
        parcela_atual: 4,
        total_parcelas: 4,
      },
    ];
    const r = await getResumoLimiteCartao("u1", state.cartoesData[0] as never);
    // fatura atual inclui a parcela do ciclo atual
    expect(r.faturaAtual).toBe(100);
    expect(r.proximaFaturaEstimada).toBe(100);
    // só parcelas estritamente após o próximo ciclo
    expect(r.parcelasFuturasAposProximo).toBe(200);
    // não somou nenhuma parcela duas vezes
    expect(r.disponivelEstimado).toBe(3000 - 100 - 100 - 200);
  });

  it("Pix/débito/dinheiro não comprometem limite de crédito", async () => {
    state.gastosData = [
      {
        user_id: "u1",
        cartao_id: null,
        valor: 500,
        data: isoToday(),
        forma_pagamento: "pix",
        confirmado: true,
        invoice_month: null,
      },
      {
        user_id: "u1",
        cartao_id: null,
        valor: 200,
        data: isoToday(),
        forma_pagamento: "debito",
        confirmado: true,
        invoice_month: null,
      },
      {
        user_id: "u1",
        cartao_id: "c-nu",
        valor: 50,
        data: isoToday(),
        forma_pagamento: "debito",
        confirmado: true,
        invoice_month: null,
      },
    ];
    const r = await getResumoLimiteCartao("u1", state.cartoesData[0] as never);
    expect(r.faturaAtual).toBe(0);
    expect(r.disponivelEstimado).toBe(3000);
  });

  it("getComprometimentoFuturoCartao soma os três componentes", async () => {
    const proxYm = nextInvoiceYm();
    state.gastosData = [
      {
        user_id: "u1",
        cartao_id: "c-nu",
        valor: 820,
        data: isoToday(),
        forma_pagamento: "credito",
        confirmado: true,
        invoice_month: null,
      },
      {
        id: "p1",
        user_id: "u1",
        cartao_id: "c-nu",
        valor: 340,
        data: isoToday(),
        forma_pagamento: "credito",
        confirmado: true,
        invoice_month: proxYm,
        grupo_parcelamento_id: "g-prox",
        parcela_atual: 1,
        total_parcelas: 2,
      },
      {
        id: "p2",
        user_id: "u1",
        cartao_id: "c-nu",
        valor: 200,
        data: isoToday(),
        forma_pagamento: "credito",
        confirmado: true,
        invoice_month: ymPlus(2),
        grupo_parcelamento_id: "g-prox",
        parcela_atual: 2,
        total_parcelas: 2,
      },
    ];
    const c = await getComprometimentoFuturoCartao("u1", state.cartoesData[0] as never);
    expect(c.faturaAtual).toBe(820);
    expect(c.proximaFaturaEstimada).toBe(340);
    expect(c.parcelasFuturasAposProximo).toBe(200);
    expect(c.totalComprometido).toBe(1360);
  });
});

describe("handleLimiteIntent — usuário com um cartão", () => {
  beforeEach(() => {
    resetState({ cartoes: baseCartoes() });
    state.gastosData = [
      {
        user_id: "u1",
        cartao_id: "c-nu",
        valor: 820,
        data: isoToday(),
        forma_pagamento: "credito",
        confirmado: true,
        invoice_month: null,
      },
    ];
  });
  it("limit_total responde com resumo do único cartão", async () => {
    const out = await handleLimiteIntent("u1", { kind: "limit_total" });
    expect(out.status).toBe("answered");
    expect(out.resposta).toContain("Nubank");
    expect(out.resposta).toContain(BRL("R$ 3.000,00"));
    expect(out.resposta).toContain(BRL("R$ 820,00"));
    expect(out.resposta).toContain("Limite disponível estimado");
  });
  it("limit_card encontra por termo", async () => {
    const out = await handleLimiteIntent("u1", { kind: "limit_card", termo: "nubank" });
    expect(out.status).toBe("answered");
    expect(out.resposta).toContain("Nubank");
  });
  it("cartão sem limite cadastrado responde de forma transparente", async () => {
    state.cartoesData = [
      {
        id: "c-nu",
        user_id: "u1",
        nome: "Nubank",
        banco: "Nubank",
        limite_total: 0,
        dia_fechamento: 1,
        dia_vencimento: 10,
      },
    ];
    const out = await handleLimiteIntent("u1", { kind: "limit_total" });
    expect(out.status).toBe("answered");
    expect(out.resposta).toContain("não informado");
    expect(out.resposta).not.toContain("Limite disponível estimado");
    expect(out.resposta).toContain("não tem limite cadastrado");
  });
});

describe("handleLimiteIntent — usuário com vários cartões", () => {
  beforeEach(() => {
    resetState({
      cartoes: baseCartoes([
        {
          id: "c-it",
          user_id: "u1",
          nome: "Inter",
          banco: "Inter",
          limite_total: 2000,
          dia_fechamento: 1,
          dia_vencimento: 10,
        },
      ]),
    });
    state.gastosData = [
      {
        user_id: "u1",
        cartao_id: "c-nu",
        valor: 500,
        data: isoToday(),
        forma_pagamento: "credito",
        confirmado: true,
        invoice_month: null,
      },
      {
        user_id: "u1",
        cartao_id: "c-it",
        valor: 1500,
        data: isoToday(),
        forma_pagamento: "credito",
        confirmado: true,
        invoice_month: null,
      },
    ];
  });
  it("limit_total: lista cartões + limite total cadastrado", async () => {
    const out = await handleLimiteIntent("u1", { kind: "limit_total" });
    expect(out.status).toBe("answered");
    expect(out.resposta).toContain("Nubank");
    expect(out.resposta).toContain("Inter");
    expect(out.resposta).toContain(BRL("R$ 5.000,00"));
  });
  it("limit_lowest: cartão com menor disponibilidade", async () => {
    const out = await handleLimiteIntent("u1", { kind: "limit_lowest" });
    expect(out.status).toBe("answered");
    expect(out.resposta).toContain("Inter");
    expect(out.resposta).toContain("menor");
  });
  it("limit_highest: cartão com maior disponibilidade", async () => {
    const out = await handleLimiteIntent("u1", { kind: "limit_highest" });
    expect(out.status).toBe("answered");
    expect(out.resposta).toContain("Nubank");
    expect(out.resposta).toContain("maior");
  });
  it("commitment sem cartão específico pede desambiguação curta", async () => {
    const out = await handleLimiteIntent("u1", { kind: "commitment", termo: null });
    expect(out.status).toBe("ambiguous_card");
    expect(out.resposta).toContain("Nubank");
    expect(out.resposta).toContain("Inter");
    // não vaza limite, fatura ou bandeira antes da escolha
    expect(out.resposta).not.toContain("R$");
  });
  it("ranking sem disponibilidade confiável usa fallback transparente", async () => {
    state.cartoesData = [
      {
        id: "c-nu",
        user_id: "u1",
        nome: "Nubank",
        limite_total: 0,
        dia_fechamento: 1,
        dia_vencimento: 10,
      },
      {
        id: "c-it",
        user_id: "u1",
        nome: "Inter",
        limite_total: 0,
        dia_fechamento: 1,
        dia_vencimento: 10,
      },
    ];
    const out = await handleLimiteIntent("u1", { kind: "limit_lowest" });
    expect(out.status).toBe("availability_not_reliable");
    expect(out.resposta).toContain("Inter");
    expect(out.resposta).toContain("preciso ter o limite cadastrado");
  });
});

describe("handleLimiteIntent — cartão não encontrado / ambíguo", () => {
  beforeEach(() => {
    resetState({
      cartoes: [
        {
          id: "c-nu",
          user_id: "u1",
          nome: "Nubank",
          limite_total: 3000,
          dia_fechamento: 1,
          dia_vencimento: 10,
        },
        {
          id: "c-nu2",
          user_id: "u1",
          nome: "Nubank Ouro",
          limite_total: 5000,
          dia_fechamento: 1,
          dia_vencimento: 10,
        },
      ],
    });
  });
  it("nome inexistente → card_not_found", async () => {
    const out = await handleLimiteIntent("u1", { kind: "limit_card", termo: "Bradesco" });
    expect(out.status).toBe("card_not_found");
    expect(out.resposta).toContain("Bradesco");
  });
  it("nome ambíguo → ambiguous_card sem vazar limite/fatura", async () => {
    const out = await handleLimiteIntent("u1", { kind: "limit_card", termo: "nubank" });
    expect(out.status).toBe("ambiguous_card");
    expect(out.resposta).toContain("Nubank");
    expect(out.resposta).toContain("Nubank Ouro");
    expect(out.resposta).not.toContain("R$");
    expect(out.resposta).not.toContain("3.000");
  });
});

describe("Pipeline WhatsApp — consulta de limite", () => {
  beforeEach(() => {
    resetState({ cartoes: baseCartoes() });
    state.gastosData = [
      {
        user_id: "u1",
        cartao_id: "c-nu",
        valor: 820,
        data: isoToday(),
        forma_pagamento: "credito",
        confirmado: true,
        invoice_month: null,
      },
    ];
  });
  it("responde sem criar gasto, receita, cartão, fatura ou parcela", async () => {
    const before = state.inserts.length;
    const out = await processarMensagemWhatsApp({
      telefone: "5511999998888",
      texto: "qual meu limite?",
      external_id: "ext-lim-1",
      recebida_em: new Date().toISOString(),
    });
    expect(out.status).toBe("consulta");
    expect(out.resposta).toContain(BRL("R$ 3.000,00"));
    const novos = state.inserts.slice(before);
    expect(novos.find((i) => i.table === "gastos")).toBeUndefined();
    expect(novos.find((i) => i.table === "cartoes")).toBeUndefined();
    expect(novos.find((i) => i.table === "receitas")).toBeUndefined();
    expect(state.pendingRow).toBeNull();
  });
  it("não interrompe sessão de gasto pendente", async () => {
    await processarMensagemWhatsApp({
      telefone: "5511999998888",
      texto: "Uber 29,90",
      external_id: "ext-g-1",
      recebida_em: new Date().toISOString(),
    });
    const pendingAntes = state.pendingRow;
    expect(pendingAntes).not.toBeNull();
    await processarMensagemWhatsApp({
      telefone: "5511999998888",
      texto: "qual meu limite?",
      external_id: "ext-lim-2",
      recebida_em: new Date().toISOString(),
    });
    expect(state.pendingRow).not.toBeNull();
    expect(state.pendingRow?.status).toBe(pendingAntes?.status);
  });
});

describe("Log seguro de wa_card_limit_query", () => {
  it("não contém valor, nome de cartão, userId, telefone, limite ou texto", async () => {
    resetState({ cartoes: baseCartoes() });
    state.gastosData = [
      {
        user_id: "u1",
        cartao_id: "c-nu",
        valor: 777,
        data: isoToday(),
        forma_pagamento: "credito",
        confirmado: true,
        invoice_month: null,
      },
    ];
    const events: unknown[] = [];
    const origInfo = console.info;
    console.info = (...args: unknown[]) => {
      events.push(args[0]);
      return origInfo(...args);
    };
    try {
      await handleLimiteIntent("u1", { kind: "limit_total" });
    } finally {
      console.info = origInfo;
    }
    const ev = events.find(
      (e): e is Record<string, unknown> =>
        typeof e === "object" &&
        e !== null &&
        (e as Record<string, unknown>).event === "wa_card_limit_query",
    );
    expect(ev).toBeDefined();
    const serialized = JSON.stringify(ev);
    expect(serialized).not.toContain("777");
    expect(serialized).not.toContain("3000");
    expect(serialized).not.toContain("Nubank");
    expect(serialized).not.toContain("u1");
    expect(serialized).not.toContain("5511");
    expect(serialized).not.toContain("limite?");
  });
});

describe("getResumoLimitesUsuario", () => {
  it("retorna lista vazia quando o usuário não tem cartões", async () => {
    resetState({ cartoes: [] });
    const r = await getResumoLimitesUsuario("u1");
    expect(r).toEqual([]);
  });
});
