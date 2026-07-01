/**
 * WA-Q-Orcamento — frases de consulta de limites/orçamento não podem
 * abrir sessão de criação de gasto nem escrever no banco.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => {
  const state = {
    limites: [] as Array<{ tipo: string; valor: number; mes: number; ano: number }>,
    gastos: [] as Array<{ descricao: string; valor: number; data: string; categoria_id: string | null }>,
    categorias: [] as Array<{ id: string; nome: string }>,
    receitas: [] as Array<{ valor: number; data: string }>,
  };
  const chain = (rows: unknown[]) => {
    const q: {
      _rows: unknown[];
      select: () => typeof q;
      eq: () => typeof q;
      gte: () => typeof q;
      lt: () => typeof q;
      then: (fn: (v: { data: unknown[] }) => unknown) => unknown;
    } = {
      _rows: rows,
      select: () => q,
      eq: () => q,
      gte: () => q,
      lt: () => q,
      then: (fn) => fn({ data: q._rows }),
    };
    return q;
  };
  return {
    supabaseAdmin: {
      __state: state,
      from(table: string) {
        if (table === "limites") return chain(state.limites);
        if (table === "gastos") return chain(state.gastos);
        if (table === "categorias") return chain(state.categorias);
        if (table === "receitas") return chain(state.receitas);
        return chain([]);
      },
    },
  };
});

import {
  detectConsultaIntent,
  handleConsulta,
} from "../src/server/whatsapp-consultas.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const USER = "u-1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state = (supabaseAdmin as any).__state as {
  limites: Array<{ tipo: string; valor: number; mes: number; ano: number }>;
  gastos: Array<{ descricao: string; valor: number; data: string; categoria_id: string | null }>;
  categorias: Array<{ id: string; nome: string }>;
  receitas: Array<{ valor: number; data: string }>;
};

beforeEach(() => {
  state.limites = [];
  state.gastos = [];
  state.categorias = [];
  state.receitas = [];
});

describe("WA-Q-Orcamento — detecção", () => {
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
  it.each(frases)("'%s' → orcamento_mes", (f) => {
    expect(detectConsultaIntent(f)).toBe("orcamento_mes");
  });

  it("não intercepta 'limite do Nubank' (WA-F5 card limit)", () => {
    expect(detectConsultaIntent("limite do Nubank")).toBeNull();
    expect(detectConsultaIntent("qual meu limite do Nubank")).toBeNull();
  });

  it("não intercepta 'gastos por categoria'", () => {
    expect(detectConsultaIntent("gastos por categoria")).toBe(
      "gastos_por_categoria_mes",
    );
  });
});

describe("WA-Q-Orcamento — handler não escreve nada", () => {
  it("sem limites cadastrados: resposta amigável direcionando ao site", async () => {
    const out = await handleConsulta(USER, "orcamento_mes");
    expect(out.status).toBe("consulta");
    expect(out.resposta).toMatch(/ainda não tem limites/i);
    expect(out.resposta).toMatch(/gastointeligente\.com\.br/);
    expect(out.resposta).not.toMatch(/qual foi o valor/i);
  });

  it("com limites: mostra total, categorias e restante — nenhuma escrita", async () => {
    const now = new Date();
    const mes = now.getMonth() + 1;
    const ano = now.getFullYear();
    state.limites = [
      { tipo: "total", valor: 1000, mes, ano },
      { tipo: "pet", valor: 200, mes, ano },
    ];
    state.categorias = [{ id: "cat-pet", nome: "Pet" }];
    state.gastos = [
      { descricao: "Ração", valor: 50, data: `${ano}-${String(mes).padStart(2, "0")}-05`, categoria_id: "cat-pet" },
    ];

    const out = await handleConsulta(USER, "orcamento_mes");
    expect(out.status).toBe("consulta");
    expect(out.resposta).toMatch(/Total/);
    expect(out.resposta).toMatch(/R\$/);
    expect(out.resposta).toMatch(/Pet/);
    // Nunca pergunta valor como se fosse criar gasto:
    expect(out.resposta).not.toMatch(/qual foi o valor/i);
  });
});
