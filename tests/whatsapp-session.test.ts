/**
 * Testes da máquina de estados conversacional do WhatsApp:
 * persistência de contexto entre mensagens, fluxo cartão cadastrado vs
 * não cadastrado, cancelamento, dedupe, sessão expirada e match por
 * nome/banco/últimos 4 dígitos.
 */
import { test, expect, beforeEach, mock } from "bun:test";
import { state, resetState, gastosInserts } from "./_whatsapp-fake";

// WA-C11: Mock entitlement for session tests
mock.module("@/server/whatsapp-entitlement.server", () => ({
  getWhatsAppEntitlement: async () => ({
    allowed: true,
    reason: "allowed",
    plan: "pessoal_premium",
    planActive: true,
    featureIncluded: true,
    betaAllowed: true,
    adminMaster: false,
    linkActive: true,
    optInActive: true,
    checkedAt: new Date().toISOString(),
  }),
}));

const { processarMensagemWhatsApp, matchCartao, maskCartaoLabel } = await import(
  "../src/server/whatsapp.server"
);

const tel = "5511999998888";

function cartoesNubankInter(): Record<string, unknown>[] {
  return [
    {
      id: "c-nu", nome: "Nubank", banco: "Nubank",
      limite_total: 0, dia_fechamento: 1, dia_vencimento: 10, cor: "#000",
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
    {
      id: "c-inter", nome: "Inter 5678", banco: "Inter",
      limite_total: 0, dia_fechamento: 1, dia_vencimento: 10, cor: "#000",
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
  ];
}

beforeEach(() => {
  resetState({ cartoes: cartoesNubankInter() });
});

test("fluxo cartão cadastrado por nome (Mercado → cartão → Nubank → sim)", async () => {
  const r1 = await processarMensagemWhatsApp({
    telefone: tel, texto: "Mercado 45,90", external_id: "a1",
  });
  expect(r1.status).toBe("aguardando_forma_pagamento");
  expect(r1.resposta).toMatch(/pix.*dinheiro.*d[eé]bito.*cart[aã]o/i);
  expect(state.pendingRow?.parsed?.valor).toBe(45.9);

  const r2 = await processarMensagemWhatsApp({
    telefone: tel, texto: "cartão", external_id: "a2",
  });
  expect(r2.status).toBe("aguardando_cartao");
  expect(r2.resposta).toMatch(/qual cart[aã]o/i);
  expect(state.pendingRow?.parsed?.valor).toBe(45.9);
  expect(state.pendingRow?.parsed?.formaPagamento).toBe("credito");

  const r3 = await processarMensagemWhatsApp({
    telefone: tel, texto: "Nubank", external_id: "a3",
  });
  expect(r3.status).toBe("aguardando_confirmacao");
  expect(state.pendingRow?.parsed?.cartaoId).toBe("c-nu");
  expect(state.pendingRow?.parsed?.valor).toBe(45.9);

  const r4 = await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "a4",
  });
  expect(r4.status).toBe("salva");
  expect(gastosInserts()).toHaveLength(1);
  expect(gastosInserts()[0].row.forma_pagamento).toBe("credito");
  expect(gastosInserts()[0].row.cartao_id).toBe("c-nu");
  expect(gastosInserts()[0].row.valor).toBe(45.9);
});

test("cartão não cadastrado: registra sem criar cartão automaticamente", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 45,90", external_id: "b1" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "cartão", external_id: "b2" });
  const r3 = await processarMensagemWhatsApp({
    telefone: tel, texto: "Cartão da minha mãe", external_id: "b3",
  });
  expect(r3.status).toBe("aguardando_confirmacao");
  expect(r3.resposta).toMatch(/n[aã]o encontrei/i);
  expect(r3.resposta).toMatch(/cart[aã]o n[aã]o cadastrado/i);
  expect(state.pendingRow?.parsed?.cartaoNaoCadastrado).toBe(true);
  expect(state.pendingRow?.parsed?.cartaoId).toBeNull();

  const r4 = await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "b4",
  });
  expect(r4.status).toBe("salva");
  expect(gastosInserts()).toHaveLength(1);
  expect(gastosInserts()[0].row.cartao_id).toBeNull();
  expect(gastosInserts()[0].row.forma_pagamento).toBe("credito");
  expect(state.inserts.find((i) => i.table === "cartoes")).toBeUndefined();
});

test("Mercado 45,90 → pix → sim", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 45,90", external_id: "p1" });
  const r2 = await processarMensagemWhatsApp({ telefone: tel, texto: "pix", external_id: "p2" });
  expect(r2.status).toBe("aguardando_confirmacao");
  const r3 = await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "p3" });
  expect(r3.status).toBe("salva");
  expect(gastosInserts()[0].row.forma_pagamento).toBe("pix");
  expect(gastosInserts()[0].row.cartao_id).toBeNull();
});

test("cancelamento durante fluxo cartão não cria gasto", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 45,90", external_id: "c1" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "cartão", external_id: "c2" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "Nubank", external_id: "c3" });
  const r4 = await processarMensagemWhatsApp({ telefone: tel, texto: "não", external_id: "c4" });
  expect(r4.status).toBe("cancelada");
  expect(gastosInserts()).toHaveLength(0);
  expect(state.pendingRow).toBeNull();
});

test("mensagem duplicada pelo webhook não cria gasto duplicado", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 45,90 pix", external_id: "w1" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "w2" });
  expect(gastosInserts()).toHaveLength(1);
  const dup = await processarMensagemWhatsApp({
    telefone: tel, texto: "sim", external_id: "w2",
  });
  expect(dup.status).toBe("duplicada");
  expect(gastosInserts()).toHaveLength(1);
});

test("sim repetido sem pendência não cria nada", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 45,90 pix", external_id: "s1" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "s2" });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "sim", external_id: "s3" });
  expect(r.status).toBe("sem_pendencia");
  expect(gastosInserts()).toHaveLength(1);
});

test("sessão expirada: nova mensagem é tratada como novo gasto", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 45,90", external_id: "e1" });
  state.pendingRow = null; // simula TTL expirado
  const r = await processarMensagemWhatsApp({
    telefone: tel, texto: "Uber 20 pix", external_id: "e2",
  });
  expect(r.status).toBe("aguardando_confirmacao");
});

test("telefone sem vínculo recebe 'sem_vinculo' sem salvar nada", async () => {
  resetState({ cartoes: cartoesNubankInter(), link: null });
  const r = await processarMensagemWhatsApp({
    telefone: "5511000000000", texto: "Mercado 45,90", external_id: "u1",
  });
  expect(r.status).toBe("sem_vinculo");
  expect(gastosInserts()).toHaveLength(0);
  expect(state.inserts.find((i) => i.table === "whatsapp_messages")).toBeUndefined();
});

test("matchCartao identifica por últimos 4 dígitos / nome / banco", () => {
  const cartoes = [
    { id: "c1", nome: "Nubank", banco: "Nubank", limiteTotal: 0, diaFechamento: 1, diaVencimento: 10, cor: "#000", criadoEm: "", atualizadoEm: "" },
    { id: "c2", nome: "Inter 5678", banco: "Inter", limiteTotal: 0, diaFechamento: 1, diaVencimento: 10, cor: "#000", criadoEm: "", atualizadoEm: "" },
  ];
  expect(matchCartao("5678", cartoes).match?.id).toBe("c2");
  expect(matchCartao("nubank", cartoes).match?.id).toBe("c1");
  expect(matchCartao("inter", cartoes).match?.id).toBe("c2");
  expect(matchCartao("xpto", cartoes).match).toBeNull();
});

test("maskCartaoLabel nunca expõe número completo", () => {
  expect(
    maskCartaoLabel({
      id: "x", nome: "Nubank 1234", banco: "Nubank", limiteTotal: 0,
      diaFechamento: 1, diaVencimento: 10, cor: "#000", criadoEm: "", atualizadoEm: "",
    }),
  ).toBe("Nubank •••• 1234");
  expect(
    maskCartaoLabel({
      id: "x", nome: "Cartão Itaú", banco: "Itaú", limiteTotal: 0,
      diaFechamento: 1, diaVencimento: 10, cor: "#000", criadoEm: "", atualizadoEm: "",
    }),
  ).toMatch(/Itaú/);
});

test("cartão cadastrado por nome reconhece Inter", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 45,90", external_id: "i1" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "cartão", external_id: "i2" });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "inter", external_id: "i3" });
  expect(r.status).toBe("aguardando_confirmacao");
  expect(state.pendingRow?.parsed?.cartaoId).toBe("c-inter");
});

test("cartão cadastrado por últimos 4 dígitos no fluxo", async () => {
  await processarMensagemWhatsApp({ telefone: tel, texto: "Mercado 45,90", external_id: "d1" });
  await processarMensagemWhatsApp({ telefone: tel, texto: "cartão", external_id: "d2" });
  const r = await processarMensagemWhatsApp({ telefone: tel, texto: "5678", external_id: "d3" });
  expect(r.status).toBe("aguardando_confirmacao");
  expect(state.pendingRow?.parsed?.cartaoId).toBe("c-inter");
});
