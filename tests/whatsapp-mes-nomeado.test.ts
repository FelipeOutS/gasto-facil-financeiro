/**
 * WA-B-Precedence — Consulta de gastos por mês nomeado.
 *
 * Regressão da Etapa B do mini-smoke pós-deploy: "quanto gastei em
 * julho" era roteado para `consulta_gasto_por_descricao` com termo
 * "julho". Agora, o roteador reconhece nomes de mês antes da consulta
 * por descrição, resolve `month`/`year` no fuso America/Sao_Paulo e
 * consulta a janela `[YYYY-MM-01, YYYY-MM+1-01)`.
 *
 * Também cobre:
 * - regras de ano (corrente vs explícito, ano inválido);
 * - proteção do parser específico (nomes de mês não viram termo);
 * - isolamento por user_id;
 * - zero escrita financeira.
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState } from "./_whatsapp-fake";

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const {
  detectConsultaMensalNomeada,
  extractPeriodoSuffix,
  anoCorrenteSaoPaulo,
} = await import("../src/server/whatsapp-mes-nomeado");
const { detectConsultaEspecifica } = await import(
  "../src/server/whatsapp-consultas-especificas.server"
);

const tel = "5511999998888";
const ANO = anoCorrenteSaoPaulo();

beforeEach(() => resetState());

function contaInserts() {
  return state.inserts.filter((i) =>
    ["gastos", "receitas", "contas_a_pagar", "recorrencias", "fornecedores"].includes(i.table),
  ).length;
}

// ------------------------------------------------------------------
// 1. Detector puro
// ------------------------------------------------------------------

test("detectConsultaMensalNomeada — variações principais mapeiam para mês + ano corrente", () => {
  const casos: Array<[string, number]> = [
    ["quanto gastei em julho", 7],
    ["quanto eu gastei em julho", 7],
    ["quanto gastei no mês de julho", 7],
    ["quanto gastei no mes de julho", 7],
    ["gastos de julho", 7],
    ["gastos em julho", 7],
    ["gastos de dezembro", 12],
    ["gastos em janeiro", 1],
    ["quanto foi gasto em agosto", 8],
  ];
  for (const [frase, esperadoMes] of casos) {
    const r = detectConsultaMensalNomeada(frase);
    expect([frase, r?.kind]).toEqual([frase, "ok"]);
    if (r && r.kind === "ok") {
      expect([frase, r.month]).toEqual([frase, esperadoMes]);
      expect([frase, r.year]).toEqual([frase, ANO]);
      expect([frase, r.hadExplicitYear]).toEqual([frase, false]);
    }
  }
});

test("detectConsultaMensalNomeada — ano explícito", () => {
  const r1 = detectConsultaMensalNomeada("quanto gastei em julho de 2026");
  expect(r1?.kind).toBe("ok");
  if (r1 && r1.kind === "ok") {
    expect(r1.month).toBe(7);
    expect(r1.year).toBe(2026);
    expect(r1.hadExplicitYear).toBe(true);
  }
  const r2 = detectConsultaMensalNomeada("quanto gastei em janeiro de 2025");
  expect(r2?.kind).toBe("ok");
  if (r2 && r2.kind === "ok") {
    expect(r2.month).toBe(1);
    expect(r2.year).toBe(2025);
  }
});

test("detectConsultaMensalNomeada — março com e sem acento", () => {
  const a = detectConsultaMensalNomeada("gastos de março");
  const b = detectConsultaMensalNomeada("gastos de marco");
  expect(a?.kind).toBe("ok");
  expect(b?.kind).toBe("ok");
  if (a && a.kind === "ok") expect(a.month).toBe(3);
  if (b && b.kind === "ok") expect(b.month).toBe(3);
});

test("detectConsultaMensalNomeada — mês futuro sem ano permanece no ano corrente", () => {
  // Se hoje é julho/2026, "gastos de dezembro" → dezembro/2026 (não retrocede).
  const r = detectConsultaMensalNomeada("gastos de dezembro");
  expect(r?.kind).toBe("ok");
  if (r && r.kind === "ok") expect(r.year).toBe(ANO);
});

test("detectConsultaMensalNomeada — ano inválido retorna ano_invalido", () => {
  const r = detectConsultaMensalNomeada("quanto gastei em julho de 1800");
  expect(r?.kind).toBe("ano_invalido");
});

test("detectConsultaMensalNomeada — 'com julho' NÃO é mensal (usuário usou preposição de descrição)", () => {
  expect(detectConsultaMensalNomeada("quanto gastei com julho")).toBeNull();
});

test("detectConsultaMensalNomeada — termo textual antes do mês NÃO é mensal", () => {
  expect(detectConsultaMensalNomeada("quanto gastei com mercado em julho")).toBeNull();
});

// ------------------------------------------------------------------
// 2. Proteção no parser específico (stripPeriodoSuffix via extractPeriodoSuffix)
// ------------------------------------------------------------------

test("extractPeriodoSuffix — remove sufixo 'em julho' do termo", () => {
  const r = extractPeriodoSuffix("mercado em julho");
  expect(r.termo).toBe("mercado");
  expect(r.periodo).toEqual({ month: 7, year: ANO, hadExplicitYear: false });
});

test("extractPeriodoSuffix — remove sufixo 'em julho de 2026'", () => {
  const r = extractPeriodoSuffix("mercado em julho de 2026");
  expect(r.termo).toBe("mercado");
  expect(r.periodo).toEqual({ month: 7, year: 2026, hadExplicitYear: true });
});

test("extractPeriodoSuffix — sem sufixo não altera o termo", () => {
  const r = extractPeriodoSuffix("mercado");
  expect(r.termo).toBe("mercado");
  expect(r.periodo).toBeNull();
});

test("detectConsultaEspecifica — 'quanto gastei com mercado em julho' → termo='mercado'", () => {
  const r = detectConsultaEspecifica("quanto gastei com mercado em julho");
  expect(r?.kind).toBe("consulta_gasto_por_descricao");
  if (r && r.kind === "consulta_gasto_por_descricao") {
    // 'julho' não pode escapar como parte do termo
    expect(r.termo.toLowerCase()).not.toContain("julho");
    expect(r.termo.toLowerCase()).toContain("mercado");
  }
});

// ------------------------------------------------------------------
// 3. Pipeline integrado — precedência mensal sobre descrição
// ------------------------------------------------------------------

test("'quanto gastei em julho' → consulta mensal (não busca por termo 'julho') e zero escrita", async () => {
  resetState({
    gastos: [
      { id: "g1", user_id: "u1", descricao: "Mercado", valor: 100, data: `${ANO}-07-05`, categoria_id: null },
      { id: "g2", user_id: "u1", descricao: "Uber",    valor:  30, data: `${ANO}-07-10`, categoria_id: null },
      { id: "g3", user_id: "u1", descricao: "Farmacia", valor: 20, data: `${ANO}-06-30`, categoria_id: null }, // fora
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "quanto gastei em julho",
    external_id: "b-1",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("Mercado");
  expect(r.resposta).toContain("Uber");
  // não deve exibir a copy antiga de "gastos com 'julho'"
  expect(r.resposta.toLowerCase()).not.toContain('com "julho"');
  expect(r.resposta.toLowerCase()).not.toContain("com 'julho'");
  // Zero escrita financeira
  expect(contaInserts()).toBe(0);
});

test("'quanto gastei em julho de 2026' resolve janela específica", async () => {
  resetState({
    gastos: [
      { id: "g1", user_id: "u1", descricao: "AlvoJulho2026", valor: 50, data: "2026-07-15", categoria_id: null },
      { id: "g2", user_id: "u1", descricao: "ForaJunho2026", valor: 60, data: "2026-06-30", categoria_id: null },
      { id: "g3", user_id: "u1", descricao: "ForaAgosto2026", valor: 70, data: "2026-08-01", categoria_id: null },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "quanto gastei em julho de 2026",
    external_id: "b-2",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("AlvoJulho2026");
  expect(r.resposta).not.toContain("ForaJunho2026");
  expect(r.resposta).not.toContain("ForaAgosto2026");
  expect(contaInserts()).toBe(0);
});

test("'quanto gastei em janeiro de 2025' — janela histórica sem gastos responde vazio com ano no texto", async () => {
  resetState({ gastos: [] });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "quanto gastei em janeiro de 2025",
    external_id: "b-3",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta.toLowerCase()).toContain("janeiro");
  expect(r.resposta).toContain("2025");
  expect(contaInserts()).toBe(0);
});

test("'gastos de dezembro' precede consulta por descrição", async () => {
  resetState({
    gastos: [
      { id: "g1", user_id: "u1", descricao: "Presente", valor: 200, data: `${ANO}-12-20`, categoria_id: null },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "gastos de dezembro",
    external_id: "b-4",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("Presente");
  expect(contaInserts()).toBe(0);
});

test("consulta por descrição legítima continua funcionando ('quanto gastei com mercado')", async () => {
  resetState({
    gastos: [
      { id: "g1", user_id: "u1", descricao: "Mercado Extra", valor: 88, data: `${ANO}-${String((new Date().getUTCMonth() % 12) + 1).padStart(2, "0")}-01`, categoria_id: null },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "quanto gastei com mercado",
    external_id: "b-5",
  });
  expect(r.status).toBe("consulta");
  // Aceita tanto match por categoria "Mercado" quanto por descrição
  expect(r.resposta.toLowerCase()).toMatch(/mercado/);
  expect(contaInserts()).toBe(0);
});

test("resposta com total zero não fala em termo textual 'julho'", async () => {
  resetState({ gastos: [] });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "quanto gastei em julho",
    external_id: "b-6",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta.toLowerCase()).not.toContain('com "julho"');
  expect(r.resposta.toLowerCase()).not.toContain("com 'julho'");
  expect(contaInserts()).toBe(0);
});

test("ano inválido responde com mensagem segura e zero escrita", async () => {
  resetState({ gastos: [] });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "quanto gastei em julho de 1800",
    external_id: "b-7",
  });
  expect(r.resposta.toLowerCase()).toContain("inválido");
  expect(contaInserts()).toBe(0);
});
