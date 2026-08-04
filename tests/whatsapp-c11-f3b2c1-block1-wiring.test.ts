/**
 * WA-C11 FASE 3B.2.C.1 — Block 1: wiring do quota gate financeiro em
 * `persistirGasto` (whatsapp.server) e `persistirGastoComprovante`
 * (whatsapp-comprovantes.server).
 *
 * Cobertura:
 *  - fail-closed sem externalMessageId → ok:false, sem insert;
 *  - gate `quota_denied` → ok:false, sem insert, mensagem neutra;
 *  - gate `allowed` → segue para insert normal;
 *  - retry idempotente (`duplicate=true`) → ainda allowed=true e caller escreve;
 *  - idempotency key propagada usa `wa:financial:<msg>:<action>:v1`.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";

const insertedGastos: Array<{ user_id: string }> = [];
const gateCalls: Array<{
  userId: string;
  externalMessageId: string;
  actionType: string;
  discriminator?: string;
}> = [];
let gateOutcome: {
  allowed: boolean;
  reason: string;
  duplicate?: boolean;
} = {
  allowed: true,
  reason: "allowed",
  duplicate: false,
};

const CATS = [{ id: "cat-outros", legacy_id: "outros", nome: "Outros" }];

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
          insert(payload: { user_id: string }) {
            insertedGastos.push(payload);
            return {
              select() {
                return {
                  async single() {
                    return {
                      data: { id: "gasto-" + insertedGastos.length },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        insert: () => Promise.resolve({ error: null }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  },
}));

mock.module("@/server/whatsapp-merchant-memory.server", () => ({
  merchantKeyFor: () => null,
  lookupMerchantMemory: async () => ({ kind: "none" }),
  recordMerchantMemory: async () => ({ ok: true }),
  logMerchantMemoryDecision: () => {},
  MERCHANT_MEMORY_HINT_LINE: "",
}));

mock.module("@/server/whatsapp-financial-quota-gate.server", () => ({
  assertFinancialActionQuotaForWhatsApp: async (args: {
    userId: string;
    externalMessageId: string;
    actionType: string;
    discriminator?: string;
  }) => {
    gateCalls.push(args);
    return {
      allowed: gateOutcome.allowed,
      reason: gateOutcome.reason,
      duplicate: gateOutcome.duplicate ?? false,
      adminMaster: false,
      planCode: "free_ads",
      idempotencyKey: `wa:financial:${args.externalMessageId}:${args.actionType}:v1`,
      cycleSource: "calendar_month",
      quota: gateOutcome.allowed
        ? { limit: 100, used: 1, remaining: 99 }
        : { limit: 100, used: 100, remaining: 0 },
    };
  },
  financialQuotaBlockedReply: () => "LIMITE_MENSAL_MSG",
}));

const { persistirGasto } = await import("@/server/whatsapp.server");
const { persistirGastoComprovante } = await import("@/server/whatsapp-comprovantes.server");

function textSession() {
  return {
    nome: "Padaria X",
    valor: 25,
    data: "2026-06-26",
    formaPagamento: "debito" as const,
    mensagemOriginal: "padaria 25",
  };
}

function compSession() {
  return {
    kind: "imagem_comprovante" as const,
    descricao: "Compra",
    valor: 50,
    data: "2026-06-26",
    categoriaId: "cat-outros",
    categoriaLabel: "Outros",
    formaPagamento: "debito" as const,
    mensagemOriginal: "(foto)",
  };
}

beforeEach(() => {
  insertedGastos.length = 0;
  gateCalls.length = 0;
  gateOutcome = { allowed: true, reason: "allowed", duplicate: false };
});

describe("WA-C11 3B.2.C.1 Block 1 — persistirGasto quota gate", () => {
  it("fail-closed sem externalMessageId → sem insert e sem chamada ao gate", async () => {
    const r = await persistirGasto("user-1", textSession() as never);
    expect(r.ok).toBe(false);
    expect(insertedGastos).toHaveLength(0);
    expect(gateCalls).toHaveLength(0);
  });

  it("gate allowed → segue para insert e usa actionType=expense", async () => {
    const r = await persistirGasto("user-1", textSession() as never, "wamid.A1");
    expect(r.ok).toBe(true);
    expect(insertedGastos).toHaveLength(1);
    expect(gateCalls).toHaveLength(1);
    expect(gateCalls[0]).toMatchObject({
      userId: "user-1",
      externalMessageId: "wamid.A1",
      actionType: "expense",
    });
  });

  it("gate quota_denied → sem insert, mensagem neutra", async () => {
    gateOutcome = { allowed: false, reason: "quota_denied", duplicate: false };
    const r = await persistirGasto("user-1", textSession() as never, "wamid.A2");
    expect(r.ok).toBe(false);
    expect(r.resposta).toBe("LIMITE_MENSAL_MSG");
    expect(insertedGastos).toHaveLength(0);
    expect(gateCalls).toHaveLength(1);
  });

  it("gate duplicate=true ainda deixa caller escrever (idempotência da escrita)", async () => {
    gateOutcome = { allowed: true, reason: "duplicate", duplicate: true };
    const r = await persistirGasto("user-1", textSession() as never, "wamid.A3");
    expect(r.ok).toBe(true);
    expect(insertedGastos).toHaveLength(1);
  });
});

describe("WA-C11 3B.2.C.1 Block 1 — persistirGastoComprovante quota gate", () => {
  it("fail-closed sem externalMessageId → sem insert", async () => {
    const r = await persistirGastoComprovante("user-2", compSession() as never, CATS as never);
    expect(r.ok).toBe(false);
    expect(insertedGastos).toHaveLength(0);
    expect(gateCalls).toHaveLength(0);
  });

  it("gate allowed → usa actionType=expense_receipt e insere", async () => {
    const r = await persistirGastoComprovante(
      "user-2",
      compSession() as never,
      CATS as never,
      "wamid.B1",
    );
    expect(r.ok).toBe(true);
    expect(insertedGastos).toHaveLength(1);
    expect(gateCalls[0]).toMatchObject({
      userId: "user-2",
      externalMessageId: "wamid.B1",
      actionType: "expense_receipt",
    });
  });

  it("gate quota_denied → sem insert e mensagem neutra", async () => {
    gateOutcome = { allowed: false, reason: "quota_denied", duplicate: false };
    const r = await persistirGastoComprovante(
      "user-2",
      compSession() as never,
      CATS as never,
      "wamid.B2",
    );
    expect(r.ok).toBe(false);
    expect(r.resposta).toBe("LIMITE_MENSAL_MSG");
    expect(insertedGastos).toHaveLength(0);
  });
});
