/**
 * WA-Q-ContasReceber — listagem de contas a receber pendentes via WhatsApp.
 *
 * Frases de consulta NÃO podem abrir sessão de criação de receita/gasto
 * nem escrever em nenhuma tabela financeira.
 */
import { test, expect, describe, beforeEach } from "bun:test";
import { state, useWhatsAppFakeMocks } from "./_whatsapp-fake";
useWhatsAppFakeMocks();

const { detectConsultaIntent, handleConsulta } =
  await import("../src/server/whatsapp-consultas.server");

const USER = "u1";

beforeEach(() => {
  state.inserts = [];
  state.gastosData = [];
  state.receitasData = [];
  state.recorrenciasData = [];
  state.contasData = [];
  state.contasReceberData = [];
});

describe("WA-Q-ContasReceber — detecção de intenção", () => {
  const frases = [
    "contas a receber",
    "Contas a Receber",
    "conta a receber",
    "o que tenho a receber",
    "o que eu tenho para receber",
    "o que tenho pra receber",
    "meus recebimentos pendentes",
    "valores a receber",
    "valor a receber",
    "quem me deve",
    "quem está me devendo",
    "listar minhas contas a receber",
    "ver minhas contas a receber",
    "minhas contas a receber",
  ];
  for (const f of frases) {
    test(`'${f}' → listar_contas_receber`, () => {
      expect(detectConsultaIntent(f)).toBe("listar_contas_receber");
    });
  }

  test("não confunde com 'contas a pagar'", () => {
    expect(detectConsultaIntent("contas a pagar")).toBeNull();
  });
  test("não confunde com 'minhas recorrências'", () => {
    expect(detectConsultaIntent("minhas recorrências")).toBe("listar_recorrencias");
  });
  test("não confunde com 'minhas receitas'", () => {
    expect(detectConsultaIntent("minhas receitas")).toBe("listar_receitas_mes");
  });
});

describe("WA-Q-ContasReceber — handler é 100% read-only", () => {
  test("sem contas: resposta amigável, sem pedir valor/tipo", async () => {
    const out = await handleConsulta(USER, "listar_contas_receber");
    expect(out.status).toBe("consulta");
    expect(out.resposta).toMatch(/não tem contas a receber pendentes/i);
    expect(out.resposta).not.toMatch(/qual foi o valor/i);
    expect(out.resposta).not.toMatch(/que tipo de renda/i);
    expect(state.inserts.length).toBe(0);
  });

  test("filtra por status pendente/parcial; exclui recebido/cancelado e outros usuários", async () => {
    state.contasReceberData = [
      {
        id: "c1",
        user_id: USER,
        titulo: "Freela site",
        pagador_nome: "ACME",
        valor_total: 1000,
        valor_restante: 1000,
        data_prevista: "2026-07-15",
        status: "pendente",
      },
      {
        id: "c2",
        user_id: USER,
        titulo: "Consultoria",
        pagador_nome: null,
        valor_total: 500,
        valor_restante: 200,
        data_prevista: "2026-07-05",
        status: "parcial",
      },
      {
        id: "c3",
        user_id: USER,
        titulo: "Já recebido",
        pagador_nome: null,
        valor_total: 100,
        valor_restante: 0,
        data_prevista: "2026-06-10",
        status: "recebido",
      },
      {
        id: "c4",
        user_id: USER,
        titulo: "Cancelado",
        pagador_nome: null,
        valor_total: 300,
        valor_restante: 300,
        data_prevista: "2026-06-20",
        status: "cancelado",
      },
      {
        id: "c5",
        user_id: "outro",
        titulo: "Não é meu",
        pagador_nome: null,
        valor_total: 999,
        valor_restante: 999,
        data_prevista: "2026-07-01",
        status: "pendente",
      },
    ];
    const out = await handleConsulta(USER, "listar_contas_receber");
    expect(out.resposta).toMatch(/Freela site/);
    expect(out.resposta).toMatch(/Consultoria/);
    expect(out.resposta).not.toMatch(/Já recebido/);
    expect(out.resposta).not.toMatch(/Cancelado/);
    expect(out.resposta).not.toMatch(/Não é meu/);
    expect(out.resposta).toMatch(/pendentes 💰 \(2\)/);
    // Ordenação ASC por data_prevista: Consultoria (05/07) antes de Freela (15/07)
    expect(out.resposta.indexOf("Consultoria")).toBeLessThan(out.resposta.indexOf("Freela site"));
    // Total pendente soma valor_restante
    expect(out.resposta).toMatch(/Total pendente:/);
    expect(state.inserts.length).toBe(0);
  });

  test("marca conta com data_prevista no passado como atrasada", async () => {
    state.contasReceberData = [
      {
        id: "c1",
        user_id: USER,
        titulo: "Atrasada",
        pagador_nome: "X",
        valor_total: 100,
        valor_restante: 100,
        data_prevista: "2020-01-01",
        status: "pendente",
      },
    ];
    const out = await handleConsulta(USER, "listar_contas_receber");
    expect(out.resposta).toMatch(/atrasada/i);
    expect(state.inserts.length).toBe(0);
  });
});
