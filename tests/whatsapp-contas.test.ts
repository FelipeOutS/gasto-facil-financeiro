/**
 * WA-C1 — Testes de CONTAS A PAGAR / VENCIMENTOS PRÓXIMOS via WhatsApp.
 *
 * Cobre: detector puro `detectDueIntent`, helpers `contas-vencimento.server`,
 * handler `handleDueIntent`, integração no pipeline (estado de paginação,
 * coexistência com sessão de gasto, não-cruzamento com fatura de cartão),
 * privacidade (ambiguidade não vaza valor/data), regras de status
 * confiável (atraso só com `status='pendente'`), logs seguros.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { state, resetState, gastosInserts, useWhatsAppFakeMocks } from "./_whatsapp-fake";
useWhatsAppFakeMocks();

const { detectDueIntent, handleDueIntent, handleDuePagination } =
  await import("../src/server/whatsapp-contas.server");
const {
  getVencimentosPorPeriodo,
  getVencimentosComStatusAnterior,
  findVencimentoByTerm,
  todayISOInAppTz,
  tomorrowISOInAppTz,
  weekRangeInAppTz,
  monthRangeInAppTz,
} = await import("../src/server/contas-vencimento.server");
const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");

const NBSP = "\u00a0";
const BRL = (s: string) => s.replace(/R\$ /g, `R$${NBSP}`);

function isoPlus(days: number): string {
  const t = new Date();
  t.setDate(t.getDate() + days);
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const TODAY = todayISOInAppTz();
const TOMORROW = tomorrowISOInAppTz();
const WEEK = weekRangeInAppTz();
const MONTH = monthRangeInAppTz();

function conta(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `cap-${Math.random().toString(36).slice(2, 8)}`,
    user_id: "u1",
    nome: "Conta",
    valor: 100,
    data_vencimento: TODAY,
    status: "pendente",
    data_pagamento: null,
    categoria_id: null,
    recorrente: false,
    frequencia_recorrencia: null,
    ...over,
  };
}

describe("detectDueIntent (puro)", () => {
  it("reconhece hoje / amanhã / semana / mês / atrasado", () => {
    expect(detectDueIntent("o que vence hoje?")?.kind).toBe("today");
    expect(detectDueIntent("tem conta para pagar hoje")?.kind).toBe("today");
    expect(detectDueIntent("o que vence amanhã?")?.kind).toBe("tomorrow");
    expect(detectDueIntent("tem alguma conta vencendo amanhã?")?.kind).toBe("tomorrow");
    expect(detectDueIntent("o que vence essa semana?")?.kind).toBe("week");
    expect(detectDueIntent("quais contas tenho até domingo?")?.kind).toBe("week");
    expect(detectDueIntent("minhas contas do mês")?.kind).toBe("month");
    expect(detectDueIntent("quanto tenho para pagar este mês?")?.kind).toBe("month");
    expect(detectDueIntent("tenho alguma conta atrasada?")?.kind).toBe("overdue");
    expect(detectDueIntent("o que venceu e eu não paguei?")?.kind).toBe("overdue");
  });
  it("reconhece mês nominal", () => {
    const r = detectDueIntent("o que vence em julho?");
    expect(r?.kind).toBe("month");
    if (r?.kind === "month") expect(r.yearMonth).toMatch(/^\d{4}-07$/);
  });
  it("reconhece busca por termo", () => {
    const r = detectDueIntent("quando vence a internet?");
    expect(r?.kind).toBe("term");
    if (r?.kind === "term") expect(r.termo).toContain("internet");
    expect(detectDueIntent("qual é o próximo vencimento da academia?")?.kind).toBe("term");
  });
  it("ignora gastos e perguntas de fatura de cartão", () => {
    expect(detectDueIntent("Uber 29,90")).toBeNull();
    expect(detectDueIntent("comprei pão")).toBeNull();
    expect(detectDueIntent("quando vence minha fatura?")).toBeNull();
    expect(detectDueIntent("fatura do Nubank")).toBeNull();
  });
});

describe("getVencimentosPorPeriodo / getVencimentosComStatusAnterior", () => {
  beforeEach(() => {
    resetState({
      contas: [
        conta({ id: "a", nome: "Internet", valor: 119.9, data_vencimento: TODAY }),
        conta({ id: "b", nome: "Academia", valor: 89.9, data_vencimento: TODAY }),
        conta({ id: "c", nome: "Aluguel", valor: 1200, data_vencimento: isoPlus(3) }),
        conta({ id: "d", nome: "Plano de saúde", valor: 970.2, data_vencimento: isoPlus(10) }),
        // PAGO — não pode aparecer
        conta({
          id: "e",
          nome: "Luz",
          valor: 200,
          data_vencimento: TODAY,
          status: "pago",
          data_pagamento: TODAY,
        }),
        // Atrasada
        conta({ id: "f", nome: "Telefone", valor: 80, data_vencimento: isoPlus(-5) }),
        // Outro user — nunca deve aparecer
        conta({ id: "g", user_id: "outro", nome: "Outro user", valor: 10, data_vencimento: TODAY }),
      ],
    });
  });
  it("hoje retorna apenas pendentes de hoje do user", async () => {
    const rows = await getVencimentosPorPeriodo("u1", TODAY, TODAY);
    expect(rows.map((r) => r.nome).sort()).toEqual(["Academia", "Internet"]);
  });
  it("semana cobre [hoje, domingo]", async () => {
    const { startISO, endISO } = WEEK;
    const rows = await getVencimentosPorPeriodo("u1", startISO, endISO);
    for (const r of rows) {
      expect(r.dataVencimento >= startISO).toBe(true);
      expect(r.dataVencimento <= endISO).toBe(true);
      expect(r.status).toBe("pendente");
    }
  });
  it("mês cobre [01..fim] do mês corrente", async () => {
    const rows = await getVencimentosPorPeriodo("u1", MONTH.startISO, MONTH.endISO);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.status).toBe("pendente");
    expect(rows.some((r) => r.nome === "Luz")).toBe(false); // pago
    expect(rows.some((r) => r.nome === "Outro user")).toBe(false);
  });
  it("atrasados: apenas pendentes anteriores a hoje", async () => {
    const rows = await getVencimentosComStatusAnterior("u1", TODAY);
    expect(rows.map((r) => r.nome)).toEqual(["Telefone"]);
  });
});

describe("findVencimentoByTerm", () => {
  beforeEach(() => {
    resetState({
      contas: [
        conta({ id: "a", nome: "Internet Vivo", valor: 119.9, data_vencimento: isoPlus(2) }),
        conta({ id: "b", nome: "Internet Vivo", valor: 119.9, data_vencimento: isoPlus(32) }),
        conta({ id: "c", nome: "Academia", valor: 89.9, data_vencimento: isoPlus(5) }),
      ],
    });
  });
  it("match único por descrição", async () => {
    const rows = await findVencimentoByTerm("u1", "internet");
    expect(rows.length).toBe(2);
    expect(rows[0].dataVencimento <= rows[1].dataVencimento).toBe(true);
  });
  it("normaliza acentos", async () => {
    state.contasData = [
      conta({ id: "x", nome: "Plano de Saúde", valor: 970, data_vencimento: isoPlus(2) }),
    ];
    const rows = await findVencimentoByTerm("u1", "saude");
    expect(rows.length).toBe(1);
  });
});

describe("handleDueIntent — respostas", () => {
  beforeEach(() => {
    resetState({
      contas: [
        conta({ id: "a", nome: "Internet", valor: 119.9, data_vencimento: TODAY }),
        conta({ id: "b", nome: "Academia", valor: 89.9, data_vencimento: TODAY }),
      ],
    });
  });
  it("today: lista com total", async () => {
    const out = await handleDueIntent("u1", { kind: "today" });
    expect(out.status).toBe("answered");
    expect(out.resposta).toContain("Internet");
    expect(out.resposta).toContain("Academia");
    expect(out.resposta).toContain(BRL("R$ 209,80"));
    expect(out.nextSession).toBeFalsy();
  });
  it("today vazio: texto claro", async () => {
    resetState({ contas: [] });
    const out = await handleDueIntent("u1", { kind: "today" });
    expect(out.status).toBe("no_due_items");
    expect(out.resposta).toContain("Não encontrei vencimentos previstos para hoje");
  });
  it("tomorrow vazio quando só há de hoje", async () => {
    const out = await handleDueIntent("u1", { kind: "tomorrow" });
    expect(out.status).toBe("no_due_items");
  });
  it("tomorrow lista apenas amanhã", async () => {
    resetState({
      contas: [
        conta({ id: "a", nome: "Internet", valor: 119.9, data_vencimento: TODAY }),
        conta({ id: "x", nome: "Aluguel", valor: 1200, data_vencimento: TOMORROW }),
      ],
    });
    const out = await handleDueIntent("u1", { kind: "tomorrow" });
    expect(out.status).toBe("answered");
    expect(out.resposta).toContain("Aluguel");
    expect(out.resposta).not.toContain("Internet");
  });
});

describe("handleDueIntent — paginação (5 itens)", () => {
  beforeEach(() => {
    const items: Record<string, unknown>[] = [];
    for (let i = 0; i < 7; i += 1) {
      items.push(
        conta({
          id: `m-${i}`,
          nome: `Conta ${String.fromCharCode(65 + i)}`,
          valor: 10 + i,
          data_vencimento: `${MONTH.yearMonth}-${String(i + 5).padStart(2, "0")}`,
        }),
      );
    }
    resetState({ contas: items });
  });
  it("primeira página tem 5 itens + nextSession", async () => {
    const out = await handleDueIntent("u1", { kind: "month", yearMonth: null });
    expect(out.status).toBe("answered");
    expect(out.resposta.split("\n").filter((l) => l.startsWith("•")).length).toBe(5);
    expect(out.resposta).toContain("ver mais");
    expect(out.nextSession?.page).toBe(1);
  });
  it("segunda página devolve restantes e sem nextSession", async () => {
    const first = await handleDueIntent("u1", { kind: "month", yearMonth: null });
    const next = await handleDuePagination("u1", first.nextSession!);
    expect(next.status).toBe("answered");
    expect(next.resposta.split("\n").filter((l) => l.startsWith("•")).length).toBe(2);
    expect(next.nextSession).toBeNull();
  });
  it("após o fim, mostra no_more_items", async () => {
    const out = await handleDuePagination("u1", {
      kind: "consulta_vencimentos",
      mode: "month",
      page: 5,
      referenceMonth: MONTH.yearMonth,
    });
    expect(out.status).toBe("no_more_items");
  });
});

describe("handleDueIntent — atrasados (status confiável)", () => {
  it("afirma atraso usando status='pendente' + data anterior", async () => {
    resetState({
      contas: [
        conta({ id: "a", nome: "Telefone", valor: 80, data_vencimento: isoPlus(-3) }),
        conta({ id: "b", nome: "Internet", valor: 119.9, data_vencimento: isoPlus(-10) }),
      ],
    });
    const out = await handleDueIntent("u1", { kind: "overdue" });
    expect(out.status).toBe("answered");
    expect(out.resposta).toMatch(/atraso/i);
    expect(out.resposta).toContain("Telefone");
    expect(out.resposta).toContain("Internet");
  });
  it("nada anterior pendente: texto seguro", async () => {
    resetState({ contas: [] });
    const out = await handleDueIntent("u1", { kind: "overdue" });
    expect(out.status).toBe("no_due_items");
    expect(out.resposta).toContain("em dia");
  });
});

describe("handleDueIntent — busca por termo", () => {
  it("match único: resposta direta", async () => {
    resetState({
      contas: [conta({ id: "a", nome: "Internet", valor: 119.9, data_vencimento: isoPlus(3) })],
    });
    const out = await handleDueIntent("u1", { kind: "term", termo: "internet" });
    expect(out.status).toBe("answered");
    expect(out.resposta).toContain("Internet");
    expect(out.resposta).toContain(BRL("R$ 119,90"));
  });
  it("descrição inexistente: card_not_found seguro", async () => {
    resetState({ contas: [] });
    const out = await handleDueIntent("u1", { kind: "term", termo: "wifi" });
    expect(out.status).toBe("no_due_items");
    expect(out.resposta).toContain("wifi");
  });
  it("ambíguo: pede escolha sem vazar valor/data", async () => {
    resetState({
      contas: [
        conta({ id: "a", nome: "Internet Vivo", valor: 119.9, data_vencimento: isoPlus(2) }),
        conta({ id: "b", nome: "Internet Claro", valor: 99.9, data_vencimento: isoPlus(8) }),
      ],
    });
    const out = await handleDueIntent("u1", { kind: "term", termo: "internet" });
    expect(out.status).toBe("ambiguous_item");
    expect(out.resposta).toContain("Internet Vivo");
    expect(out.resposta).toContain("Internet Claro");
    expect(out.resposta).not.toContain("R$");
    expect(out.resposta).not.toMatch(/\d{2}\/\d{2}/);
  });
});

describe("Pipeline WhatsApp — consulta de vencimentos", () => {
  beforeEach(() => {
    resetState({
      contas: [conta({ id: "a", nome: "Internet", valor: 119.9, data_vencimento: TODAY })],
    });
  });
  it("responde sem criar gasto/conta/receita/recorrência", async () => {
    const out = await processarMensagemWhatsApp({
      telefone: "5511999998888",
      texto: "o que vence hoje?",
      external_id: "ext-c1-1",
      recebida_em: new Date().toISOString(),
    });
    expect(out.status).toBe("consulta");
    expect(out.resposta).toContain("Internet");
    expect(gastosInserts()).toHaveLength(0);
    expect(state.inserts.find((i) => i.table === "contas_a_pagar")).toBeUndefined();
    expect(state.inserts.find((i) => i.table === "receitas")).toBeUndefined();
    expect(state.inserts.find((i) => i.table === "recorrencias")).toBeUndefined();
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
      texto: "o que vence hoje?",
      external_id: "ext-c1-2",
      recebida_em: new Date().toISOString(),
    });
    expect(state.pendingRow).not.toBeNull();
    expect(state.pendingRow?.status).toBe(pendingAntes?.status);
  });
  it("paginação: 'ver mais' avança e 'cancelar' encerra", async () => {
    const items: Record<string, unknown>[] = [];
    for (let i = 0; i < 7; i += 1) {
      items.push(
        conta({
          id: `p-${i}`,
          nome: `Conta ${i}`,
          valor: 10,
          data_vencimento: `${MONTH.yearMonth}-${String(i + 3).padStart(2, "0")}`,
        }),
      );
    }
    resetState({ contas: items });
    const r1 = await processarMensagemWhatsApp({
      telefone: "5511999998888",
      texto: "minhas contas do mês",
      external_id: "ext-p1",
      recebida_em: new Date().toISOString(),
    });
    expect(r1.status).toBe("pendente");
    expect(state.pendingRow?.status).toBe("aguardando_consulta_vencimentos");
    const r2 = await processarMensagemWhatsApp({
      telefone: "5511999998888",
      texto: "ver mais",
      external_id: "ext-p2",
      recebida_em: new Date().toISOString(),
    });
    expect(r2.status).toBe("consulta");
    expect(state.pendingRow).toBeNull();
  });
  it("não interfere com perguntas de fatura de cartão", async () => {
    const out = await processarMensagemWhatsApp({
      telefone: "5511999998888",
      texto: "quando vence minha fatura?",
      external_id: "ext-f-1",
      recebida_em: new Date().toISOString(),
    });
    // Vai para o handler de fatura (WA-F1), não para vencimentos
    expect(out.resposta).not.toContain("Internet");
  });
});

describe("Log seguro de wa_due_date_query", () => {
  it("não contém valor, descrição, data, userId, telefone ou pergunta original", async () => {
    resetState({
      contas: [conta({ id: "a", nome: "Internet", valor: 119.9, data_vencimento: TODAY })],
    });
    const events: unknown[] = [];
    const origInfo = console.info;
    console.info = (...args: unknown[]) => {
      events.push(args[0]);
      return origInfo(...args);
    };
    try {
      await handleDueIntent("u1", { kind: "today" });
    } finally {
      console.info = origInfo;
    }
    const ev = events.find(
      (e): e is Record<string, unknown> =>
        typeof e === "object" &&
        e !== null &&
        (e as Record<string, unknown>).event === "wa_due_date_query",
    );
    expect(ev).toBeDefined();
    const serialized = JSON.stringify(ev);
    expect(serialized).not.toContain("119");
    expect(serialized).not.toContain("Internet");
    expect(serialized).not.toContain("u1");
    expect(serialized).not.toContain("5511");
    expect(serialized).not.toContain(TODAY);
    expect(serialized).not.toContain("vence hoje");
  });
});
