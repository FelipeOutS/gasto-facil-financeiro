/**
 * Fase WA-G3 — Testes do fluxo conversacional (saudação, menu, finanças
 * genérico e cancelar sem sessão).
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState } from "./_whatsapp-fake";

const { processarMensagemWhatsApp } = await import(
  "../src/server/whatsapp.server"
);
const { detectConversationalIntent } = await import(
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

// ---------- detector ----------
test("detectConversationalIntent reconhece variações", () => {
  expect(detectConversationalIntent("oi")).toBe("saudacao_whatsapp");
  expect(detectConversationalIntent("Olá")).toBe("saudacao_whatsapp");
  expect(detectConversationalIntent("bom dia")).toBe("saudacao_whatsapp");
  expect(detectConversationalIntent("boa noite")).toBe("saudacao_whatsapp");

  expect(detectConversationalIntent("GI")).toBe("menu_whatsapp");
  expect(detectConversationalIntent("Gasto Inteligente")).toBe("menu_whatsapp");
  expect(detectConversationalIntent("ajuda")).toBe("menu_whatsapp");
  expect(detectConversationalIntent("menu")).toBe("menu_whatsapp");
  expect(detectConversationalIntent("opções")).toBe("menu_whatsapp");
  expect(detectConversationalIntent("o que você faz?")).toBe("menu_whatsapp");

  expect(detectConversationalIntent("quero ver minhas finanças")).toBe("financas_generico");
  expect(detectConversationalIntent("como estão minhas finanças")).toBe("financas_generico");
  expect(detectConversationalIntent("me ajuda com minhas finanças")).toBe("financas_generico");

  expect(detectConversationalIntent("cancelar")).toBe("cancelar_sem_sessao");
  expect(detectConversationalIntent("cancela")).toBe("cancelar_sem_sessao");

  // Não deve casar conteúdo financeiro real
  expect(detectConversationalIntent("Uber 29,90")).toBe(null);
  expect(detectConversationalIntent("sim")).toBe(null);
});

// ---------- saudação ----------
test("oi responde saudação curta e não cria sessão de gasto/receita", async () => {
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "oi", external_id: "g3-s-1" });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("GI");
  expect(r.resposta).toContain("Digite");
  expect(state.inserts.some((i) => i.table === "gastos")).toBe(false);
  expect(state.inserts.some((i) => i.table === "receitas")).toBe(false);
});

// ---------- menu ----------
test("GI abre o menu completo", async () => {
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "GI", external_id: "g3-m-1" });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("Registrar gasto");
  expect(r.resposta).toContain("Registrar renda");
  expect(r.resposta).toContain("Resumo da semana");
});

test("Gasto Inteligente abre o menu completo", async () => {
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "Gasto Inteligente", external_id: "g3-m-2" });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("Registrar gasto");
  expect(r.resposta).toContain("Impacto");
});

test("ajuda abre o menu completo", async () => {
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "ajuda", external_id: "g3-m-3" });
  expect(r.resposta).toContain("Registrar gasto");
});

// ---------- anti-repetição ----------
test("menu repetido em sequência envia versão curta", async () => {
  const r1 = await processarMensagemWhatsApp({ telefone: tel, texto: "menu", external_id: "g3-rep-1" });
  expect(r1.resposta).toContain("Registrar gasto");
  const r2 = await processarMensagemWhatsApp({ telefone: tel, texto: "menu", external_id: "g3-rep-2" });
  expect(r2.resposta).not.toContain("Registrar gasto");
  expect(r2.resposta).toContain("Você pode me enviar");
});

// ---------- finanças genérico ----------
test("quero ver minhas finanças abre opções de consulta sem dados", async () => {
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "quero ver minhas finanças", external_id: "g3-f-1" });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("O que você quer consultar");
  expect(r.resposta).toContain("Resumo da semana");
  expect(r.resposta).toContain("Resumo do mês");
  // Não pode trazer valores reais
  expect(r.resposta).not.toContain("R$");
});

test("como estão minhas finanças cai em finanças genérico (não resumo do mês)", async () => {
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "como estão minhas finanças", external_id: "g3-f-2" });
  expect(r.resposta).toContain("O que você quer consultar");
});

// ---------- cancelar sem sessão ----------
test("cancelar sem sessão ativa responde com mensagem de reinício", async () => {
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "cancelar", external_id: "g3-c-1" });
  expect(r.status).toBe("cancelada");
  expect(r.resposta).toContain("vamos começar de novo");
  expect(r.resposta).not.toContain("Não tem nada em andamento");
  expect(r.resposta).not.toContain("aguardando confirmação");
});

// ---------- cancelar com sessão (regressão) ----------
test("cancelar com sessão de gasto encerra e devolve mensagem de reinício", async () => {
  // cria sessão aguardando_confirmacao
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 30 hoje pix", external_id: "g3-cg-a" });
  expect(state.pendingRow?.status).toBe("aguardando_confirmacao");
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "cancelar", external_id: "g3-cg-b" });
  expect(r.status).toBe("cancelada");
  expect(r.resposta).toContain("vamos começar de novo");
});

test("cancelar com sessão de receita encerra e devolve mensagem de reinício", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Quero lançar uma renda", external_id: "g3-cr-a" });
  expect(state.pendingRow?.status).toBe("rec_aguardando_tipo");
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "cancelar", external_id: "g3-cr-b" });
  expect(r.status).toBe("cancelada");
  expect(r.resposta).toContain("vamos começar de novo");
});

// ---------- prioridade da sessão pendente ----------
test("sessão pendente de gasto prevalece sobre saudação", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 30,00", external_id: "g3-p-1" });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "oi", external_id: "g3-p-2" });
  expect(r.status).not.toBe("consulta");
});

test("sessão pendente de receita prevalece sobre menu", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Quero lançar uma renda", external_id: "g3-p-3" });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "menu", external_id: "g3-p-4" });
  expect(r.status).not.toBe("consulta");
});

test("sessão pendente prevalece sobre consulta financeira genérica", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 30,00", external_id: "g3-p-5" });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "quero ver minhas finanças", external_id: "g3-p-6" });
  expect(r.status).not.toBe("consulta");
});

// ---------- maiores gastos do mês ignora futuros ----------
test("WA-G3 maiores_gastos_mes ignora despesas futuras do mesmo mês", async () => {
  resetState({
    gastos: [
      { descricao: "Hoje",   valor: 100, data: monthStart(),       categoria_id: "cat-mer" },
      { descricao: "Futuro", valor: 999, data: daysAheadISO(2),    categoria_id: "cat-mer" },
    ],
  });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "maiores gastos do mês", external_id: "g3-mg-1" });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("1. Hoje");
  expect(r.resposta).not.toContain("Futuro");
  expect(r.resposta).not.toContain("999");
});

// ---------- nenhuma nova intenção persiste lançamento ----------
test("nenhuma das novas intenções cria gasto, receita ou recorrência", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "oi", external_id: "g3-n-1" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "menu", external_id: "g3-n-2" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "GI", external_id: "g3-n-3" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "quero ver minhas finanças", external_id: "g3-n-4" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "cancelar", external_id: "g3-n-5" });
  expect(state.inserts.some((i) => i.table === "gastos")).toBe(false);
  expect(state.inserts.some((i) => i.table === "receitas")).toBe(false);
  expect(state.inserts.some((i) => i.table === "receitas_recorrentes")).toBe(false);
});
