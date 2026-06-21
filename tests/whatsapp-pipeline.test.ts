/**
 * Testes de integração do pipeline processarMensagemWhatsApp.
 *
 * Garante que NENHUM gasto é gravado em `gastos` antes da confirmação
 * explícita do usuário (sim/salvar/confirmar/ok/✅).
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState, gastosInserts } from "./_whatsapp-fake";

const { processarMensagemWhatsApp } = await import(
  "../src/server/whatsapp.server"
);

const tel = "5511999998888";

beforeEach(() => {
  resetState();
});

test("Pix completo NÃO grava gasto antes da confirmação", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Paguei R$ 18 no pix hoje no lanche",
    external_id: "ext-pix-1",
  });
  expect(r.status).toBe("aguardando_confirmacao");
  expect(gastosInserts()).toHaveLength(0);
  expect(state.pendingRow).not.toBeNull();
});

test("Débito completo NÃO grava gasto antes da confirmação", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Comprei remédio R$ 42,50 no débito hoje",
    external_id: "ext-deb-1",
  });
  expect(r.status).toBe("aguardando_confirmacao");
  expect(gastosInserts()).toHaveLength(0);
});

test("Cartão de crédito completo NÃO grava gasto antes da confirmação", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Gastei R$ 35,90 no mercado hoje no cartão Nubank",
    external_id: "ext-cred-1",
  });
  expect(r.status).toBe("aguardando_confirmacao");
  expect(gastosInserts()).toHaveLength(0);
});

test("Confirmação 'sim' sem pendência NÃO grava gasto", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "ext-sim-vazio",
  });
  expect(r.status).toBe("sem_pendencia");
  expect(gastosInserts()).toHaveLength(0);
});

test("Cancelamento descarta pendência sem gravar gasto", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Gastei R$ 35,90 no mercado hoje no cartão Nubank",
    external_id: "n-1",
  });
  expect(state.pendingRow).not.toBeNull();
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "não",
    external_id: "n-2",
  });
  expect(r.status).toBe("cancelada");
  expect(gastosInserts()).toHaveLength(0);
  expect(state.pendingRow).toBeNull();
});

test("Confirmação cria UM gasto e segunda confirmação NÃO duplica", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Gastei R$ 35,90 no mercado hoje no cartão Nubank",
    external_id: "d-1",
  });
  const r1 = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "d-2",
  });
  expect(r1.status).toBe("salva");
  expect(gastosInserts()).toHaveLength(1);

  const r2 = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "d-3",
  });
  expect(r2.status).toBe("sem_pendencia");
  expect(gastosInserts()).toHaveLength(1);
});

test("Nova despesa com pendência ativa avisa e NÃO grava gasto", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Gastei R$ 35,90 no mercado hoje no cartão Nubank",
    external_id: "p-1",
  });
  expect(state.pendingRow).not.toBeNull();
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Uber R$ 27 hoje no pix",
    external_id: "p-2",
  });
  expect(r.status).toBe("pendente");
  expect(r.resposta).toMatch(/n[aã]o entendi/i);
  expect(gastosInserts()).toHaveLength(0);
  expect(state.pendingRow).not.toBeNull();
});

test("Confirmação salva como Pix (forma=pix, sem cartão)", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Paguei R$ 18 no pix hoje no lanche",
    external_id: "fp-pix-1",
  });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "fp-pix-2",
  });
  const gasto = gastosInserts()[0]?.row;
  expect(gasto?.forma_pagamento).toBe("pix");
  expect(gasto?.cartao_id).toBeNull();
});

test("Confirmação salva como débito (forma=debito, sem cartão)", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Comprei remédio R$ 42,50 no débito hoje",
    external_id: "fp-deb-1",
  });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "fp-deb-2",
  });
  const gasto = gastosInserts()[0]?.row;
  expect(gasto?.forma_pagamento).toBe("debito");
  expect(gasto?.cartao_id).toBeNull();
});

test("Confirmação salva como crédito vincula cartao_id correto", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Gastei R$ 35,90 no mercado hoje no cartão Nubank",
    external_id: "fp-cred-1",
  });
  await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "fp-cred-2",
  });
  const gasto = gastosInserts()[0]?.row;
  expect(gasto?.forma_pagamento).toBe("credito");
  expect(gasto?.cartao_id).toBe("c-nu");
});

test("Variantes de confirmação salvam o gasto", async () => {
  for (const palavra of ["ok", "salvar", "confirmar", "✅"]) {
    resetState();
    await processarMensagemWhatsApp({
      telefone: tel,
      texto: "Paguei R$ 18 no pix hoje no lanche",
      external_id: `v-${palavra}-1`,
    });
    const r = await processarMensagemWhatsApp({
      telefone: tel,
      texto: palavra,
      external_id: `v-${palavra}-2`,
    });
    expect(r.status).toBe("salva");
    expect(gastosInserts()).toHaveLength(1);
  }
});
