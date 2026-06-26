/**
 * WA-M1 — Testes da memória de categoria por estabelecimento.
 *
 * Cobertura:
 *  - normalização e rejeição de descrições genéricas;
 *  - elegibilidade (1 manual OR 2 confirmed);
 *  - histórico ambíguo → não sugere;
 *  - categoria inativa → ignorada;
 *  - isolamento por user_id;
 *  - logs seguros (sem PII).
 */
import { describe, it, expect, mock, beforeEach, beforeAll } from "bun:test";

type MemRow = {
  user_id: string;
  merchant_key: string;
  category_id: string;
  confirmed_count: number;
  manual_confirmed_count: number;
};

let rows: MemRow[] = [];

function buildSupabaseMock() {
  return {
    from(_table: string) {
      const filter: Record<string, unknown> = {};
      // O mock retorna uma Promise pré-construída para que `await chain`
      // funcione mesmo quando `.then` não é forçado manualmente: a
      // ordem real das chamadas é `.from().select(...).eq(...).eq(...)`
      // (sem .maybeSingle no caminho de lista). Implementamos isso
      // criando uma Promise resolvida tardiamente via `.eq`.
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (col: string, val: unknown) => {
        filter[col] = val;
        return q;
      };
      q.maybeSingle = async () => {
        const r = rows.find((x) =>
          Object.entries(filter).every(([k, v]) => (x as Record<string, unknown>)[k] === v),
        );
        return { data: r ? { id: "row-" + r.merchant_key + "-" + r.category_id, ...r } : null, error: null };
      };
      (q as { then?: unknown }).then = (resolve: (v: { data: MemRow[]; error: null }) => unknown) => {
        const list = rows.filter((x) =>
          Object.entries(filter).every(([k, v]) => (x as Record<string, unknown>)[k] === v),
        );
        return Promise.resolve(resolve({ data: list, error: null }));
      };
      q.insert = async (payload: Partial<MemRow>) => {
        rows.push({
          user_id: payload.user_id!,
          merchant_key: payload.merchant_key!,
          category_id: payload.category_id!,
          confirmed_count: payload.confirmed_count ?? 0,
          manual_confirmed_count: payload.manual_confirmed_count ?? 0,
        });
        return { error: null };
      };
      q.update = (patch: Partial<MemRow>) => ({
        eq: async () => {
          const r = rows.find((x) =>
            Object.entries(filter).every(([k, v]) => (x as Record<string, unknown>)[k] === v),
          );
          if (r) Object.assign(r, patch);
          return { error: null };
        },
      });
      return q;
    },
  };
}

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: buildSupabaseMock(),
}));

// Import dinâmico DEPOIS do mock.module para garantir interceptação
// (ES imports estáticos são hoisted).
type MemModule = typeof import("@/server/whatsapp-merchant-memory.server");
let mem: MemModule;
beforeAll(async () => {
  mem = await import("@/server/whatsapp-merchant-memory.server");
});

beforeEach(() => {
  rows = [];
});

const activeIds = new Set(["cat-presentes", "cat-saude", "cat-mercado"]);

describe("merchantKeyFor — normalização", () => {
  it("normaliza acentos, caixa e pontuação", () => {
    expect(mem.merchantKeyFor("Caboclo Ventania Artigos de Fé"))
      .toBe("caboclo ventania artigos de fe");
  });
  it("remove pontuação e asteriscos", () => {
    expect(mem.merchantKeyFor("UBER *TRIP  123")).toBe("uber trip");
  });
  it("preserva palavras relevantes", () => {
    expect(mem.merchantKeyFor("Drogaria São Paulo")).toBe("drogaria sao paulo");
  });
  it("rejeita descrição genérica monolítica", () => {
    expect(mem.merchantKeyFor("gasto")).toBeNull();
    expect(mem.merchantKeyFor("almoço")).toBeNull();
    expect(mem.merchantKeyFor("mercado")).toBeNull();
  });
  it("rejeita descrição muito curta", () => {
    expect(mem.merchantKeyFor("a")).toBeNull();
    expect(mem.merchantKeyFor("ab")).toBeNull();
  });
  it("rejeita identificador puramente numérico", () => {
    expect(mem.merchantKeyFor("12345")).toBeNull();
  });
  it("rejeita combinação só de termos genéricos", () => {
    expect(mem.merchantKeyFor("compra pagamento")).toBeNull();
  });
});

describe("lookupMerchantMemory — elegibilidade", () => {
  it("uma confirmação automática não basta", async () => {
    rows.push({ user_id: "u1", merchant_key: "caboclo ventania", category_id: "cat-presentes", confirmed_count: 1, manual_confirmed_count: 0 });
    const r = await mem.lookupMerchantMemory({ userId: "u1", merchantKey: "caboclo ventania", activeCategoryIds: activeIds });
    expect(r.kind).toBe("none");
  });

  it("duas confirmações automáticas tornam elegível", async () => {
    rows.push({ user_id: "u1", merchant_key: "caboclo ventania", category_id: "cat-presentes", confirmed_count: 2, manual_confirmed_count: 0 });
    const r = await mem.lookupMerchantMemory({ userId: "u1", merchantKey: "caboclo ventania", activeCategoryIds: activeIds });
    expect(r.kind).toBe("eligible");
    if (r.kind === "eligible") {
      expect(r.lookup.categoryId).toBe("cat-presentes");
      expect(r.lookup.evidence).toBe("confirmed");
    }
  });

  it("uma confirmação manual torna elegível imediatamente", async () => {
    rows.push({ user_id: "u1", merchant_key: "caboclo ventania", category_id: "cat-presentes", confirmed_count: 1, manual_confirmed_count: 1 });
    const r = await mem.lookupMerchantMemory({ userId: "u1", merchantKey: "caboclo ventania", activeCategoryIds: activeIds });
    expect(r.kind).toBe("eligible");
    if (r.kind === "eligible") expect(r.lookup.evidence).toBe("manual");
  });

  it("histórico conflitante é ambíguo", async () => {
    rows.push({ user_id: "u1", merchant_key: "caboclo ventania", category_id: "cat-presentes", confirmed_count: 2, manual_confirmed_count: 0 });
    rows.push({ user_id: "u1", merchant_key: "caboclo ventania", category_id: "cat-saude", confirmed_count: 0, manual_confirmed_count: 1 });
    const r = await mem.lookupMerchantMemory({ userId: "u1", merchantKey: "caboclo ventania", activeCategoryIds: activeIds });
    expect(r.kind).toBe("ambiguous");
  });

  it("categoria inativa é ignorada", async () => {
    rows.push({ user_id: "u1", merchant_key: "x estab", category_id: "cat-inativa", confirmed_count: 5, manual_confirmed_count: 5 });
    const r = await mem.lookupMerchantMemory({ userId: "u1", merchantKey: "x estab", activeCategoryIds: activeIds });
    expect(r.kind).toBe("none");
  });

  it("memória de outro usuário nunca interfere", async () => {
    rows.push({ user_id: "u-other", merchant_key: "caboclo ventania", category_id: "cat-presentes", confirmed_count: 10, manual_confirmed_count: 10 });
    const r = await mem.lookupMerchantMemory({ userId: "u1", merchantKey: "caboclo ventania", activeCategoryIds: activeIds });
    expect(r.kind).toBe("none");
  });
});

describe("recordMerchantMemory — escrita", () => {
  it("cria registro novo na primeira gravação", async () => {
    const r = await mem.recordMerchantMemory({ userId: "u1", merchantKey: "k loja", categoryId: "cat-presentes", evidence: "manual" });
    expect(r.ok).toBe(true);
    expect(rows.length).toBe(1);
    expect(rows[0].manual_confirmed_count).toBe(1);
    expect(rows[0].confirmed_count).toBe(1);
  });

  it("incrementa contadores em gravações subsequentes", async () => {
    await mem.recordMerchantMemory({ userId: "u1", merchantKey: "k loja", categoryId: "cat-presentes", evidence: "confirmed" });
    await mem.recordMerchantMemory({ userId: "u1", merchantKey: "k loja", categoryId: "cat-presentes", evidence: "manual" });
    expect(rows.length).toBe(1);
    expect(rows[0].confirmed_count).toBe(2);
    expect(rows[0].manual_confirmed_count).toBe(1);
  });

  it("não grava sem categoria", async () => {
    const r = await mem.recordMerchantMemory({ userId: "u1", merchantKey: "k loja", categoryId: "", evidence: "confirmed" });
    expect(r.ok).toBe(false);
    expect(rows.length).toBe(0);
  });

  it("não grava sem merchant key", async () => {
    const r = await mem.recordMerchantMemory({ userId: "u1", merchantKey: "", categoryId: "cat-presentes", evidence: "confirmed" });
    expect(r.ok).toBe(false);
  });
});

describe("logMerchantMemoryDecision — sem PII", () => {
  it("log contém apenas decisão (sem userId, key, categoria, valor)", () => {
    const captured: string[] = [];
    const orig = console.log;
    console.log = (msg: string) => captured.push(String(msg));
    try {
      mem.logMerchantMemoryDecision({
        source: "text",
        memoryFound: true,
        memoryApplied: true,
        reason: "memory_applied",
      });
    } finally {
      console.log = orig;
    }
    expect(captured.length).toBe(1);
    const payload = JSON.parse(captured[0]);
    expect(payload.event).toBe("wa_merchant_memory_decision");
    expect(payload.source).toBe("text");
    expect(payload.memoryApplied).toBe(true);
    expect(payload.reason).toBe("memory_applied");
    expect("userId" in payload).toBe(false);
    expect("merchant_key" in payload).toBe(false);
    expect("merchantKey" in payload).toBe(false);
    expect("categoryId" in payload).toBe(false);
    expect("valor" in payload).toBe(false);
    expect("telefone" in payload).toBe(false);
  });
});
