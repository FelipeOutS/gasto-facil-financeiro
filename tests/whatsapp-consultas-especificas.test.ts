/**
 * Fase WA-G4 — Testes das consultas financeiras específicas.
 * Reaproveita o mock compartilhado em ./_whatsapp-fake.
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState } from "./_whatsapp-fake";

const { processarMensagemWhatsApp } = await import(
  "../src/server/whatsapp.server"
);
const { detectConsultaEspecifica } = await import(
  "../src/server/whatsapp-consultas-especificas.server"
);

const tel = "5511999998888";

function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
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
function monthStart(): string { return todayISO().slice(0, 7) + "-01"; }

beforeEach(() => resetState());

// ---------- detecção ----------
test("detectConsultaEspecifica reconhece padrões", () => {
  expect(detectConsultaEspecifica("Quanto gastei com Uber este mês")?.kind)
    .toBe("consulta_gasto_por_descricao");
  expect(detectConsultaEspecifica("quanto eu gastei com transporte")?.kind)
    .toBe("consulta_gasto_por_descricao");
  expect(detectConsultaEspecifica("Quanto recebi de freelancer")?.kind)
    .toBe("consulta_receita_por_tipo");
  expect(detectConsultaEspecifica("quais foram meus gastos de ontem")?.kind)
    .toBe("consulta_gastos_ontem");
  expect(detectConsultaEspecifica("quanto sobra da minha renda")?.kind)
    .toBe("consulta_sobra_mes");
  // Lançamento puro — NUNCA vira consulta
  expect(detectConsultaEspecifica("Uber 29,90")).toBe(null);
  expect(detectConsultaEspecifica("mercado 150")).toBe(null);
});

// ---------- gasto por descrição ----------
test("Quanto gastei com Uber este mês — soma e quantidade", async () => {
  resetState({
    gastos: [
      { descricao: "Uber",        valor: 29.9, data: monthStart(),  categoria_id: "cat-trans" },
      { descricao: "Uber Eats",   valor: 40,   data: daysAgoISO(1), categoria_id: "cat-out"   },
      { descricao: "Mercado",     valor: 200,  data: monthStart(),  categoria_id: "cat-mer"   },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "Quanto gastei com Uber este mês?", external_id: "g4-d-1",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 69,90");
  expect(r.resposta.toLowerCase()).toContain("uber");
  expect(r.resposta).toMatch(/2 lançamentos/);
});

test("Quanto gastei com Uber? sem período usa o mês atual", async () => {
  resetState({
    gastos: [{ descricao: "Uber", valor: 30, data: monthStart(), categoria_id: "cat-trans" }],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "Quanto gastei com Uber?", external_id: "g4-d-2",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 30,00");
});

test("Descrição sem resultados responde mensagem dedicada", async () => {
  resetState({ gastos: [] });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "Quanto gastei com iFood?", external_id: "g4-d-3",
  });
  expect(r.resposta).toContain("Não encontrei gastos");
  expect(r.resposta.toLowerCase()).toContain("ifood");
});

// ---------- gasto por categoria ----------
test("Quanto gastei com transporte — usa categoria do usuário", async () => {
  resetState({
    gastos: [
      { descricao: "Uber",   valor: 30,  data: monthStart(),  categoria_id: "cat-trans" },
      { descricao: "99",     valor: 20,  data: daysAgoISO(2), categoria_id: "cat-trans" },
      { descricao: "Mercado",valor: 200, data: monthStart(),  categoria_id: "cat-mer"   },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "quanto gastei com transporte", external_id: "g4-c-1",
  });
  expect(r.resposta).toContain("Transporte");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 50,00");
});

test("Categoria ambígua pede escolha e cria estado temporário", async () => {
  resetState({
    categorias: [
      { id: "cat-1", legacy_id: null, nome: "Saúde Geral",         user_id: "u1", tipo: "despesa" },
      { id: "cat-2", legacy_id: null, nome: "Saúde da família",    user_id: "u1", tipo: "despesa" },
    ],
    gastos: [
      { descricao: "Farmácia", valor: 100, data: monthStart(), categoria_id: "cat-1" },
      { descricao: "Plano",    valor: 300, data: monthStart(), categoria_id: "cat-2" },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "quanto gastei com saúde", external_id: "g4-c-amb",
  });
  expect(r.resposta).toContain("mais de uma categoria");
  expect(r.resposta).toContain("Saúde");
  expect(state.pendingRow?.status).toBe("consulta_categoria_ambigua");

  // Usuário escolhe uma
  const r2 = await processarMensagemWhatsApp({
    telefone: tel, texto: "Saúde da família", external_id: "g4-c-amb-2",
  });
  expect(r2.status).toBe("consulta");
  expect(r2.resposta).toContain("Saúde da família");
  expect(r2.resposta.replace(/\u00a0/g, " ")).toContain("R$ 300,00");
});

test("Categoria ambígua — reset (cancelar) encerra estado temporário", async () => {
  resetState({
    categorias: [
      { id: "cat-1", legacy_id: null, nome: "Saúde Geral",          user_id: "u1", tipo: "despesa" },
      { id: "cat-2", legacy_id: null, nome: "Saúde da família",     user_id: "u1", tipo: "despesa" },
    ],
  });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "quanto gastei com saúde", external_id: "g4-c-rst-1",
  });
  expect(state.pendingRow?.status).toBe("consulta_categoria_ambigua");
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "cancelar", external_id: "g4-c-rst-2",
  });
  expect(r.status).toBe("cancelada");
  expect(state.pendingRow).toBe(null);
});

// ---------- receita por tipo ----------
test("Quanto recebi de freelancer — usa tipo da receita", async () => {
  resetState({
    receitas: [
      { valor: 1500, data: monthStart(),  tipo: "freelance" },
      { valor: 500,  data: daysAgoISO(2), tipo: "freelance" },
      { valor: 3000, data: monthStart(),  tipo: "salario"   },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "Quanto recebi de freelancer?", external_id: "g4-r-1",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("Freelance");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 2.000,00");
});

test("Receita recorrente futura não entra na consulta por tipo", async () => {
  resetState({
    receitas: [
      { valor: 1000, data: monthStart(),     tipo: "freelance" },
      { valor: 9999, data: daysAheadISO(3), tipo: "freelance" }, // futura
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "Quanto recebi de freelancer?", external_id: "g4-r-2",
  });
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 1.000,00");
  expect(r.resposta).not.toContain("9.999");
});

// ---------- gastos de ontem ----------
test("Quais foram meus gastos de ontem — total, maior e top 3", async () => {
  resetState({
    gastos: [
      { descricao: "Mercado",    valor: 200, data: daysAgoISO(1), categoria_id: "cat-mer" },
      { descricao: "Uber",       valor: 30,  data: daysAgoISO(1), categoria_id: "cat-trans" },
      { descricao: "Restaurante",valor: 80,  data: daysAgoISO(1), categoria_id: "cat-rest" },
      { descricao: "Antigo",     valor: 999, data: daysAgoISO(5), categoria_id: "cat-mer" },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "quais foram meus gastos de ontem", external_id: "g4-on-1",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("Resumo de ontem");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 310,00");
  expect(r.resposta).toContain("1. Mercado");
  expect(r.resposta).not.toContain("Antigo");
});

test("Gastos de ontem sem registros", async () => {
  resetState({ gastos: [] });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "quanto gastei ontem", external_id: "g4-on-2",
  });
  expect(r.resposta).toContain("Não encontrei gastos registrados ontem");
});

// ---------- sobra ----------
test("Quanto sobra — saldo positivo", async () => {
  resetState({
    receitas: [{ valor: 1000, data: monthStart(), tipo: "salario" }],
    gastos:   [{ descricao: "X", valor: 300, data: monthStart(), categoria_id: "cat-mer" }],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "quanto sobra da minha renda este mês", external_id: "g4-s-1",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 700,00");
});

test("Quanto sobra — saldo negativo", async () => {
  resetState({
    receitas: [{ valor: 500, data: monthStart(), tipo: "salario" }],
    gastos:   [{ descricao: "X", valor: 800, data: monthStart(), categoria_id: "cat-mer" }],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "quanto sobrou este mês", external_id: "g4-s-2",
  });
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 300,00");
  expect(r.resposta).toContain("acima das receitas");
});

test("Quanto sobra — sem receitas no mês", async () => {
  resetState({
    receitas: [],
    gastos:   [{ descricao: "X", valor: 80, data: monthStart(), categoria_id: "cat-mer" }],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "quanto sobra da minha renda", external_id: "g4-s-3",
  });
  expect(r.resposta).toContain("Ainda não há receitas registradas");
});

// ---------- prioridades / regressões ----------
test("Consulta não interrompe sessão pendente de gasto", async () => {
  // Cria sessão "aguardando_forma_pagamento"
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 30,00", external_id: "g4-pr-1a" });
  expect(state.pendingRow?.status).toBe("aguardando_forma_pagamento");
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "Quanto gastei com Uber este mês?", external_id: "g4-pr-1b",
  });
  expect(r.status).not.toBe("consulta");
});

test("Consulta não interrompe sessão pendente de receita", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Quero lançar uma renda", external_id: "g4-pr-2a" });
  expect(state.pendingRow?.status).toBe("rec_aguardando_tipo");
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "Quanto recebi de freelancer?", external_id: "g4-pr-2b",
  });
  expect(r.status).not.toBe("consulta");
});

test("Uber 29,90 continua sendo lançamento, não consulta", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "Uber 29,90", external_id: "g4-pr-3",
  });
  expect(r.status).toBe("aguardando_forma_pagamento");
});

// ---------- WA-G4.1: correção de consulta por categoria ----------
test("WA-G4.1 — categoria Transporte encontra gastos vinculados (soma e total)", async () => {
  resetState({
    gastos: [
      { descricao: "Uber", valor: 81.9,  data: monthStart(),  categoria_id: "cat-trans" },
      { descricao: "Uber", valor: 49.9,  data: daysAgoISO(2), categoria_id: "cat-trans" },
      { descricao: "Mercado", valor: 200, data: monthStart(), categoria_id: "cat-mer" },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "quanto gastei com transporte?", external_id: "g41-1",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("Transporte");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 131,80");
  expect(r.resposta).toMatch(/2 lan/);
});

test("WA-G4.1 — sem acento encontra categoria com acento (Saúde)", async () => {
  resetState({
    gastos: [
      { descricao: "Farmácia", valor: 50, data: monthStart(), categoria_id: "cat-saude" },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "quanto gastei com saude", external_id: "g41-2",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("Saúde");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 50,00");
});

test("WA-G4.1 — termo no plural encontra categoria no singular", async () => {
  resetState({
    gastos: [
      { descricao: "Uber", valor: 30, data: monthStart(), categoria_id: "cat-trans" },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "quanto gastei com transportes", external_id: "g41-3",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("Transporte");
});

test("WA-G4.1 — gastos de outra categoria não entram na soma", async () => {
  resetState({
    gastos: [
      { descricao: "Uber",    valor: 30,  data: monthStart(), categoria_id: "cat-trans" },
      { descricao: "Mercado", valor: 999, data: monthStart(), categoria_id: "cat-mer"   },
      { descricao: "Plano",   valor: 500, data: monthStart(), categoria_id: "cat-saude" },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "quanto gastei com transporte", external_id: "g41-4",
  });
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 30,00");
  expect(r.resposta).not.toContain("999");
  expect(r.resposta).not.toContain("500");
});

test("WA-G4.1 — gastos futuros não entram na consulta por categoria", async () => {
  resetState({
    gastos: [
      { descricao: "Uber",  valor: 30,   data: monthStart(),     categoria_id: "cat-trans" },
      { descricao: "Uber",  valor: 9999, data: daysAheadISO(3),  categoria_id: "cat-trans" },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "quanto gastei com transporte", external_id: "g41-5",
  });
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 30,00");
  expect(r.resposta).not.toContain("9.999");
});

test("WA-G4.1 — outro usuário não aparece (categoria/gasto filtrados por user_id)", async () => {
  resetState({
    categorias: [
      { id: "cat-trans-u1", legacy_id: "transporte", nome: "Transporte", user_id: "u1" },
    ],
    gastos: [
      { descricao: "Uber", valor: 30, data: monthStart(), categoria_id: "cat-trans-u1", user_id: "u1" },
      // Mesmo se "vazasse", não tem categoria do u1
      { descricao: "Uber outro", valor: 5000, data: monthStart(), categoria_id: "cat-trans-outro", user_id: "u2" },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "quanto gastei com transporte", external_id: "g41-6",
  });
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 30,00");
  expect(r.resposta).not.toContain("5.000");
});

test("WA-G4.1 — descrição continua funcionando quando não há categoria correspondente", async () => {
  resetState({
    categorias: [
      { id: "cat-out", legacy_id: "outros", nome: "Outros", user_id: "u1" },
    ],
    gastos: [
      { descricao: "iFood", valor: 45, data: monthStart(), categoria_id: "cat-out" },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "quanto gastei com iFood", external_id: "g41-7",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta.toLowerCase()).toContain("ifood");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 45,00");
});

// ---------- WA-G4.2: categorias duplicadas com o mesmo nome ----------
test("WA-G4.2 — duas categorias 'Transporte' viram um grupo único e somam os gastos", async () => {
  resetState({
    categorias: [
      { id: "cat-trans-a", legacy_id: "transporte", nome: "Transporte", user_id: "u1" },
      { id: "cat-trans-b", legacy_id: null,         nome: "Transporte", user_id: "u1" },
      { id: "cat-mer",     legacy_id: "mercado",    nome: "Mercado",    user_id: "u1" },
    ],
    gastos: [
      { descricao: "Uber",    valor: 81.9, data: monthStart(),  categoria_id: "cat-trans-a" },
      { descricao: "Uber",    valor: 49.9, data: daysAgoISO(2), categoria_id: "cat-trans-b" },
      { descricao: "Mercado", valor: 200,  data: monthStart(),  categoria_id: "cat-mer"     },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "quanto gastei com transporte?", external_id: "g42-1",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("Transporte");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 131,80");
  expect(r.resposta).toMatch(/2 lan/);
  // não pode pedir escolha
  expect(r.resposta).not.toContain("mais de uma categoria");
  // nunca lista o mesmo nome duas vezes
  const ocorrencias = r.resposta.match(/Transporte/g)?.length ?? 0;
  expect(ocorrencias).toBe(1);
});

test("WA-G4.2 — plural e singular caem no mesmo grupo lógico", async () => {
  resetState({
    categorias: [
      { id: "cat-1", legacy_id: null, nome: "Transporte",  user_id: "u1" },
      { id: "cat-2", legacy_id: null, nome: "Transportes", user_id: "u1" },
    ],
    gastos: [
      { descricao: "Uber", valor: 10, data: monthStart(), categoria_id: "cat-1" },
      { descricao: "99",   valor: 20, data: monthStart(), categoria_id: "cat-2" },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "quanto gastei com transporte", external_id: "g42-2",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 30,00");
  expect(r.resposta).not.toContain("mais de uma categoria");
});

test("WA-G4.2 — categorias realmente distintas continuam gerando ambiguidade (sem duplicar nomes)", async () => {
  resetState({
    categorias: [
      { id: "cat-1", legacy_id: null, nome: "Transporte",         user_id: "u1" },
      { id: "cat-1b",legacy_id: null, nome: "transporte",         user_id: "u1" }, // duplicada do 1
      { id: "cat-2", legacy_id: null, nome: "Transporte Público", user_id: "u1" },
    ],
    gastos: [
      { descricao: "Uber",   valor: 50, data: monthStart(), categoria_id: "cat-1"  },
      { descricao: "Metrô",  valor: 7,  data: monthStart(), categoria_id: "cat-2"  },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "quanto gastei com transporte", external_id: "g42-3",
  });
  expect(r.resposta).toContain("mais de uma categoria");
  // Apenas dois grupos lógicos, sem duplicar "Transporte".
  expect(r.resposta).toContain("1. ");
  expect(r.resposta).toContain("2. ");
  expect(r.resposta).not.toContain("3. ");
  expect(state.pendingRow?.status).toBe("consulta_categoria_ambigua");
});

test("WA-G4.2 — resposta '1' escolhe corretamente o primeiro grupo (com IDs duplicados)", async () => {
  resetState({
    categorias: [
      { id: "cat-1",  legacy_id: null, nome: "Transporte",         user_id: "u1" },
      { id: "cat-1b", legacy_id: null, nome: "Transporte",         user_id: "u1" },
      { id: "cat-2",  legacy_id: null, nome: "Transporte Público", user_id: "u1" },
    ],
    gastos: [
      { descricao: "Uber",  valor: 40, data: monthStart(), categoria_id: "cat-1"  },
      { descricao: "99",    valor: 60, data: monthStart(), categoria_id: "cat-1b" },
      { descricao: "Metrô", valor: 7,  data: monthStart(), categoria_id: "cat-2"  },
    ],
  });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "quanto gastei com transporte", external_id: "g42-4a",
  });
  expect(state.pendingRow?.status).toBe("consulta_categoria_ambigua");
  const r2 = await processarMensagemWhatsApp({
    telefone: tel, texto: "1", external_id: "g42-4b",
  });
  expect(r2.status).toBe("consulta");
  // soma de cat-1 + cat-1b = 100, sem cat-2
  expect(r2.resposta.replace(/\u00a0/g, " ")).toContain("R$ 100,00");
  expect(r2.resposta).not.toContain("R$ 7,00");
});

test("WA-G4.2 — cancelar encerra a escolha de categoria duplicada", async () => {
  resetState({
    categorias: [
      { id: "cat-1", legacy_id: null, nome: "Transporte",         user_id: "u1" },
      { id: "cat-2", legacy_id: null, nome: "Transporte Público", user_id: "u1" },
    ],
  });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "quanto gastei com transporte", external_id: "g42-5a",
  });
  expect(state.pendingRow?.status).toBe("consulta_categoria_ambigua");
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "cancelar", external_id: "g42-5b",
  });
  expect(r.status).toBe("cancelada");
  expect(state.pendingRow).toBe(null);
});
