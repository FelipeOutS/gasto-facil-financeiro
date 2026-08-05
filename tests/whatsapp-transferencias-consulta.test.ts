/**
 * WA-Q-Transferencias — listagem de transferências internas via WhatsApp.
 *
 * Frases de consulta NÃO podem abrir sessão de criação de gasto/receita/transferência
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
  state.transferenciasData = [];
});

describe("WA-Q-Transferencias — detecção de intenção", () => {
  const frases = [
    "transferências",
    "transferencias",
    "minhas transferências",
    "Minhas Transferências",
    "minha transferencia",
    "ver transferências",
    "histórico de transferências",
    "transferências entre contas",
    "transferencias internas",
    "quais são minhas transferências",
    "liste minhas transferências",
    "mostrar transferencias",
    "quanto transferi",
    "quanto eu transferi",
  ];
  for (const f of frases) {
    test(`'${f}' → listar_transferencias`, () => {
      expect(detectConsultaIntent(f)).toBe("listar_transferencias");
    });
  }

  test("não confunde com 'contas a receber'", () => {
    expect(detectConsultaIntent("contas a receber")).toBe("listar_contas_receber");
  });
  test("não confunde com 'minhas recorrências'", () => {
    expect(detectConsultaIntent("minhas recorrências")).toBe("listar_recorrencias");
  });
  test("não confunde com 'minhas receitas'", () => {
    expect(detectConsultaIntent("minhas receitas")).toBe("listar_receitas_mes");
  });
  test("frase de criação real de transferência NÃO cai em listagem", () => {
    // Criação real de transferência deve seguir o parser dedicado, não a consulta.
    expect(detectConsultaIntent("transferi 500 da corrente pra poupança")).toBeNull();
  });
  test("frase de criação real de gasto NÃO cai em listagem", () => {
    expect(detectConsultaIntent("mercado 48,90")).toBeNull();
  });
});

describe("WA-Q-Transferencias — handler é 100% read-only", () => {
  test("sem transferências: resposta amigável, sem pedir valor/conta", async () => {
    const out = await handleConsulta(USER, "listar_transferencias");
    expect(out.status).toBe("consulta");
    expect(out.resposta).toMatch(/ainda não tem transferências/i);
    expect(out.resposta).not.toMatch(/qual foi o valor/i);
    expect(out.resposta).not.toMatch(/qual conta/i);
    expect(state.inserts.length).toBe(0);
  });

  test("lista transferências do usuário, isola de outros usuários", async () => {
    state.transferenciasData = [
      {
        id: "t1",
        user_id: USER,
        descricao: "Reserva de emergência",
        valor: 500,
        data: "2026-06-20",
        horario: "10:00",
        origem: "Corrente Itaú",
        destino: "Poupança Itaú",
        observacao: null,
      },
      {
        id: "t2",
        user_id: USER,
        descricao: null,
        valor: 200,
        data: "2026-06-25",
        horario: null,
        origem: "Nubank",
        destino: "Inter",
        observacao: "Sobra do mês",
      },
      {
        id: "t3",
        user_id: "outro",
        descricao: "Não é minha",
        valor: 9999,
        data: "2026-06-26",
        horario: null,
        origem: "X",
        destino: "Y",
        observacao: null,
      },
    ];
    const out = await handleConsulta(USER, "listar_transferencias");
    expect(out.resposta).toMatch(/Corrente Itaú → Poupança Itaú/);
    expect(out.resposta).toMatch(/Nubank → Inter/);
    expect(out.resposta).toMatch(/Reserva de emergência/);
    expect(out.resposta).toMatch(/Sobra do mês/);
    expect(out.resposta).not.toMatch(/Não é minha/);
    expect(out.resposta).toMatch(/20\/06\/2026/);
    expect(out.resposta).toMatch(/25\/06\/2026/);
    expect(out.resposta).toMatch(/R\$\s?500,00/);
    expect(out.resposta).toMatch(/R\$\s?200,00/);
    // Total exibido: 500 + 200 = 700
    expect(out.resposta).toMatch(/Total transferido \(exibido\): R\$\s?700,00/);
    expect(state.inserts.length).toBe(0);
  });

  test("ordena por data DESC (mais recente primeiro)", async () => {
    state.transferenciasData = [
      {
        id: "a",
        user_id: USER,
        descricao: "antigo",
        valor: 100,
        data: "2026-05-01",
        horario: null,
        origem: "A",
        destino: "B",
        observacao: null,
      },
      {
        id: "b",
        user_id: USER,
        descricao: "recente",
        valor: 100,
        data: "2026-06-30",
        horario: null,
        origem: "C",
        destino: "D",
        observacao: null,
      },
    ];
    const out = await handleConsulta(USER, "listar_transferencias");
    const idxRecente = out.resposta.indexOf("30/06/2026");
    const idxAntigo = out.resposta.indexOf("01/05/2026");
    expect(idxRecente).toBeGreaterThan(-1);
    expect(idxAntigo).toBeGreaterThan(idxRecente);
    expect(state.inserts.length).toBe(0);
  });

  test("limita a 10 mais recentes e sinaliza total real", async () => {
    state.transferenciasData = Array.from({ length: 13 }, (_, i) => ({
      id: `t${i}`,
      user_id: USER,
      descricao: `tr ${i}`,
      valor: 10,
      data: `2026-06-${String(i + 1).padStart(2, "0")}`,
      horario: null,
      origem: "X",
      destino: "Y",
      observacao: null,
    }));
    const out = await handleConsulta(USER, "listar_transferencias");
    expect(out.resposta).toMatch(/\(13\)/); // total real
    expect(out.resposta).toMatch(/exibindo as 10 mais recentes de 13/);
    expect(state.inserts.length).toBe(0);
  });

  test("nenhuma escrita em gastos, receitas, recorrências, contas ou transferências", async () => {
    state.transferenciasData = [
      {
        id: "t1",
        user_id: USER,
        descricao: null,
        valor: 100,
        data: "2026-06-01",
        horario: null,
        origem: "A",
        destino: "B",
        observacao: null,
      },
    ];
    await handleConsulta(USER, "listar_transferencias");
    const escritas = state.inserts.filter((i) =>
      [
        "gastos",
        "receitas",
        "recorrencias",
        "contas_a_pagar",
        "contas_a_receber",
        "transferencias_internas",
      ].includes(i.table),
    );
    expect(escritas.length).toBe(0);
  });
});
