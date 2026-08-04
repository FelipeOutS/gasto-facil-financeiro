import { test, expect, beforeEach, mock } from "bun:test";
import { state, resetState, gastosInserts } from "./_whatsapp-fake";

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");

const tel = "5511999998888";

beforeEach(() => {
  resetState();
  state.cartoesData = [
    { id: "c-nu", nome: "Nubank", banco: "Nubank", cor: "#000", diaFechamento: 1, diaVencimento: 10, limiteTotal: 0, criadoEm: "", atualizadoEm: "" },
    { id: "c-inter", nome: "Inter 5678", banco: "Inter", cor: "#000", diaFechamento: 1, diaVencimento: 10, limiteTotal: 0, criadoEm: "", atualizadoEm: "" },
  ];
});

test("fluxo cartão cadastrado por nome (Mercado → cartão → Nubank → sim)", async () => {
  const r1 = await processarMensagemWhatsApp({
    telefone: tel, texto: "Mercado 45,90", external_id: "a1",
  });
  expect(r1.status).toBe("aguardando_forma_pagamento");

  await processarMensagemWhatsApp({
    telefone: tel, texto: "cartão", external_id: "a2",
  });
  
  await processarMensagemWhatsApp({
    telefone: tel, texto: "Nubank", external_id: "a3",
  });

  const r4 = await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "a4",
  });
  expect(r4.status).toBe("salva");
  expect(gastosInserts()).toHaveLength(1);
});

test("cartão não cadastrado: registra sem criar cartão automaticamente", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 45,90", external_id: "b1" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "cartão", external_id: "b2" });
  const r3 = await processarMensagemWhatsApp({
    telefone: tel, texto: "Cartão da minha mãe", external_id: "b3",
  });
  expect(r3.status).toBe("aguardando_confirmacao");
  expect(state.pendingRow?.session?.cartaoNaoCadastrado).toBe(true);

  const r4 = await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "b4",
  });
  expect(r4.status).toBe("salva");
  expect(gastosInserts()).toHaveLength(1);
});

test("Mercado 45,90 → pix → sim", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 45,90", external_id: "p1" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "pix", external_id: "p2" });
  const r3 = await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "p3" });
  expect(r3.status).toBe("salva");
  expect(gastosInserts()[0].row.forma_pagamento).toBe("pix");
});

test("cancelamento durante fluxo cartão não cria gasto", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 45,90", external_id: "c1" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "cartão", external_id: "c2" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "Nubank", external_id: "c3" });
  const r4 = await processarMensagemWhatsApp({ telefone: tel, texto: "não", external_id: "c4" });
  expect(r4.status).toBe("cancelada");
  expect(gastosInserts()).toHaveLength(0);
});

test("mensagem duplicada pelo webhook não cria gasto duplicado", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 45,90 pix", external_id: "w1" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "w2" });
  expect(gastosInserts()).toHaveLength(1);
  const dup = await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "w2",
  });
  expect(dup.status).toBe("sem_pendencia");
  expect(gastosInserts()).toHaveLength(1);
});

test("sim repetido sem pendência não cria nada", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 45,90 pix", external_id: "s1" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "s2" });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "s3" });
  expect(r.status).toBe("sem_pendencia");
  expect(gastosInserts()).toHaveLength(1);
});
