/**
 * Fase WA-G2 — Testes do fluxo de consultas financeiras via WhatsApp.
 * Reaproveita o mock compartilhado em ./_whatsapp-fake.
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState } from "./_whatsapp-fake";

const { processarMensagemWhatsApp } = await import(
  "../src/server/whatsapp.server"
);
const { detectConsultaIntent } = await import(
  "../src/server/whatsapp-consultas.server"
);

const tel = "5511999998888";

function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function daysAgoISO(n: number): string {
  const [y, m, d] = todayISO().split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
}
function daysAheadISO(n: number): string {
  const [y, m, d] = todayISO().split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function monthStart(): string {
  return todayISO().slice(0, 7) + "-01";
}

beforeEach(() => resetState());

// ---------------------------------------------------------------------
test("detectConsultaIntent reconhece variações", () => {
  expect(detectConsultaIntent("ajuda")).toBe("ajuda_whatsapp");
  expect(detectConsultaIntent("menu")).toBe("ajuda_whatsapp");
  expect(detectConsultaIntent("O que você faz?")).toBe("ajuda_whatsapp");
  expect(detectConsultaIntent("como você pode me ajudar")).toBe("ajuda_whatsapp");

  expect(detectConsultaIntent("resumo da semana")).toBe("resumo_semana");
  expect(detectConsultaIntent("como foi minha semana?")).toBe("resumo_semana");
  expect(detectConsultaIntent("quanto gastei essa semana")).toBe("resumo_semana");

  expect(detectConsultaIntent("resumo do mês")).toBe("resumo_mes");
  expect(detectConsultaIntent("como foi meu mês")).toBe("resumo_mes");
  expect(detectConsultaIntent("como estão minhas finanças")).toBe("resumo_mes");

  expect(detectConsultaIntent("meus maiores gastos")).toBe("maiores_gastos_semana");
  expect(detectConsultaIntent("maiores gastos do mês")).toBe("maiores_gastos_mes");
  expect(detectConsultaIntent("onde estou gastando mais")).toBe("maiores_gastos_semana");

  expect(detectConsultaIntent("quanto meus gastos afetam minha renda")).toBe(
    "impacto_despesas_renda",
  );
  expect(detectConsultaIntent("qual porcentagem da minha renda eu gastei")).toBe(
    "impacto_despesas_renda",
  );

  // Curtas que pertencem ao fluxo pendente — não devem ser intent
  expect(detectConsultaIntent("sim")).toBe(null);
  expect(detectConsultaIntent("não")).toBe(null);
  expect(detectConsultaIntent("pix")).toBe(null);
  expect(detectConsultaIntent("cartão")).toBe(null);
});

// ---------------------------------------------------------------------
test("ajuda/menu responde com apresentação do GI e bullets", async () => {
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "menu", external_id: "h-1" });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("GI");
  expect(r.resposta).toContain("Registrar gasto");
  expect(r.resposta).toContain("Cadastrar uma conta");
  expect(r.resposta).toContain("Ver contas pendentes");
  // Não deve criar gasto/receita
  expect(state.inserts.some((i) => i.table === "gastos")).toBe(false);
  expect(state.inserts.some((i) => i.table === "receitas")).toBe(false);
});

// ---------------------------------------------------------------------
test("resumo da semana com receitas e despesas + maior grupo", async () => {
  resetState({
    gastos: [
      { descricao: "Mercado X", valor: 100, data: daysAgoISO(2), categoria_id: "cat-mer" },
      { descricao: "Uber",      valor: 30,  data: daysAgoISO(1), categoria_id: "cat-trans" },
      { descricao: "Mercado Y", valor: 70,  data: daysAgoISO(3), categoria_id: "cat-mer" },
    ],
    receitas: [{ valor: 500, data: daysAgoISO(2) }],
  });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "resumo da semana", external_id: "rs-1" });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("Resumo dos últimos 7 dias");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 500,00");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 200,00"); // despesas
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 300,00"); // saldo
  expect(r.resposta).toContain("Mercado"); // maior grupo
});

// ---------------------------------------------------------------------
test("resumo da semana sem receitas mostra R$ 0,00", async () => {
  resetState({
    gastos: [{ descricao: "Padaria", valor: 12, data: daysAgoISO(1), categoria_id: "cat-out" }],
    receitas: [],
  });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "como foi minha semana", external_id: "rs-2" });
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("Receitas: R$ 0,00");
});

// ---------------------------------------------------------------------
test("resumo do mês com percentual válido", async () => {
  resetState({
    gastos: [{ descricao: "Mercado", valor: 250, data: monthStart(), categoria_id: "cat-mer" }],
    receitas: [{ valor: 1000, data: monthStart() }],
  });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "resumo do mês", external_id: "rm-1" });
  expect(r.resposta).toContain("Resumo de");
  expect(r.resposta).toContain("25% das suas receitas");
});

// ---------------------------------------------------------------------
test("resumo do mês sem receitas substitui linha de percentual", async () => {
  resetState({
    gastos: [{ descricao: "Mercado", valor: 250, data: monthStart(), categoria_id: "cat-mer" }],
    receitas: [],
  });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "como foi meu mês", external_id: "rm-2" });
  expect(r.resposta).toContain("Ainda não há receitas registradas suficientes");
  expect(r.resposta).not.toContain("%");
});

// ---------------------------------------------------------------------
test("maiores gastos com 3 itens lista descrição real e total", async () => {
  resetState({
    gastos: [
      { descricao: "Mercado",    valor: 200, data: daysAgoISO(1), categoria_id: "cat-mer" },
      { descricao: "Uber",       valor: 60,  data: daysAgoISO(2), categoria_id: "cat-trans" },
      { descricao: "Restaurante",valor: 120, data: daysAgoISO(3), categoria_id: "cat-rest" },
      { descricao: "Café",       valor: 10,  data: daysAgoISO(4), categoria_id: "cat-rest" },
    ],
  });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "meus maiores gastos", external_id: "mg-1" });
  expect(r.resposta).toContain("1. Mercado");
  expect(r.resposta).toContain("2. Restaurante");
  expect(r.resposta).toContain("3. Uber");
  expect(r.resposta).not.toContain("Café");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 380,00");
});

// ---------------------------------------------------------------------
test("maiores gastos com menos de 3 itens mostra apenas os existentes", async () => {
  resetState({
    gastos: [{ descricao: "Mercado", valor: 50, data: daysAgoISO(1), categoria_id: "cat-mer" }],
  });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "maiores gastos", external_id: "mg-2" });
  expect(r.resposta).toContain("1. Mercado");
  expect(r.resposta).not.toContain("2.");
});

// ---------------------------------------------------------------------
test("maiores gastos sem registros responde mensagem dedicada", async () => {
  resetState({ gastos: [] });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "maiores gastos", external_id: "mg-3" });
  expect(r.resposta).toContain("Ainda não encontrei gastos registrados nos últimos 7 dias");
});

// ---------------------------------------------------------------------
test("impacto despesas/renda com percentual", async () => {
  resetState({
    gastos: [{ descricao: "X", valor: 200, data: monthStart(), categoria_id: "cat-mer" }],
    receitas: [{ valor: 1000, data: monthStart() }],
  });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "quanto meus gastos afetam minha renda", external_id: "im-1" });
  expect(r.resposta).toContain("20% da sua renda");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 800,00"); // saldo
});

// ---------------------------------------------------------------------
test("impacto sem receitas pede cadastro de entradas", async () => {
  resetState({
    gastos: [{ descricao: "X", valor: 200, data: monthStart(), categoria_id: "cat-mer" }],
    receitas: [],
  });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "qual porcentagem da minha renda eu gastei", external_id: "im-2" });
  expect(r.resposta).toContain("Ainda não há receitas registradas neste mês");
  expect(r.resposta).not.toContain("%");
});

// ---------------------------------------------------------------------
test("usuário sem vínculo não recebe resposta de consulta nem persiste nada", async () => {
  resetState({ link: null });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "menu", external_id: "ne-1" });
  expect(r.status).toBe("sem_vinculo");
  expect(state.inserts.length).toBe(0);
});

// ---------------------------------------------------------------------
test("sessão pendente de gasto prevalece sobre intenção de consulta", async () => {
  // 1) cria sessão pendente (aguardando_forma_pagamento)
  const r0 = await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 30,00", external_id: "sp-a" });
  expect(["aguardando_forma_pagamento", "aguardando_confirmacao"]).toContain(r0.status);
  // 2) mesmo enviando "menu" não responde consulta; mantém o pendente
  const r1 = await processarMensagemWhatsApp({ telefone: tel, texto: "menu", external_id: "sp-b" });
  expect(r1.status).not.toBe("consulta");
});

// ---------------------------------------------------------------------
test("sessão pendente de receita prevalece sobre intenção de consulta", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Quero lançar uma renda", external_id: "spr-a" });
  expect(state.pendingRow?.status).toBe("rec_aguardando_tipo");
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "resumo da semana", external_id: "spr-b" });
  expect(r.status).not.toBe("consulta");
});

// ---------------------------------------------------------------------
// WA-G2.1 — janela mensal "até hoje" (exclui lançamentos futuros)
// ---------------------------------------------------------------------

test("WA-G2.1 resumo do mês ignora receita recorrente futura no mesmo mês", async () => {
  resetState({
    gastos: [{ descricao: "Mercado", valor: 200, data: monthStart(), categoria_id: "cat-mer" }],
    receitas: [
      { valor: 1000, data: monthStart() },            // já recebida
      { valor: 5000, data: daysAheadISO(3) },         // recorrente futura — deve ser ignorada
    ],
  });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "resumo do mês", external_id: "g21-rm-1" });
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 1.000,00"); // só receita já recebida
  expect(r.resposta).not.toContain("6.000");
  expect(r.resposta).toContain("20% das suas receitas"); // 200/1000
});

test("WA-G2.1 impacto despesas ignora receita recorrente futura no mesmo mês", async () => {
  resetState({
    gastos: [{ descricao: "Mercado", valor: 200, data: monthStart(), categoria_id: "cat-mer" }],
    receitas: [
      { valor: 1000, data: monthStart() },
      { valor: 5000, data: daysAheadISO(5) },
    ],
  });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "quanto meus gastos afetam minha renda", external_id: "g21-im-1" });
  expect(r.resposta).toContain("20% da sua renda");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 800,00"); // saldo 1000-200
});

test("WA-G2.1 receita com data de hoje é incluída no resumo do mês", async () => {
  resetState({
    gastos: [],
    receitas: [{ valor: 1500, data: todayISO() }],
  });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "resumo do mês", external_id: "g21-rm-2" });
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 1.500,00");
});

test("WA-G2.1 despesa com data futura não é incluída no resumo do mês", async () => {
  resetState({
    gastos: [
      { descricao: "Hoje",   valor: 100, data: todayISO(),         categoria_id: "cat-mer" },
      { descricao: "Futuro", valor: 999, data: daysAheadISO(2),    categoria_id: "cat-mer" },
    ],
    receitas: [{ valor: 1000, data: monthStart() }],
  });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "resumo do mês", external_id: "g21-rm-3" });
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 100,00"); // despesas
  expect(r.resposta).not.toContain("999");
});

test("WA-G2.1 resumo semanal permanece inalterado (não foi afetado)", async () => {
  resetState({
    gastos: [{ descricao: "Uber", valor: 30, data: daysAgoISO(1), categoria_id: "cat-trans" }],
    receitas: [{ valor: 500, data: daysAgoISO(2) }],
  });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "resumo da semana", external_id: "g21-rs-1" });
  expect(r.resposta).toContain("Resumo dos últimos 7 dias");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 500,00");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 30,00");
});
