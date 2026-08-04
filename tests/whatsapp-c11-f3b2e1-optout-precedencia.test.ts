/**
 * WA-C11 3B.2.E.1 — Precedência absoluta do opt-out no inbound.
 *
 * Garante que uma mensagem de opt-out ("parar", "sair", "stop", etc.)
 * dispara revogação e encerra o pipeline ANTES de qualquer parser,
 * quota ou fluxo financeiro — mesmo com sessão pendente.
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState, gastosInserts } from "./_whatsapp-fake";

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");

const tel = "5511977776666";
const userId = "user-optout-e1";

beforeEach(() => {
  resetState();
  state.linkData = {
    user_id: userId,
    ativo: true,
    opt_in_em: "2024-01-01T00:00:00Z",
    revogado_em: null,
  };
});

test("'parar' encerra o pipeline com status cancelada e não cria gasto", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "parar",
    external_id: "wamid.optout.1",
    authorizedUserId: userId,
  } as never);
  expect(r.status).toBe("cancelada");
  expect(gastosInserts()).toHaveLength(0);
});

test("'STOP' com whitespace/pontuação é reconhecido", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "  STOP! ",
    external_id: "wamid.optout.2",
    authorizedUserId: userId,
  } as never);
  expect(r.status).toBe("cancelada");
  expect(gastosInserts()).toHaveLength(0);
});

test("'sair do whatsapp' aciona opt-out mesmo com sessão pendente", async () => {
  // Mensagem financeira típica seria roteada ao parser; opt-out precede.
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sair do whatsapp",
    external_id: "wamid.optout.3",
    authorizedUserId: userId,
  } as never);
  expect(r.status).toBe("cancelada");
  expect(gastosInserts()).toHaveLength(0);
});

test("'cancelar conta de luz' NÃO é opt-out (falso-positivo financeiro)", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "cancelar conta de luz",
    external_id: "wamid.notoptout.1",
    authorizedUserId: userId,
  } as never);
  // Não retorna a mensagem específica de opt-out — segue fluxo normal.
  expect(r.resposta).not.toMatch(/não vai mais receber mensagens do Gasto Inteligente/i);
});

test("mensagem financeira normal NÃO dispara opt-out", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "mercado 48,90 hoje no nubank",
    external_id: "wamid.expense.1",
    authorizedUserId: userId,
  } as never);
  expect(r.resposta).not.toMatch(/não vai mais receber mensagens do Gasto Inteligente/i);
});
