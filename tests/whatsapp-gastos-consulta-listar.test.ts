/**
 * WA-Q-Gastos — Consulta de gastos do mês NÃO pode acionar parser de
 * cartão/fatura nem fluxo de criação de gasto/receita.
 *
 * Cobre o bug observado no smoke 3.9, onde "meus gastos do mês" era
 * roteado para extractCartaoTermo e respondia "Não encontrei cartão 'mes'".
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState, useWhatsAppFakeMocks } from "./_whatsapp-fake";
useWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { detectConsultaIntent } = await import("../src/server/whatsapp-consultas.server");
const { detectFaturaIntent } = await import("../src/server/whatsapp-faturas.server");

const tel = "5511999998888";

function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function monthStart(): string {
  return todayISO().slice(0, 7) + "-01";
}

beforeEach(() => resetState());

const FRASES_CONSULTA_GASTOS = [
  "meus gastos do mês",
  "meus gastos do mes",
  "gastos do mês",
  "gastos do mes",
  "quanto gastei este mês",
  "quanto eu gastei no mes",
  "total de gastos",
  "total dos gastos",
  "minhas despesas do mês",
  "minhas despesas",
  "despesas do mes",
  "listar meus gastos",
  "ver gastos",
];

test("detectConsultaIntent classifica todas as variações como listar_gastos_mes", () => {
  for (const frase of FRASES_CONSULTA_GASTOS) {
    expect([frase, detectConsultaIntent(frase)]).toEqual([frase, "listar_gastos_mes"]);
  }
});

test("extractCartaoTermo (via detectFaturaIntent) NÃO captura 'mes' como nome de cartão", () => {
  // Mesmo que a consulta chegasse no detectFaturaIntent, o termo "mes"
  // deve ser rejeitado pelo STOP list — nunca virar busca por cartão.
  for (const frase of [
    "gastos do mes",
    "compras do mes",
    "lancamentos do mes",
    "gastos da semana",
    "gastos do dia",
  ]) {
    const r = detectFaturaIntent(frase);
    if (r && "termo" in r) {
      expect([frase, r.termo]).toEqual([frase, null]);
    }
  }
});

test("'meus gastos do mês' lista gastos e NÃO abre sessão de criação nem busca cartão", async () => {
  resetState({
    gastos: [
      {
        id: "g1",
        user_id: "u1",
        descricao: "Uber",
        valor: 29.9,
        data: todayISO(),
        categoria_id: null,
      },
      {
        id: "g2",
        user_id: "u1",
        descricao: "Mercado",
        valor: 148,
        data: monthStart(),
        categoria_id: null,
      },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "meus gastos do mês",
    external_id: "qg-1",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("Uber");
  expect(r.resposta).toContain("Mercado");
  expect(r.resposta).toContain("R$");
  expect(r.resposta).toContain("Total gasto");
  expect(r.resposta.toLowerCase()).not.toContain("cartão com o nome");
  expect(r.resposta.toLowerCase()).not.toContain("cartao com o nome");
  expect(state.pendingRow).toBeNull();
  expect(state.inserts.some((i) => i.table === "gastos")).toBe(false);
  expect(state.inserts.some((i) => i.table === "receitas")).toBe(false);
});

test("consulta sem gastos no mês devolve mensagem amigável", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "gastos do mês",
    external_id: "qg-2",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta.toLowerCase()).toContain("não encontrei");
  expect(state.pendingRow).toBeNull();
});

test("nenhuma das frases de consulta gera sessão nem busca por cartão", async () => {
  for (let i = 0; i < FRASES_CONSULTA_GASTOS.length; i++) {
    resetState();
    const r = await processarMensagemWhatsApp({
      telefone: tel,
      texto: FRASES_CONSULTA_GASTOS[i],
      external_id: `qg-loop-${i}`,
    });
    expect([FRASES_CONSULTA_GASTOS[i], r.status]).toEqual([FRASES_CONSULTA_GASTOS[i], "consulta"]);
    expect(r.resposta.toLowerCase()).not.toContain("cartão com o nome");
    expect(state.inserts.some((x) => x.table === "gastos")).toBe(false);
  }
});

test("'compras do nubank' continua sendo invoice_items (não regressão)", () => {
  const r = detectFaturaIntent("compras do nubank");
  expect(r?.kind).toBe("invoice_items");
  if (r && "termo" in r) expect(r.termo).toBe("nubank");
});
