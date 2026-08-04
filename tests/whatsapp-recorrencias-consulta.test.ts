/**
 * WA-Q-Recorrencias — listagem de recorrências ativas via WhatsApp.
 *
 * Frases de consulta NÃO podem abrir sessão de criação de gasto/receita
 * nem escrever em nenhuma tabela financeira.
 */
import { test, expect, describe, beforeEach } from "bun:test";
import { state } from "./_whatsapp-fake";

const { detectConsultaIntent, handleConsulta } =
  await import("../src/server/whatsapp-consultas.server");

const USER = "u1";

beforeEach(() => {
  state.inserts = [];
  state.gastosData = [];
  state.receitasData = [];
  state.recorrenciasData = [];
  state.contasData = [];
});

describe("WA-Q-Recorrencias — detecção de intenção", () => {
  const frases = [
    "minhas recorrências",
    "Minhas Recorrências",
    "quais são minhas recorrências",
    "recorrências ativas",
    "meus pagamentos recorrentes",
    "minhas receitas recorrentes",
    "minhas despesas recorrentes",
    "minhas contas recorrentes",
    "listar recorrências",
    "ver minhas recorrências",
    "minhas assinaturas",
    "assinaturas ativas",
  ];
  for (const f of frases) {
    test(`'${f}' → listar_recorrencias`, () => {
      expect(detectConsultaIntent(f)).toBe("listar_recorrencias");
    });
  }

  test("não confunde com 'gastos por categoria'", () => {
    expect(detectConsultaIntent("gastos por categoria")).toBe("gastos_por_categoria_mes");
  });
  test("não confunde com 'limites'", () => {
    expect(detectConsultaIntent("limites")).toBe("orcamento_mes");
  });
});

describe("WA-Q-Recorrencias — handler não escreve nada", () => {
  test("sem recorrências ativas: resposta amigável, sem pedir valor", async () => {
    const out = await handleConsulta(USER, "listar_recorrencias");
    expect(out.status).toBe("consulta");
    expect(out.resposta).toMatch(/ainda não tem recorrências ativas/i);
    expect(out.resposta).not.toMatch(/qual foi o valor/i);
    expect(state.inserts.length).toBe(0);
  });

  test("filtra por status='ativa' — excluídas/canceladas não aparecem", async () => {
    state.recorrenciasData = [
      {
        id: "r1",
        user_id: USER,
        nome: "Spotify",
        valor: 23.9,
        frequencia: "mensal",
        proxima_cobranca: "2026-07-05",
        status: "ativa",
        forma_pagamento: "credito",
        categoria_id: "cat-int",
      },
      {
        id: "r2",
        user_id: USER,
        nome: "Netflix antigo",
        valor: 39.9,
        frequencia: "mensal",
        proxima_cobranca: "2026-07-02",
        status: "excluida",
        forma_pagamento: "credito",
        categoria_id: "cat-int",
      },
      {
        id: "r3",
        user_id: USER,
        nome: "Serviço suspeito",
        valor: 10,
        frequencia: "mensal",
        proxima_cobranca: "2026-07-10",
        status: "suspeita",
        forma_pagamento: "credito",
        categoria_id: null,
      },
    ];
    const out = await handleConsulta(USER, "listar_recorrencias");
    expect(out.resposta).toMatch(/Spotify/);
    expect(out.resposta).not.toMatch(/Netflix antigo/);
    expect(out.resposta).not.toMatch(/Serviço suspeito/);
    expect(out.resposta).toMatch(/ativas 🔁 \(1\)/);
    expect(state.inserts.length).toBe(0);
  });

  test("separa receitas (linkadas a receitas.recorrencia_id) e despesas", async () => {
    state.recorrenciasData = [
      {
        id: "r-inc",
        user_id: USER,
        nome: "Salário",
        valor: 3500,
        frequencia: "mensal",
        proxima_cobranca: "2026-07-05",
        status: "ativa",
        forma_pagamento: null,
        categoria_id: null,
      },
      {
        id: "r-exp",
        user_id: USER,
        nome: "Spotify",
        valor: 23.9,
        frequencia: "mensal",
        proxima_cobranca: "2026-07-03",
        status: "ativa",
        forma_pagamento: "credito",
        categoria_id: "cat-int",
      },
    ];
    state.receitasData = [
      { id: "rec-1", user_id: USER, recorrencia_id: "r-inc", valor: 3500, data: "2026-06-05" },
    ];
    const out = await handleConsulta(USER, "listar_recorrencias");
    expect(out.resposta).toMatch(/Receitas recorrentes \(1\)/);
    expect(out.resposta).toMatch(/Despesas recorrentes \(1\)/);
    const salarioIdx = out.resposta.indexOf("Salário");
    const spotifyIdx = out.resposta.indexOf("Spotify");
    const receitasIdx = out.resposta.indexOf("Receitas recorrentes");
    const despesasIdx = out.resposta.indexOf("Despesas recorrentes");
    expect(salarioIdx).toBeGreaterThan(receitasIdx);
    expect(spotifyIdx).toBeGreaterThan(despesasIdx);
    expect(state.inserts.length).toBe(0);
  });
});
