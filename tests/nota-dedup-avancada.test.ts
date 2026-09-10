/**
 * Fluxo Nota/Comprovante — deduplicação AVANÇADA reutilizada dos importadores.
 *
 * Roda via: bun test tests/nota-dedup-avancada.test.ts
 *
 * A leitura de nota usa `findDuplicateGastoAdvanced` (mesma função do extrato
 * e da fatura). Não existe segunda lógica de deduplicação no produto.
 */
import { describe, expect, it, beforeEach, mock } from "bun:test";

mock.module("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: () => ({ then: (cb: (r: unknown) => void) => cb({ error: null }) }),
      select: () => ({ eq: () => ({ then: (cb: (r: unknown) => void) => cb({ data: [] }) }) }),
    }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

const { addGasto, findDuplicateGastoAdvanced, setActiveUserId, getGastos } = await import(
  "../src/lib/store"
);

function seed(valor: number, data: string, estabelecimento: string) {
  addGasto({
    valor,
    data,
    estabelecimento,
    descricao: estabelecimento,
    categoriaId: "mercado",
    formaPagamento: "credito",
  });
}

describe("deduplicação avançada no fluxo de nota", () => {
  beforeEach(() => {
    setActiveUserId(null);
  });

  it("nota de 09/09 'MERCADO EXEMPLO LTDA' encontra gasto de 08/09 'Mercado Exemplo'", () => {
    seed(150, "2026-09-08", "Mercado Exemplo");
    const dup = findDuplicateGastoAdvanced({
      valor: 150,
      data: "2026-09-09",
      estabelecimento: "MERCADO EXEMPLO LTDA",
      descricao: "MERCADO EXEMPLO LTDA",
    });
    expect(dup).toBeTruthy();
    expect(dup?.data).toBe("2026-09-08");
  });

  it("apenas avisa: nada é removido nem salvo automaticamente", () => {
    seed(150, "2026-09-08", "Mercado Exemplo");
    const antes = getGastos().length;
    findDuplicateGastoAdvanced({ valor: 150, data: "2026-09-09", estabelecimento: "Mercado Exemplo" });
    expect(getGastos().length).toBe(antes);
  });

  it("usuário pode importar mesmo assim (falso positivo legítimo)", () => {
    seed(150, "2026-09-08", "Mercado Exemplo");
    const antes = getGastos().length;
    const dup = findDuplicateGastoAdvanced({
      valor: 150,
      data: "2026-09-09",
      estabelecimento: "Mercado Exemplo",
    });
    expect(dup).toBeTruthy();
    // "Importar mesmo assim" → o gasto é criado normalmente.
    seed(150, "2026-09-09", "Mercado Exemplo");
    expect(getGastos().length).toBe(antes + 1);
  });

  it("valor diferente ou data distante não é duplicidade", () => {
    seed(150, "2026-09-08", "Mercado Exemplo");
    expect(
      findDuplicateGastoAdvanced({
        valor: 151,
        data: "2026-09-09",
        estabelecimento: "Mercado Exemplo",
      }),
    ).toBeUndefined();
    expect(
      findDuplicateGastoAdvanced({
        valor: 150,
        data: "2026-09-20",
        estabelecimento: "Mercado Exemplo",
      }),
    ).toBeUndefined();
  });

  it("estabelecimento sem relação não é duplicidade", () => {
    seed(150, "2026-09-08", "Mercado Exemplo");
    expect(
      findDuplicateGastoAdvanced({
        valor: 150,
        data: "2026-09-09",
        estabelecimento: "Posto Ipiranga",
      }),
    ).toBeUndefined();
  });
});
