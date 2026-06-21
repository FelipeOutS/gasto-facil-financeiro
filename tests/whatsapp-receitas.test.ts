/**
 * Fase WA-G1 — testes do fluxo de RECEITAS via WhatsApp.
 * Reaproveita o mock compartilhado em ./_whatsapp-fake.
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState } from "./_whatsapp-fake";

const { processarMensagemWhatsApp } = await import(
  "../src/server/whatsapp.server"
);

const tel = "5511999998888";
const receitasInserts = () => state.inserts.filter((i) => i.table === "receitas");

beforeEach(() => {
  resetState();
});

// ---------------------------------------------------------------------
test('"Quero lançar uma renda" → fluxo completo não recorrente', async () => {
  let r = await processarMensagemWhatsApp({ telefone: tel, texto: "Quero lançar uma renda", external_id: "rec1-a" });
  expect(r.resposta.toLowerCase()).toContain("tipo de renda");
  expect(state.pendingRow?.status).toBe("rec_aguardando_tipo");

  r = await processarMensagemWhatsApp({ telefone: tel, texto: "salário", external_id: "rec1-b" });
  expect(r.resposta.toLowerCase()).toContain("qual valor");

  r = await processarMensagemWhatsApp({ telefone: tel, texto: "3500", external_id: "rec1-c" });
  expect(r.resposta.toLowerCase()).toContain("recorrente");

  r = await processarMensagemWhatsApp({ telefone: tel, texto: "não", external_id: "rec1-d" });
  expect(r.resposta).toContain("Confere pra mim");
  expect(r.resposta).toContain("Salário");
  expect(r.resposta).toContain("R$ 3.500,00");

  r = await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "rec1-e" });
  expect(r.status).toBe("salva");
  expect(receitasInserts()).toHaveLength(1);
  expect(receitasInserts()[0].row.recorrente).toBe(false);
  expect(receitasInserts()[0].row.tipo).toBe("salario");
  expect(receitasInserts()[0].row.origem).toBe("whatsapp");
});

// ---------------------------------------------------------------------
test('"Recebi 4.000 de salário" → resumo direto, confirma e salva', async () => {
  let r = await processarMensagemWhatsApp({ telefone: tel, texto: "Recebi 4.000 de salário", external_id: "rec2-a" });
  expect(r.resposta.toLowerCase()).toContain("recorrente");

  r = await processarMensagemWhatsApp({ telefone: tel, texto: "não", external_id: "rec2-b" });
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 4.000,00");

  r = await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "rec2-c" });
  expect(r.status).toBe("salva");
  expect(receitasInserts()).toHaveLength(1);
  expect(Number(receitasInserts()[0].row.valor)).toBe(4000);
});

// ---------------------------------------------------------------------
test("Receita recorrente mensal cria 12 lançamentos com mesmo recorrencia_id", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Recebi 2500 de salário", external_id: "rm-a" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "rm-b" }); // recorrente sim
  await processarMensagemWhatsApp({ telefone: tel, texto: "todo mês", external_id: "rm-c" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "5", external_id: "rm-d" });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "rm-e" });
  expect(r.status).toBe("salva");
  expect(r.resposta.toLowerCase()).toContain("frequência");
  const rows = receitasInserts();
  expect(rows.length).toBe(12);
  const recId = rows[0].row.recorrencia_id;
  expect(typeof recId).toBe("string");
  expect(rows.every((x) => x.row.recorrencia_id === recId)).toBe(true);
  expect(rows.every((x) => x.row.recorrente === true)).toBe(true);
});

// ---------------------------------------------------------------------
test("Receita recorrente semanal aceita 'sexta'", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Ganhei 200 de freelancer", external_id: "rs-a" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "rs-b" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "toda semana", external_id: "rs-c" });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "sexta", external_id: "rs-d" });
  expect(r.resposta).toContain("Toda semana");
  const r2 = await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "rs-e" });
  expect(r2.status).toBe("salva");
  expect(receitasInserts().length).toBe(12);
});

// ---------------------------------------------------------------------
test("Frequência inválida pede de novo", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Recebi 100 de salário", external_id: "fi-a" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "fi-b" });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "às vezes", external_id: "fi-c" });
  expect(r.resposta.toLowerCase()).toContain("não consegui entender a frequência");
});

// ---------------------------------------------------------------------
test("Cancelamento no meio do fluxo encerra sem salvar", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Quero lançar uma renda", external_id: "c-a" });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "cancelar", external_id: "c-b" });
  expect(r.status).toBe("cancelada");
  expect(r.resposta.toLowerCase()).toContain("não registrei");
  expect(receitasInserts().length).toBe(0);
});

// ---------------------------------------------------------------------
test("Resposta inválida na confirmação não salva e pede sim/não", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Recebi 100 de salário", external_id: "ri-a" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "não", external_id: "ri-b" }); // não recorrente → confirmação
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "talvez", external_id: "ri-c" });
  expect(r.status).toBe("pendente");
  expect(r.resposta).toContain("sim ou não");
  expect(receitasInserts().length).toBe(0);
});

// ---------------------------------------------------------------------
test("Mensagem duplicada não cria duas receitas", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Recebi 50 de salário", external_id: "d-a" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "não", external_id: "d-b" });
  const r1 = await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "d-c" });
  expect(r1.status).toBe("salva");
  const r2 = await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "d-c" });
  expect(r2.status).toBe("duplicada");
  expect(receitasInserts().length).toBe(1);
});

// ---------------------------------------------------------------------
test("Telefone sem vínculo: nada é persistido", async () => {
  resetState({ link: null });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "Recebi 100 de salário", external_id: "sv-a" });
  expect(r.status).toBe("sem_vinculo");
  expect(receitasInserts().length).toBe(0);
});

// ---------------------------------------------------------------------
test("Fluxo de despesas continua intacto (regressão)", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Gastei R$ 35,90 no mercado hoje no cartão Nubank",
    external_id: "reg-a",
  });
  expect(r.status).toBe("aguardando_confirmacao");
  expect(receitasInserts().length).toBe(0);
});
