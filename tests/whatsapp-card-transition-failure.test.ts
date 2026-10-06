import { test, expect } from "bun:test";
import { fakeAdmin, resetState, state, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();
const { tratarCadastroCartao } = await import("../src/server/whatsapp-cartao-cadastro.server");

test("falha ao criar sessão de cartão preserva gasto anterior e permite retry", async () => {
  resetState({ cartoes: [] });
  const original = {
    id: "gasto-pendente-1",
    user_id: "u1",
    telefone: "5511999998888",
    status: "aguardando_confirmacao",
    recebida_em: new Date().toISOString(),
    parsed: { kind: "gasto", nome: "Mercado", valor: 25 },
  };
  state.generic.whatsapp_messages = [original];
  const input = {
    userId: "u1",
    telefone: original.telefone,
    externalId: "wamid-card-1",
    texto: "cadastrar",
    recebidaEm: new Date().toISOString(),
    cartoes: [],
    resumoGasto: () => "Mercado R$ 25",
    retomarGasto: async () => ({ status: "cartao_cadastro", resposta: "retomado" }),
    iniciarGastoComCartao: async () => null,
    sessaoGastoNaoCadastrado: { id: original.id, session: original.parsed },
    temOutraSessao: true,
  };
  state.failNextCardTransition = true;
  const failed = await tratarCadastroCartao(input);
  expect(failed?.resposta).toContain("Seu cadastro foi mantido");
  expect(state.generic.whatsapp_messages[0].status).toBe("aguardando_confirmacao");
  expect(state.generic.whatsapp_messages).toHaveLength(1);
  expect(state.inserts.filter((item) => item.table === "cartoes")).toHaveLength(0);
  const retried = await tratarCadastroCartao(input);
  expect(retried?.status).toBe("cartao_cadastro");
  expect(state.generic.whatsapp_messages[0].status).toBe("expirada");
  expect(state.generic.whatsapp_messages.some((row) => row.status === "cartao_cad_coleta")).toBe(true);
  expect(state.inserts.filter((item) => item.table === "cartoes")).toHaveLength(0);
});

test("duas mensagens rápidas não deixam duas sessões de cartão ativas", async () => {
  resetState({ cartoes: [] });
  state.generic.whatsapp_messages = [];
  const base = {
    userId: "u1",
    telefone: "5511999998888",
    texto: "cadastrar cartão",
    recebidaEm: new Date().toISOString(),
    cartoes: [],
    resumoGasto: () => "",
    retomarGasto: async () => ({ status: "cartao_cadastro", resposta: "retomado" }),
    iniciarGastoComCartao: async () => null,
    temOutraSessao: false,
  };
  await Promise.all([
    tratarCadastroCartao({ ...base, externalId: "wamid-fast-1" }),
    tratarCadastroCartao({ ...base, externalId: "wamid-fast-2" }),
  ]);
  const active = state.generic.whatsapp_messages.filter((row) => row.status === "cartao_cad_coleta");
  expect(active).toHaveLength(1);
});

test("timeout depois do commit permite retry sem duplicar sessão", async () => {
  resetState({ cartoes: [] });
  const input = {
    userId: "u1",
    telefone: "5511999998888",
    externalId: "wamid-timeout",
    texto: "cadastrar cartão",
    recebidaEm: new Date().toISOString(),
    cartoes: [],
    resumoGasto: () => "",
    retomarGasto: async () => ({ status: "cartao_cadastro", resposta: "retomado" }),
    iniciarGastoComCartao: async () => null,
    temOutraSessao: false,
  };
  const original = fakeAdmin.rpc;
  fakeAdmin.rpc = (async (name: string, args: unknown) => {
    const result = await original(name, args);
    if (name === "whatsapp_advance_card_session") return { data: null, error: { code: "timeout" } };
    return result;
  }) as typeof fakeAdmin.rpc;
  try {
    const first = await tratarCadastroCartao(input);
    expect(first?.resposta).toContain("Seu cadastro foi mantido");
  } finally {
    fakeAdmin.rpc = original;
  }
  const retried = await tratarCadastroCartao(input);
  expect(retried?.resposta).toContain("nome");
  expect(state.generic.whatsapp_messages.filter((row) => row.status === "cartao_cad_coleta")).toHaveLength(1);
});
