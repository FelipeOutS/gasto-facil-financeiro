/**
 * Fase WA-G1 — testes do fluxo de RECEITAS via WhatsApp.
 * Reaproveita o mock compartilhado em ./_whatsapp-fake.
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");

const tel = "5511999998888";
const receitasInserts = () => state.inserts.filter((i) => i.table === "receitas");

beforeEach(() => {
  resetState();
});

// ---------------------------------------------------------------------
test('"Quero lançar uma renda" → fluxo completo não recorrente', async () => {
  let r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Quero lançar uma renda",
    external_id: "rec1-a",
  });
  expect(r.resposta.toLowerCase()).toContain("tipo de renda");
  expect(state.pendingRow?.status).toBe("rec_aguardando_tipo");

  r = await processarMensagemWhatsApp({ telefone: tel, texto: "salário", external_id: "rec1-b" });
  expect(r.resposta.toLowerCase()).toContain("qual valor");

  r = await processarMensagemWhatsApp({ telefone: tel, texto: "3500", external_id: "rec1-c" });
  expect(r.resposta.toLowerCase()).toContain("recorrente");

  r = await processarMensagemWhatsApp({ telefone: tel, texto: "não", external_id: "rec1-d" });
  expect(r.resposta).toContain("Confere pra mim");
  expect(r.resposta).toContain("Salário");
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 3.500,00");

  r = await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "rec1-e" });
  expect(r.status).toBe("salva");
  expect(receitasInserts()).toHaveLength(1);
  expect(receitasInserts()[0].row.recorrente).toBe(false);
  expect(receitasInserts()[0].row.tipo).toBe("salario");
  expect(receitasInserts()[0].row.origem).toBe("whatsapp");
});

// ---------------------------------------------------------------------
test('"Recebi 4.000 de salário" → resumo direto, confirma e salva', async () => {
  let r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Recebi 4.000 de salário",
    external_id: "rec2-a",
  });
  expect(r.resposta.toLowerCase()).toContain("recorrente");

  r = await processarMensagemWhatsApp({ telefone: tel, texto: "não", external_id: "rec2-b" });
  expect(r.resposta.replace(/\u00a0/g, " ")).toContain("R$ 4.000,00");

  r = await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "rec2-c" });
  expect(r.status).toBe("salva");
  expect(receitasInserts()).toHaveLength(1);
  expect(Number(receitasInserts()[0].row.valor)).toBe(4000);
});

// ---------------------------------------------------------------------
// WA-R1-Fix — recorrência cria exatamente 1 receita atual + 1 recorrência ativa
// (nunca pré-projeta lançamentos futuros como receitas reais).
test("Receita recorrente mensal cria exatamente 1 receita + 1 recorrência ativa", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Recebi 2500 de salário",
    external_id: "rm-a",
  });
  await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "rm-b" }); // recorrente sim
  await processarMensagemWhatsApp({ telefone: tel, texto: "todo mês", external_id: "rm-c" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "5", external_id: "rm-d" });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "rm-e" });
  expect(r.status).toBe("salva");
  expect(r.resposta.toLowerCase()).toContain("frequência");
  const rows = receitasInserts();
  expect(rows.length).toBe(1);
  expect(rows[0].row.recorrente).toBe(true);
  expect(typeof rows[0].row.recorrencia_id).toBe("string");
  const recos = state.inserts.filter((i) => i.table === "recorrencias");
  expect(recos.length).toBe(1);
  expect(recos[0].row.id).toBe(rows[0].row.recorrencia_id);
  expect(recos[0].row.status).toBe("ativa");
});

// ---------------------------------------------------------------------
test("Receita recorrente semanal aceita 'sexta'", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Ganhei 200 de freelancer",
    external_id: "rs-a",
  });
  await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "rs-b" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "toda semana", external_id: "rs-c" });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "sexta", external_id: "rs-d" });
  expect(r.resposta).toContain("Toda semana");
  const r2 = await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "rs-e" });
  expect(r2.status).toBe("salva");
  expect(receitasInserts().length).toBe(1);
  expect(state.inserts.filter((i) => i.table === "recorrencias").length).toBe(1);
});

// ---------------------------------------------------------------------
test("Frequência inválida pede de novo", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Recebi 100 de salário",
    external_id: "fi-a",
  });
  await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "fi-b" });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "às vezes",
    external_id: "fi-c",
  });
  expect(r.resposta.toLowerCase()).toContain("não consegui entender a frequência");
});

// ---------------------------------------------------------------------
test("Cancelamento no meio do fluxo encerra sem salvar (mensagem de reinício)", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Quero lançar uma renda",
    external_id: "c-a",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "cancelar",
    external_id: "c-b",
  });
  expect(r.status).toBe("cancelada");
  expect(r.resposta.toLowerCase()).toContain("vamos começar de novo");
  expect(receitasInserts().length).toBe(0);
});

// ---------------------------------------------------------------------
test("Resposta inválida na confirmação não salva e pede sim/não", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Recebi 100 de salário",
    external_id: "ri-a",
  });
  await processarMensagemWhatsApp({ telefone: tel, texto: "não", external_id: "ri-b" }); // não recorrente → confirmação
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "talvez",
    external_id: "ri-c",
  });
  expect(r.status).toBe("pendente");
  expect(r.resposta).toContain("sim ou não");
  expect(receitasInserts().length).toBe(0);
});

// ---------------------------------------------------------------------
test("Mensagem duplicada não cria duas receitas", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Recebi 50 de salário",
    external_id: "d-a",
  });
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
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Recebi 100 de salário",
    external_id: "sv-a",
  });
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

// ---------------------------------------------------------------------
// WA-G1.1 — reentrega de webhook (Meta reenvia o mesmo external_message_id)
// ---------------------------------------------------------------------
test("Reentrega: receita simples salva → segundo envio é duplicada (não cria)", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Recebi 80 de salário",
    external_id: "re-s-a",
  });
  await processarMensagemWhatsApp({ telefone: tel, texto: "não", external_id: "re-s-b" });
  const r1 = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "re-s-c",
  });
  expect(r1.status).toBe("salva");
  expect(receitasInserts().length).toBe(1);

  // Reentrega do mesmo external_id da confirmação
  const r2 = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "re-s-c",
  });
  expect(r2.status).toBe("duplicada");
  expect(receitasInserts().length).toBe(1);

  // Marcadores explícitos foram persistidos em parsed
  const salva = state.inserts.find(
    (i) =>
      i.table === "whatsapp_messages" && i.row.external_id === "re-s-c" && i.row.status === "salva",
  );
  expect(salva).toBeTruthy();
  const parsed = salva!.row.parsed as Record<string, unknown>;
  expect(parsed.kind).toBe("receita");
  expect(parsed.status).toBe("salva");
  expect(typeof parsed.receita_id).toBe("string");
});

test("Reentrega: receita recorrente → segundo envio não cria nova série", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Recebi 1000 de salário",
    external_id: "re-r-a",
  });
  await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "re-r-b" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "todo mês", external_id: "re-r-c" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "10", external_id: "re-r-d" });
  const r1 = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "re-r-e",
  });
  expect(r1.status).toBe("salva");
  expect(receitasInserts().length).toBe(1);

  const r2 = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "re-r-e",
  });
  expect(r2.status).toBe("duplicada");
  expect(receitasInserts().length).toBe(1);

  const salva = state.inserts.find(
    (i) =>
      i.table === "whatsapp_messages" && i.row.external_id === "re-r-e" && i.row.status === "salva",
  );
  const parsed = salva!.row.parsed as Record<string, unknown>;
  expect(parsed.kind).toBe("receita");
  expect(typeof parsed.recorrencia_id).toBe("string");
  expect(typeof parsed.receita_id).toBe("string");
});

test("Reentrega: despesa salva → segundo envio é duplicada (não cria gasto)", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Mercado 25,50 hoje pix",
    external_id: "re-d-a",
  });
  const r1 = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "re-d-b",
  });
  expect(r1.status).toBe("salva");
  const gastos1 = state.inserts.filter((i) => i.table === "gastos").length;
  expect(gastos1).toBe(1);

  const r2 = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "re-d-b",
  });
  expect(r2.status).toBe("duplicada");
  expect(state.inserts.filter((i) => i.table === "gastos").length).toBe(1);
});

// ---------------------------------------------------------------------
test("Confirmação mostra 'Tipo de receita' (não 'Categoria')", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Recebi 500 de salário",
    external_id: "tx-a",
  });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "não", external_id: "tx-b" });
  expect(r.resposta).toContain("Tipo de receita:");
  expect(r.resposta).not.toContain("Categoria:");
});
