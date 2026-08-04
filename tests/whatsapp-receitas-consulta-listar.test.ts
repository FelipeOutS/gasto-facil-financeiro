/**
 * WA-Q-Receitas — Consulta de receitas do mês não pode acionar fluxo
 * de criação de receita/gasto.
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState } from "./_whatsapp-fake";

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { detectConsultaIntent } = await import("../src/server/whatsapp-consultas.server");

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

const FRASES_CONSULTA = [
  "minhas receitas do mês",
  "minhas receitas do mes",
  "minhas receitas",
  "receitas do mês",
  "receitas deste mês",
  "quanto recebi este mês",
  "quanto eu recebi no mês",
  "total de receitas",
  "listar minhas receitas",
  "ver receitas",
  "quais minhas receitas",
];

test("detectConsultaIntent classifica todas as variações como listar_receitas_mes", () => {
  for (const frase of FRASES_CONSULTA) {
    expect([frase, detectConsultaIntent(frase)]).toEqual([frase, "listar_receitas_mes"]);
  }
});

test("'minhas receitas do mês' lista as receitas e NÃO cria sessão de receita/gasto", async () => {
  resetState({
    receitas: [
      {
        id: "r1",
        user_id: "u1",
        descricao: "Salário",
        tipo: "salario",
        valor: 3500,
        data: todayISO(),
      },
      {
        id: "r2",
        user_id: "u1",
        descricao: "Freela",
        tipo: "freelance",
        valor: 800,
        data: monthStart(),
      },
    ],
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "minhas receitas do mês",
    external_id: "qr-1",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toContain("Salário");
  expect(r.resposta).toContain("Freela");
  expect(r.resposta).toContain("R$");
  expect(r.resposta).toContain("Total recebido");
  // Não pode criar sessão de criação (gasto ou receita)
  expect(state.pendingRow).toBeNull();
  expect(state.inserts.some((i) => i.table === "gastos")).toBe(false);
  expect(state.inserts.some((i) => i.table === "receitas")).toBe(false);
  expect(state.inserts.some((i) => i.table === "recorrencias")).toBe(false);
});

test("consulta sem receitas no mês devolve mensagem amigável sem criar sessão", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "receitas do mês",
    external_id: "qr-2",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta.toLowerCase()).toContain("não encontrei");
  expect(state.pendingRow).toBeNull();
  expect(state.inserts.some((i) => i.table === "receitas")).toBe(false);
});

test("nenhuma das frases de consulta gera sessão de criação", async () => {
  for (let i = 0; i < FRASES_CONSULTA.length; i++) {
    resetState();
    const r = await processarMensagemWhatsApp({
      telefone: tel,
      texto: FRASES_CONSULTA[i],
      external_id: `qr-loop-${i}`,
    });
    expect([FRASES_CONSULTA[i], r.status]).toEqual([FRASES_CONSULTA[i], "consulta"]);
    expect(state.inserts.some((x) => x.table === "gastos")).toBe(false);
    expect(state.inserts.some((x) => x.table === "receitas")).toBe(false);
    expect(state.inserts.some((x) => x.table === "recorrencias")).toBe(false);
  }
});

test("'Recebi 3500 de salário hoje' continua criando sessão de receita (não regressão)", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Recebi 3500 de salário hoje",
    external_id: "qr-reg-1",
  });
  expect(r.status).not.toBe("consulta");
  expect(state.pendingRow?.status?.startsWith("rec_")).toBe(true);
});
