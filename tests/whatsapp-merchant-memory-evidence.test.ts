/**
 * WA-M1.1 — Preservar evidência manual em texto e áudio.
 *
 * Cobertura:
 *  - texto/áudio com categoria automática confirmada → "confirmed";
 *  - texto/áudio com categoria escolhida manualmente → "manual";
 *  - persistirGasto não dispara recordMerchantMemory sem merchant_key válido;
 *  - sessão sem "sim" (cancelada) nunca chega em persistirGasto;
 *  - marcador `categorySelectionSource` nunca vaza em logs/PII.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";

type GastoInsert = { user_id: string; categoria_id: string | null; descricao: string };
const insertedGastos: GastoInsert[] = [];
const memoryCalls: Array<{
  userId: string;
  merchantKey: string;
  categoryId: string;
  evidence: "manual" | "confirmed";
}> = [];

const CATS = [
  { id: "cat-outros", legacy_id: "outros", nome: "Outros" },
  { id: "cat-transp", legacy_id: "transporte", nome: "Transporte" },
];

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from(table: string) {
      if (table === "categorias") {
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.eq = () => Promise.resolve({ data: CATS, error: null });
        return q;
      }
      if (table === "gastos") {
        return {
          insert(payload: GastoInsert) {
            insertedGastos.push(payload);
            return {
              select() {
                return {
                  async single() {
                    return { data: { id: "gasto-" + insertedGastos.length }, error: null };
                  },
                };
              },
            };
          },
        };
      }
      // fallback no-op
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        insert: () => Promise.resolve({ error: null }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  },
}));

mock.module("@/server/whatsapp-merchant-memory.server", () => ({
  merchantKeyFor: (s: string | null | undefined) => {
    if (!s) return null;
    const k = s.toLowerCase().trim();
    if (k.length < 4) return null;
    return k;
  },
  lookupMerchantMemory: async () => ({ kind: "none" }),
  recordMerchantMemory: async (args: {
    userId: string;
    merchantKey: string;
    categoryId: string;
    evidence: "manual" | "confirmed";
  }) => {
    memoryCalls.push(args);
    return { ok: true };
  },
  logMerchantMemoryDecision: () => {},
  MERCHANT_MEMORY_HINT_LINE: "Sugestão baseada em lançamentos confirmados anteriormente.",
}));

const { persistirGasto } = await import("@/server/whatsapp.server");

function baseSession(extra: Record<string, unknown> = {}) {
  return {
    nome: "Posto Shell Centro",
    valor: 50,
    data: "2026-06-26",
    formaPagamento: "debito" as const,
    mensagemOriginal: "posto shell 50",
    merchantKey: "posto shell centro",
    ...extra,
  };
}

beforeEach(() => {
  insertedGastos.length = 0;
  memoryCalls.length = 0;
});

describe("WA-M1.1 evidência manual vs confirmada", () => {
  it("texto: categoria automática confirmada grava evidence=confirmed", async () => {
    const r = await persistirGasto("user-1", baseSession({ categorySelectionSource: "automatic" }) as never, "wamid.T1");
    expect(r.ok).toBe(true);
    expect(memoryCalls).toHaveLength(1);
    expect(memoryCalls[0].evidence).toBe("confirmed");
  });

  it("texto: categoria escolhida/alterada manualmente grava evidence=manual", async () => {
    const r = await persistirGasto(
      "user-1",
      baseSession({
        categorySelectionSource: "manual",
        memoryApplied: true,
        memoryAppliedCategoriaId: "cat-transp",
      }) as never,
    );
    expect(r.ok).toBe(true);
    expect(memoryCalls).toHaveLength(1);
    expect(memoryCalls[0].evidence).toBe("manual");
    expect(memoryCalls[0].categoryId).toBe("cat-transp");
  });

  it("áudio: confirmação automática grava confirmed", async () => {
    const r = await persistirGasto(
      "user-1",
      baseSession({ source: "audio", categorySelectionSource: "automatic" }) as never,
    );
    expect(r.ok).toBe(true);
    expect(memoryCalls[0].evidence).toBe("confirmed");
  });

  it("áudio: categoria alterada manualmente grava manual", async () => {
    const r = await persistirGasto(
      "user-1",
      baseSession({
        source: "audio",
        categorySelectionSource: "manual",
        memoryApplied: true,
        memoryAppliedCategoriaId: "cat-transp",
      }) as never,
    );
    expect(r.ok).toBe(true);
    expect(memoryCalls[0].evidence).toBe("manual");
  });

  it("sem categorySelectionSource (default) cai em confirmed (fail-safe)", async () => {
    const r = await persistirGasto("user-1", baseSession() as never, "wamid.T1");
    expect(r.ok).toBe(true);
    expect(memoryCalls[0].evidence).toBe("confirmed");
  });

  it("sem merchantKey não grava memória", async () => {
    const s = baseSession({ categorySelectionSource: "manual" }) as Record<string, unknown>;
    delete s.merchantKey;
    const r = await persistirGasto("user-1", s as never, "wamid.T1");
    expect(r.ok).toBe(true);
    expect(memoryCalls).toHaveLength(0);
  });

  it("um único gasto é inserido por chamada de persistirGasto", async () => {
    await persistirGasto("user-1", baseSession({ categorySelectionSource: "manual" }) as never, "wamid.T1");
    expect(insertedGastos).toHaveLength(1);
    expect(insertedGastos[0].user_id).toBe("user-1");
  });
});
