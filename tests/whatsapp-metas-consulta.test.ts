/**
 * WA-Q-Metas — listagem read-only de metas financeiras via WhatsApp.
 *
 * Frases de consulta NÃO podem abrir sessão de criação de gasto/receita/meta
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
  state.contasReceberData = [];
  state.transferenciasData = [];
  state.metasData = [];
});

describe("WA-Q-Metas — detecção de intenção", () => {
  const frases = [
    "metas",
    "meta",
    "minhas metas",
    "Minhas Metas",
    "minha meta",
    "metas financeiras",
    "minhas metas financeiras",
    "ver metas",
    "listar metas",
    "objetivos",
    "meus objetivos",
    "como estão minhas metas",
    "como estao minhas metas",
    "progresso das minhas metas",
    "progresso de metas",
    "quanto falta para minhas metas",
    "quanto falta pra minha meta",
    "quais são minhas metas",
    "mostrar metas",
    "metas ativas",
  ];
  for (const f of frases) {
    test(`'${f}' → listar_metas`, () => {
      expect(detectConsultaIntent(f)).toBe("listar_metas");
    });
  }

  test("não confunde com 'minhas receitas'", () => {
    expect(detectConsultaIntent("minhas receitas")).toBe("listar_receitas_mes");
  });
  test("não confunde com 'minhas recorrências'", () => {
    expect(detectConsultaIntent("minhas recorrências")).toBe("listar_recorrencias");
  });
  test("não confunde com 'minhas transferências'", () => {
    expect(detectConsultaIntent("minhas transferências")).toBe("listar_transferencias");
  });
  test("frase de criação de gasto NÃO cai em listagem", () => {
    expect(detectConsultaIntent("mercado 48,90")).toBeNull();
  });
});

describe("WA-Q-Metas — handler é 100% read-only", () => {
  test("sem metas: resposta amigável, sem pedir valor/descrição", async () => {
    const out = await handleConsulta(USER, "listar_metas");
    expect(out.status).toBe("consulta");
    expect(out.resposta).toMatch(/ainda não tem metas/i);
    expect(out.resposta).not.toMatch(/qual foi o valor/i);
    expect(out.resposta).not.toMatch(/qual (a )?descri/i);
    expect(state.inserts.length).toBe(0);
  });

  test("meta 100% atingida NÃO aparece na listagem de ativas", async () => {
    state.metasData = [
      {
        id: "m1",
        user_id: USER,
        nome: "Viagem",
        valor_objetivo: 5000,
        valor_atual: 5000,
        prazo: "2026-12-01",
      },
    ];
    const out = await handleConsulta(USER, "listar_metas");
    expect(out.resposta).toMatch(/ainda não tem metas/i);
    expect(state.inserts.length).toBe(0);
  });

  test("lista metas ativas do usuário, isola de outros usuários", async () => {
    state.metasData = [
      {
        id: "m1",
        user_id: USER,
        nome: "Reserva de emergência",
        valor_objetivo: 10000,
        valor_atual: 2500,
        prazo: "2026-12-31",
      },
      {
        id: "m2",
        user_id: USER,
        nome: "Viagem Chile",
        valor_objetivo: 8000,
        valor_atual: 4000,
        prazo: "2026-08-15",
      },
      {
        id: "m3",
        user_id: "outro",
        nome: "Não é minha",
        valor_objetivo: 1000,
        valor_atual: 100,
        prazo: null,
      },
      {
        id: "m4",
        user_id: USER,
        nome: "Concluída",
        valor_objetivo: 2000,
        valor_atual: 2000,
        prazo: null,
      },
    ];
    const out = await handleConsulta(USER, "listar_metas");
    expect(out.resposta).toMatch(/Reserva de emergência/);
    expect(out.resposta).toMatch(/Viagem Chile/);
    expect(out.resposta).not.toMatch(/Não é minha/);
    expect(out.resposta).not.toMatch(/Concluída/);
    // percentuais
    expect(out.resposta).toMatch(/25%/); // 2500/10000
    expect(out.resposta).toMatch(/50%/); // 4000/8000
    // valores
    expect(out.resposta).toMatch(/R\$\s?2\.500,00 de R\$\s?10\.000,00/);
    expect(out.resposta).toMatch(/R\$\s?4\.000,00 de R\$\s?8\.000,00/);
    // faltantes
    expect(out.resposta).toMatch(/Faltam R\$\s?7\.500,00/);
    expect(out.resposta).toMatch(/Faltam R\$\s?4\.000,00/);
    // prazo formatado
    expect(out.resposta).toMatch(/15\/08\/2026/);
    expect(out.resposta).toMatch(/31\/12\/2026/);
    // contagem só de ativas
    expect(out.resposta).toMatch(/\(2\)/);
    expect(state.inserts.length).toBe(0);
  });

  test("ordena por prazo ASC (mais próximo primeiro); metas sem prazo vão para o fim", async () => {
    state.metasData = [
      {
        id: "a",
        user_id: USER,
        nome: "Longe",
        valor_objetivo: 100,
        valor_atual: 1,
        prazo: "2027-06-01",
      },
      {
        id: "b",
        user_id: USER,
        nome: "Perto",
        valor_objetivo: 100,
        valor_atual: 1,
        prazo: "2026-07-10",
      },
      {
        id: "c",
        user_id: USER,
        nome: "SemPrazo",
        valor_objetivo: 100,
        valor_atual: 1,
        prazo: null,
      },
    ];
    const out = await handleConsulta(USER, "listar_metas");
    const iPerto = out.resposta.indexOf("Perto");
    const iLonge = out.resposta.indexOf("Longe");
    const iSem = out.resposta.indexOf("SemPrazo");
    expect(iPerto).toBeGreaterThan(-1);
    expect(iLonge).toBeGreaterThan(iPerto);
    expect(iSem).toBeGreaterThan(iLonge);
    expect(state.inserts.length).toBe(0);
  });

  test("limita a 10 mais próximas e sinaliza total real", async () => {
    state.metasData = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`,
      user_id: USER,
      nome: `Meta ${i}`,
      valor_objetivo: 100,
      valor_atual: 10,
      prazo: `2026-08-${String(i + 1).padStart(2, "0")}`,
    }));
    const out = await handleConsulta(USER, "listar_metas");
    expect(out.resposta).toMatch(/\(12\)/);
    expect(out.resposta).toMatch(/exibindo as 10 mais próximas de 12/);
    expect(state.inserts.length).toBe(0);
  });

  test("nenhuma escrita em gastos, receitas, recorrências, contas, metas ou movimentacoes_meta", async () => {
    state.metasData = [
      {
        id: "m1",
        user_id: USER,
        nome: "Reserva",
        valor_objetivo: 500,
        valor_atual: 100,
        prazo: null,
      },
    ];
    await handleConsulta(USER, "listar_metas");
    const escritas = state.inserts.filter((i) =>
      [
        "gastos",
        "receitas",
        "recorrencias",
        "contas_a_pagar",
        "contas_a_receber",
        "transferencias_internas",
        "metas_financeiras",
        "movimentacoes_meta",
      ].includes(i.table),
    );
    expect(escritas.length).toBe(0);
  });
});
