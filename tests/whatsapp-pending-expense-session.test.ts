/**
 * WA — Persistência de sessão de gasto após comando genérico
 * ("registrar gasto", "novo gasto", ...).
 *
 * Garante que:
 *  - a sessão é criada com status `aguardando_descricao_e_valor_gasto`
 *    e kind: "gasto" em whatsapp_messages.parsed;
 *  - saudação/menu/ajuda NÃO interrompem essa sessão;
 *  - o pipeline pergunta descrição quando só vem valor e valor quando só
 *    vem descrição;
 *  - "Uber 48,90" durante a sessão segue o lançamento normal;
 *  - "cancelar" encerra a sessão;
 *  - sessão de receita pendente continua tendo prioridade.
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");

const tel = "5511999998888";

beforeEach(() => {
  resetState();
});

test("registrar gasto cria sessão aguardando_descricao_e_valor_gasto", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "registrar gasto",
    external_id: "g1",
  });
  expect(r.resposta).toMatch(/me diga o gasto e o valor/i);
  expect(state.pendingRow?.status).toBe("aguardando_descricao_e_valor_gasto");
  expect(state.pendingRow?.parsed?.kind).toBe("gasto");
});

test("oi durante sessão de gasto pendente mantém sessão e não abre saudação", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "registrar gasto",
    external_id: "g1",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "oi",
    external_id: "g2",
  });
  expect(r.resposta).toMatch(/ainda estou aguardando o gasto e o valor/i);
  expect(r.resposta).not.toMatch(/assistente do gasto inteligente/i);
  expect(state.pendingRow?.status).toBe("aguardando_descricao_e_valor_gasto");
});

test("ajuda durante sessão de gasto pendente mantém sessão", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "registrar gasto",
    external_id: "g1",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "ajuda",
    external_id: "g2",
  });
  expect(r.resposta).toMatch(/ainda estou aguardando o gasto e o valor/i);
  expect(state.pendingRow?.status).toBe("aguardando_descricao_e_valor_gasto");
});

test("menu durante sessão de gasto pendente mantém sessão", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "registrar gasto",
    external_id: "g1",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "menu",
    external_id: "g2",
  });
  expect(r.resposta).toMatch(/ainda estou aguardando o gasto e o valor/i);
  expect(state.pendingRow?.status).toBe("aguardando_descricao_e_valor_gasto");
});

test("48,90 após registrar gasto pede descrição", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "registrar gasto",
    external_id: "g1",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "48,90",
    external_id: "g2",
  });
  expect(r.resposta).toMatch(/esse valor foi de qu[eê]/i);
  expect(state.pendingRow?.status).toBe("aguardando_descricao_e_valor_gasto");
  expect(state.pendingRow?.parsed?.valor).toBe(48.9);
});

test("Uber após registrar gasto pede valor", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "registrar gasto",
    external_id: "g1",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Uber",
    external_id: "g2",
  });
  expect(r.resposta).toMatch(/qual foi o valor de uber/i);
  expect(state.pendingRow?.status).toBe("aguardando_descricao_e_valor_gasto");
  expect(state.pendingRow?.parsed?.nome).toMatch(/uber/i);
});

test("Uber 48,90 após registrar gasto segue para forma de pagamento", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "registrar gasto",
    external_id: "g1",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Uber 48,90",
    external_id: "g2",
  });
  expect(r.status).toBe("aguardando_forma_pagamento");
  expect(r.resposta).toMatch(/pix.*dinheiro.*d[eé]bito.*cart[aã]o/i);
  expect(state.pendingRow?.parsed?.valor).toBe(48.9);
  expect(state.pendingRow?.parsed?.nome).toMatch(/uber/i);
});

test("cancelar encerra a sessão de gasto pendente", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "registrar gasto",
    external_id: "g1",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "cancelar",
    external_id: "g2",
  });
  expect(r.status).toBe("cancelada");
  expect(r.resposta).toMatch(/vamos começar de novo/i);
  expect(state.pendingRow).toBeNull();
});

test("sessão de receita pendente continua prevalecendo sobre saudação", async () => {
  // Inicia receita
  const r1 = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "recebi 500 de freelancer",
    external_id: "r1",
  });
  expect(r1.status).toBe("pendente");
  expect(state.pendingRow?.parsed?.kind).toBe("receita");
  // "oi" não deve disparar saudação — mantém fluxo de receita
  const r2 = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "oi",
    external_id: "r2",
  });
  expect(r2.resposta).not.toMatch(/assistente do gasto inteligente/i);
  expect(state.pendingRow?.parsed?.kind).toBe("receita");
});

test("fluxo direto Uber 48,90 (sem comando genérico) continua funcionando", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Uber 48,90",
    external_id: "d1",
  });
  expect(r.status).toBe("aguardando_forma_pagamento");
  expect(state.pendingRow?.parsed?.valor).toBe(48.9);
});
