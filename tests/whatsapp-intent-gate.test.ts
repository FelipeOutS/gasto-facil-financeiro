/**
 * WA-INTENT-GATE — Portão de intenção antes do parser genérico de gasto.
 *
 * Garante que:
 *  - perguntas simples sobre o assistente ("GI, você entende esse áudio?")
 *    recebem confirmação de entendimento e NUNCA viram sessão de gasto;
 *  - mensagens sem sinal financeiro (sem valor, sem dígito, sem verbo de
 *    lançamento) recebem pedido de esclarecimento, sem sessão e sem escrita;
 *  - a ausência de valor monetário NÃO classifica a mensagem como despesa
 *    incompleta;
 *  - comandos explícitos ("registrar gasto", "lançar gasto de 2 reais")
 *    seguem o fluxo normal de lançamento;
 *  - receita ("registrar uma receita de 2000 reais no Nubank") vai para o
 *    fluxo de receita, nunca para gasto nem ajuste de saldo;
 *  - áudio e texto usam a mesma lógica central;
 *  - após uma resposta de esclarecimento, a próxima mensagem é tratada
 *    como nova (nenhum contexto financeiro pendente é reutilizado);
 *  - confirmações e proteções existentes continuam intactas.
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { evaluateIntentGate, hasExpenseSignal, isCapabilityQuestion } = await import(
  "../src/server/whatsapp-intent-gate.server"
);

const tel = "5511999998888";

beforeEach(() => {
  resetState();
});

// ---------- unidade: evaluateIntentGate ----------

test("gate: perguntas sobre o assistente são capability", () => {
  expect(evaluateIntentGate("GI, você entende esse áudio?").kind).toBe("capability");
  expect(evaluateIntentGate("você consegue me ouvir?").kind).toBe("capability");
  expect(evaluateIntentGate("tá me ouvindo?").kind).toBe("capability");
  expect(evaluateIntentGate("entendeu o que eu falei?").kind).toBe("capability");
  expect(evaluateIntentGate("teste").kind).toBe("capability");
});

test("gate: mensagens sem sinal financeiro são clarify", () => {
  expect(evaluateIntentGate("mercado").kind).toBe("clarify");
  expect(evaluateIntentGate("hoje está quente").kind).toBe("clarify");
  expect(evaluateIntentGate("você pode me ajudar?").kind).toBe("clarify");
  expect(evaluateIntentGate("Uber").kind).toBe("clarify");
});

test("gate: sinais financeiros passam para o pipeline", () => {
  expect(evaluateIntentGate("gastei 48,90 no mercado").kind).toBe("pass");
  expect(evaluateIntentGate("Uber 25").kind).toBe("pass");
  expect(evaluateIntentGate("registrar gasto").kind).toBe("pass");
  expect(evaluateIntentGate("lançar gasto de 2 reais").kind).toBe("pass");
  expect(evaluateIntentGate("quero registrar um gasto").kind).toBe("pass");
  expect(evaluateIntentGate("novo gasto").kind).toBe("pass");
  expect(evaluateIntentGate("48,90").kind).toBe("pass");
});

test("gate: ausência de valor não é sinal de despesa", () => {
  expect(hasExpenseSignal("uma coisa qualquer sem numero")).toBe(false);
  expect(hasExpenseSignal("padaria")).toBe(false);
  expect(isCapabilityQuestion("GI, você entende esse áudio?")).toBe(true);
});

// ---------- integração: pipeline completo ----------

test("áudio 'GI, você entende esse áudio?' confirma entendimento e não cria sessão", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Gi, você entende esse áudio?",
    external_id: "ig-a1",
    source: "audio",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toMatch(/consegui entender seu áudio/i);
  expect(r.resposta).not.toMatch(/qual foi o valor/i);
  expect(state.pendingRow).toBeNull();
  expect(state.gastosData.length).toBe(0);
});

test("texto 'você entende essa mensagem?' confirma entendimento", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "você entende essa mensagem?",
    external_id: "ig-t1",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toMatch(/consegui entender sua mensagem/i);
  expect(state.pendingRow).toBeNull();
});

test("mensagem sem sinal financeiro pede esclarecimento sem criar sessão", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "mercado",
    external_id: "ig-c1",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toMatch(/não identifiquei um gasto ou receita/i);
  expect(r.resposta).not.toMatch(/qual foi o valor/i);
  expect(state.pendingRow).toBeNull();
  expect(state.gastosData.length).toBe(0);
});

test("pergunta ambígua pede esclarecimento, sem presumir despesa", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "você pode me ajudar?",
    external_id: "ig-c2",
  });
  expect(r.status).toBe("consulta");
  expect(r.resposta).toMatch(/não identifiquei um gasto ou receita/i);
  expect(state.pendingRow).toBeNull();
});

test("'lançar gasto de 2 reais' identifica despesa de R$ 2,00 e pede descrição", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "lançar gasto de 2 reais",
    external_id: "ig-g1",
    source: "audio",
  });
  expect(r.status).toBe("pendente");
  expect(r.resposta).toMatch(/esse valor foi de qu[eê]/i);
  expect(state.pendingRow?.status).toBe("aguardando_descricao_e_valor_gasto");
  expect(state.pendingRow?.parsed?.kind).toBe("gasto");
  expect(state.pendingRow?.parsed?.valor).toBe(2);
});

test("'lançar gasto de 2 reais' + 'padaria' segue para forma de pagamento", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "lançar gasto de 2 reais",
    external_id: "ig-g1",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "padaria",
    external_id: "ig-g2",
  });
  expect(r.status).toBe("aguardando_forma_pagamento");
  expect(state.pendingRow?.parsed?.valor).toBe(2);
  expect(state.pendingRow?.parsed?.nome).toMatch(/padaria/i);
});

test("'registrar uma receita de 2000 reais no Nubank' vai para o fluxo de receita", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "registrar uma receita de 2000 reais no Nubank",
    external_id: "ig-r1",
  });
  // Fluxo de receita: sessão pendente com kind=receita, nunca gasto.
  expect(["pendente", "aguardando_confirmacao"]).toContain(r.status);
  expect(state.pendingRow?.parsed?.kind).toBe("receita");
  expect(state.gastosData.length).toBe(0);
});

test("após esclarecimento, próxima mensagem é tratada como nova (sem contexto pendente)", async () => {
  const r1 = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "mercado",
    external_id: "ig-n1",
  });
  expect(r1.status).toBe("consulta");
  const r2 = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Uber 48,90",
    external_id: "ig-n2",
  });
  expect(r2.status).toBe("aguardando_forma_pagamento");
  expect(state.pendingRow?.parsed?.valor).toBe(48.9);
  expect(state.pendingRow?.parsed?.nome).toMatch(/uber/i);
});

test("após pergunta de capacidade, lançamento seguinte funciona normalmente", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "GI, você entende esse áudio?",
    external_id: "ig-p1",
    source: "audio",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "gastei 30 na farmácia",
    external_id: "ig-p2",
    source: "audio",
  });
  expect(r.status).toBe("aguardando_forma_pagamento");
  expect(state.pendingRow?.parsed?.valor).toBe(30);
});

test("fluxo de gasto com valor continua intacto (confirmação preservada)", async () => {
  const r1 = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "gastei 48,90 no mercado",
    external_id: "ig-f1",
  });
  expect(r1.status).toBe("aguardando_forma_pagamento");
  const r2 = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "pix",
    external_id: "ig-f2",
  });
  expect(r2.status).toBe("aguardando_confirmacao");
  const r3 = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "confirmar",
    external_id: "ig-f3",
  });
  expect(r3.status).toBe("salva");
  expect(state.gastosData.length).toBe(1);
  expect(state.gastosData[0]?.valor).toBe(48.9);
});
