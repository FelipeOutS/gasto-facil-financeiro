/**
 * WA-Q-Orcamento — frases de consulta de limites/orçamento não podem
 * abrir sessão de criação de gasto nem escrever no banco.
 *
 * Reusa o mock compartilhado em ./_whatsapp-fake para garantir a mesma
 * infraestrutura dos demais testes de WhatsApp.
 */
import { test, expect, describe, beforeEach } from "bun:test";
import { state } from "./_whatsapp-fake";

const { detectConsultaIntent, handleConsulta } =
  await import("../src/server/whatsapp-consultas.server");

const USER = "u1";

beforeEach(() => {
  state.inserts = [];
  state.gastosData = [];
  state.limitesData = [];
});

describe("WA-Q-Orcamento — detecção de intenção", () => {
  const frases = [
    "limites",
    "Limites",
    "meus limites",
    "meu limite",
    "como estão meus limites",
    "orçamento do mês",
    "meu orçamento",
    "meus orçamentos",
    "quanto ainda posso gastar",
    "quanto posso gastar",
  ];
  for (const f of frases) {
    test(`'${f}' → orcamento_mes`, () => {
      expect(detectConsultaIntent(f)).toBe("orcamento_mes");
    });
  }

  test("não intercepta 'limite do Nubank' (WA-F5 card limit fica para o handler seguinte)", () => {
    expect(detectConsultaIntent("limite do Nubank")).toBeNull();
    expect(detectConsultaIntent("qual meu limite do Nubank")).toBeNull();
  });

  test("não confunde com 'gastos por categoria'", () => {
    expect(detectConsultaIntent("gastos por categoria")).toBe("gastos_por_categoria_mes");
  });
});

describe("WA-Q-Orcamento — handler não escreve nada", () => {
  test("sem limites cadastrados: resposta amigável, sem pedir valor de gasto", async () => {
    const out = await handleConsulta(USER, "orcamento_mes");
    expect(out.status).toBe("consulta");
    expect(out.resposta).toMatch(/ainda não tem limites/i);
    expect(out.resposta).toMatch(/gastointeligente\.com\.br/);
    expect(out.resposta).not.toMatch(/qual foi o valor/i);
    // Zero escrita em qualquer tabela
    expect(state.inserts.length).toBe(0);
  });

  test("com limites: mostra Total e categorias com restante — nenhuma escrita", async () => {
    // Alinha com o cálculo interno do handler (America/Sao_Paulo).
    const hojeSP = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const [ano, mes] = hojeSP.split("-").map(Number);
    state.limitesData = [
      { user_id: USER, tipo: "total", valor: 1000, mes, ano },
      { user_id: USER, tipo: "mercado", valor: 300, mes, ano },
    ];
    state.gastosData = [
      { user_id: USER, descricao: "Assaí", valor: 80, data: `${hojeSP}`, categoria_id: "cat-mer" },
    ];

    const out = await handleConsulta(USER, "orcamento_mes");
    expect(out.status).toBe("consulta");
    expect(out.resposta).toMatch(/Total/);
    expect(out.resposta).toMatch(/R\$/);
    expect(out.resposta).toMatch(/Mercado/i);
    expect(out.resposta).not.toMatch(/qual foi o valor/i);
    expect(state.inserts.length).toBe(0);
  });
});
