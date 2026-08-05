/**
 * WA — "cancelar" como comando de reinício geral da conversa.
 *
 * Garante que:
 *  - aliases (cancelar, reiniciar, recomeçar, começar de novo, ...) são
 *    reconhecidos e devolvem sempre a mesma mensagem;
 *  - qualquer sessão pendente (gasto, receita, recorrência, cartão,
 *    confirmação) é encerrada;
 *  - sem sessão ativa, ainda assim responde com a mensagem de reinício;
 *  - após reset, a próxima mensagem inicia um fluxo limpo;
 *  - lançamentos já confirmados NÃO são apagados.
 */
import { test, expect, beforeEach } from "bun:test";
import { state, resetState, gastosInserts, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp, isResetCommand } = await import("../src/server/whatsapp.server");

const tel = "5511999998888";

beforeEach(() => {
  resetState();
});

const RESET_MSG = /vamos começar de novo/i;

test("isResetCommand reconhece todos os aliases especificados", () => {
  const aliases = [
    "cancelar",
    "Cancelar",
    "CANCELAR",
    "cancelar.",
    "cancela",
    "cancelar tudo",
    "reiniciar",
    "recomeçar",
    "recomecar",
    "começar de novo",
    "comecar de novo",
    "voltar ao início",
    "voltar ao inicio",
  ];
  for (const a of aliases) {
    expect(isResetCommand(a)).toBe(true);
  }
  // não é reset
  for (const a of ["não", "nao", "n", "errado", "ignora", "oi", "menu"]) {
    expect(isResetCommand(a)).toBe(false);
  }
});

test("cancelar sem sessão ativa devolve mensagem de reinício", async () => {
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "cancelar",
    external_id: "r0",
  });
  expect(r.status).toBe("cancelada");
  expect(r.resposta).toMatch(RESET_MSG);
  expect(r.resposta).not.toMatch(/Não tem nada em andamento/i);
});

test("cancelar durante lançamento de gasto (aguardando forma) encerra sessão", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Uber 48,90",
    external_id: "g-a",
  });
  expect(state.pendingRow?.status).toBe("aguardando_forma_pagamento");
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "cancelar",
    external_id: "g-b",
  });
  expect(r.status).toBe("cancelada");
  expect(r.resposta).toMatch(RESET_MSG);
  expect(state.pendingRow).toBeNull();
  expect(gastosInserts()).toHaveLength(0);
});

test("cancelar durante escolha de cartão encerra sessão", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Mercado 30",
    external_id: "k-a",
  });
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "cartão",
    external_id: "k-b",
  });
  expect(state.pendingRow?.status).toBe("aguardando_cartao");
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "cancelar",
    external_id: "k-c",
  });
  expect(r.status).toBe("cancelada");
  expect(r.resposta).toMatch(RESET_MSG);
  expect(state.pendingRow).toBeNull();
});

test("cancelar durante confirmação final de gasto encerra sessão", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Mercado 30 pix",
    external_id: "c-a",
  });
  expect(state.pendingRow?.status).toBe("aguardando_confirmacao");
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "cancelar",
    external_id: "c-b",
  });
  expect(r.status).toBe("cancelada");
  expect(r.resposta).toMatch(RESET_MSG);
  expect(state.pendingRow).toBeNull();
  expect(gastosInserts()).toHaveLength(0);
});

test("cancelar durante lançamento de receita encerra sessão", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Recebi salário",
    external_id: "rec-a",
  });
  expect(state.pendingRow?.parsed?.kind).toBe("receita");
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "cancelar",
    external_id: "rec-b",
  });
  expect(r.status).toBe("cancelada");
  expect(r.resposta).toMatch(RESET_MSG);
  expect(state.pendingRow).toBeNull();
});

test("cancelar durante fluxo de receita recorrente encerra sessão", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Recebi 1500 de salário",
    external_id: "rr-a",
  });
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "rr-b",
  });
  // agora está em alguma etapa rec_aguardando_* da recorrência
  expect(state.pendingRow?.status).toMatch(/^rec_aguardando/);
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "cancelar",
    external_id: "rr-c",
  });
  expect(r.status).toBe("cancelada");
  expect(r.resposta).toMatch(RESET_MSG);
  expect(state.pendingRow).toBeNull();
});

test("cancelar durante sessão de gasto sem descrição/valor encerra sessão", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "registrar gasto",
    external_id: "gen-a",
  });
  expect(state.pendingRow?.status).toBe("aguardando_descricao_e_valor_gasto");
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "cancelar",
    external_id: "gen-b",
  });
  expect(r.status).toBe("cancelada");
  expect(r.resposta).toMatch(RESET_MSG);
  expect(state.pendingRow).toBeNull();
});

test("aliases reiniciar / recomeçar / começar de novo também resetam", async () => {
  for (const cmd of ["reiniciar", "recomeçar", "começar de novo", "voltar ao início"]) {
    resetState();
    await processarMensagemWhatsApp({
      telefone: tel,
      texto: "Uber 29,90",
      external_id: `${cmd}-a`,
    });
    const r = await processarMensagemWhatsApp({
      telefone: tel,
      texto: cmd,
      external_id: `${cmd}-b`,
    });
    expect(r.status).toBe("cancelada");
    expect(r.resposta).toMatch(RESET_MSG);
    expect(state.pendingRow).toBeNull();
    expect(gastosInserts()).toHaveLength(0);
  }
});

test("após cancelar, próxima mensagem inicia fluxo limpo de gasto", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Mercado 100 pix",
    external_id: "f-a",
  });
  expect(state.pendingRow?.status).toBe("aguardando_confirmacao");
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "cancelar",
    external_id: "f-b",
  });
  expect(state.pendingRow).toBeNull();
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Uber 29,90",
    external_id: "f-c",
  });
  expect(r.status).toBe("aguardando_forma_pagamento");
  expect(state.pendingRow?.parsed?.valor).toBe(29.9);
  // não traz nenhum dado do gasto anterior (Mercado / 100)
  expect(state.pendingRow?.parsed?.nome).not.toMatch(/mercado/i);
});

test("cancelar não apaga gasto já confirmado", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Mercado 30 pix",
    external_id: "s-a",
  });
  const r = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "s-b",
  });
  expect(r.status).toBe("salva");
  expect(gastosInserts()).toHaveLength(1);
  const insertedGastos = gastosInserts().length;

  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "cancelar",
    external_id: "s-c",
  });
  // nenhum DELETE em gastos foi disparado e nada novo foi inserido
  expect(gastosInserts()).toHaveLength(insertedGastos);
  const deletes = state.inserts.filter(
    (i) => i.table === "gastos" && (i.row as Record<string, unknown>)._op === "delete",
  );
  expect(deletes).toHaveLength(0);
});

test("cancelar não apaga receita já confirmada", async () => {
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "Recebi 500 de freelancer",
    external_id: "rc-a",
  });
  // não recorrente → vai para confirmação
  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "não",
    external_id: "rc-b",
  });
  expect(state.pendingRow?.status).toBe("rec_aguardando_confirmacao");
  const rconf = await processarMensagemWhatsApp({
    telefone: tel,
    texto: "sim",
    external_id: "rc-c",
  });
  expect(rconf.status).toBe("salva");
  const receitasAntes = state.inserts.filter((i) => i.table === "receitas").length;
  expect(receitasAntes).toBeGreaterThan(0);

  await processarMensagemWhatsApp({
    telefone: tel,
    texto: "cancelar",
    external_id: "rc-d",
  });
  const receitasDepois = state.inserts.filter((i) => i.table === "receitas").length;
  expect(receitasDepois).toBe(receitasAntes);
});
