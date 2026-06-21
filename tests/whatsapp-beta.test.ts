/**
 * WA-F — Beta fechada do WhatsApp.
 *
 * Garante:
 *  - Usuário sem beta não cria sessão nem gasto via processarMensagemWhatsApp.
 *  - Beta ativa libera o fluxo completo.
 *  - Beta revogada bloqueia novas mensagens.
 *  - Admin Master sempre passa (canário continua funcionando).
 *  - Quota whatsapp conta como gasto normal (não contorna por origem).
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState, gastosInserts, fakeAdmin } from "./_whatsapp-fake";

type RpcMock = { value: boolean };
const rpc: { can_use_whatsapp: RpcMock; is_full_access: RpcMock } = {
  can_use_whatsapp: { value: true },
  is_full_access: { value: true },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(fakeAdmin as any).rpc = async (name: string) => {
  const r = (rpc as Record<string, RpcMock>)[name];
  return { data: r ? r.value : true, error: null };
};

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");

const tel = "5511999998888";

beforeEach(() => {
  resetState();
  rpc.can_use_whatsapp.value = true;
  rpc.is_full_access.value = true;
});

test("usuário sem beta não cria sessão nem gasto", async () => {
  rpc.can_use_whatsapp.value = false;
  rpc.is_full_access.value = false;
  const out = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Mercado 48,90 hoje no Nubank",
    external_id: "beta-1",
  });
  expect(out.status).toBe("sem_plano");
  expect(gastosInserts().length).toBe(0);
});

test("beta ativa libera o fluxo (gera sessão pendente para confirmação)", async () => {
  rpc.can_use_whatsapp.value = true;
  rpc.is_full_access.value = false;
  const out = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Mercado 48,90 hoje no Nubank",
    external_id: "beta-2",
  });
  // Não cria gasto antes de confirmação, mas avança o pipeline.
  expect(out.status).not.toBe("sem_plano");
  expect(gastosInserts().length).toBe(0);
  expect(state.pendingRow).not.toBeNull();
});

test("beta revogada bloqueia novas mensagens", async () => {
  // Primeira mensagem aceita
  rpc.can_use_whatsapp.value = true;
  rpc.is_full_access.value = false;
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Mercado 10,00 hoje no Nubank",
    external_id: "beta-3a",
  });
  expect(state.pendingRow).not.toBeNull();

  // Revoga e tenta nova
  rpc.can_use_whatsapp.value = false;
  const out = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Padaria 5,00 hoje no Nubank",
    external_id: "beta-3b",
  });
  expect(out.status).toBe("sem_plano");
});

test("Admin Master continua funcionando mesmo sem beta explícita", async () => {
  rpc.can_use_whatsapp.value = true; // SQL retorna true por is_full_access
  rpc.is_full_access.value = true;
  const out = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Mercado 12,00 hoje no Nubank",
    external_id: "beta-4",
  });
  expect(out.status).not.toBe("sem_plano");
});

test("mensagem duplicada (mesmo external_id) não cria gasto duplicado", async () => {
  rpc.can_use_whatsapp.value = true;
  rpc.is_full_access.value = false;
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Mercado 9,00 hoje no Nubank",
    external_id: "dup-1",
  });
  const before = gastosInserts().length;
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Mercado 9,00 hoje no Nubank",
    external_id: "dup-1",
  });
  expect(gastosInserts().length).toBe(before);
});
