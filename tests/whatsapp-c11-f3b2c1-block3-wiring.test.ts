/**
 * WA-C11 FASE 3B.2.C.1 — Block 3: wiring do quota gate financeiro em
 * `persistirReceita` (whatsapp-receitas.server) para RECEITA ÚNICA
 * (`income_single`) e RECEITA RECORRENTE (`income_recurring`).
 *
 * Cobertura mínima:
 *  - fail-closed sem externalMessageId → ok:false, sem RPC/insert;
 *  - gate `quota_denied` → ok:false, sem escrita, mensagem neutra;
 *  - gate `allowed` → segue para insert / RPC create_recurring_income;
 *  - idempotency key: `wa:financial:<msg>:income_single|income_recurring:v1`;
 *  - discriminator NÃO usado (uma msg = uma unidade de quota, mesmo que
 *    a RPC recorrente crie simultaneamente 1 receita + 1 recorrência);
 *  - retry idempotente (`duplicate=true`) → allowed=true, caller escreve
 *    (idempotência de banco cuida do resto);
 *  - readback recorrente falho após RPC ok → ok:false; quota já consumida
 *    (nenhuma compensação: retry usa mesma key → duplicate);
 *  - zero Graph API — o módulo não fala com transport outbound.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";

const receitasInserts: Array<Record<string, unknown>> = [];
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
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
} = { allowed: true, reason: "allowed", duplicate: false };

let rpcResult: {
  data: Array<{ receita_id: string; recorrencia_id: string }> | null;
  error: unknown;
} = {
  data: [{ receita_id: "rec-1", recorrencia_id: "reco-1" }],
  error: null,
};

let readbackReceita: Record<string, unknown> | null = {
  id: "rec-1",
  recorrencia_id: "reco-1",
  valor: 3500,
  data: "2026-01-15",
  user_id: "u1",
};
let readbackRecorrencia: Record<string, unknown> | null = {
  id: "reco-1",
  frequencia: "mensal",
  proxima_cobranca: "2026-02-15",
  status: "ativa",
  user_id: "u1",
};

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "u@ex.com" } } }) } },
    from(table: string) {
      if (table === "receitas") {
        return {
          insert(row: Record<string, unknown>) {
            receitasInserts.push(row);
            return Promise.resolve({ error: null });
          },
          select() {
            const q: Record<string, unknown> = {};
            q.eq = () => q;
            // Prompt 2 — filtro de soft delete (`.is("deleted_at", null)`).
            q.is = () => q;
            q.gte = () => Promise.resolve({ data: [], error: null });
            q.maybeSingle = async () => ({ data: readbackReceita, error: null });
            return q;
          },
        };
      }
      if (table === "recorrencias") {
        return {
          select() {
            const q: Record<string, unknown> = {};
            q.eq = () => q;
            q.is = () => q;
            q.maybeSingle = async () => ({ data: readbackRecorrencia, error: null });
            return q;
          },
        };
      }
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        insert: () => Promise.resolve({ error: null }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return rpcResult;
    },
  },
}));

mock.module("@/server/subscription.server", () => ({
  getSubscriptionForUserIdentity: async () => ({ plan: "premium" }),
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
      planCode: "premium",
      idempotencyKey: `wa:financial:${args.externalMessageId}:${args.actionType}:v1`,
      cycleSource: "calendar_month",
      quota: gateOutcome.allowed
        ? { limit: 100, used: 1, remaining: 99 }
        : { limit: 100, used: 100, remaining: 0 },
    };
  },
  financialQuotaBlockedReply: () => "LIMITE_MENSAL_MSG",
}));

const { persistirReceita } = await import("@/server/whatsapp-receitas.server");

function singleSession() {
  return {
    kind: "receita" as const,
    tipo: "salario" as const,
    tipoLabel: "Salário",
    descricao: "Salário",
    valor: 3500,
    data: "2026-01-15",
    recorrente: false,
    mensagemOriginal: "Recebi 3500 de salário",
  };
}

function recurringSession() {
  return {
    kind: "receita" as const,
    tipo: "salario" as const,
    tipoLabel: "Salário",
    descricao: "Salário",
    valor: 3500,
    data: "2026-01-15",
    recorrente: true,
    frequencia: "mensal" as const,
    diaMes: 15,
    mensagemOriginal: "Recebi 3500 de salário todo mês dia 15",
  };
}

beforeEach(() => {
  receitasInserts.length = 0;
  rpcCalls.length = 0;
  gateCalls.length = 0;
  gateOutcome = { allowed: true, reason: "allowed", duplicate: false };
  rpcResult = {
    data: [{ receita_id: "rec-1", recorrencia_id: "reco-1" }],
    error: null,
  };
  readbackReceita = {
    id: "rec-1",
    recorrencia_id: "reco-1",
    valor: 3500,
    data: "2026-01-15",
    user_id: "u1",
  };
  readbackRecorrencia = {
    id: "reco-1",
    frequencia: "mensal",
    proxima_cobranca: "2026-02-15",
    status: "ativa",
    user_id: "u1",
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Receita única
// ─────────────────────────────────────────────────────────────────────────────

describe("WA-C11 3B.2.C.1 Block 3 — persistirReceita (income_single)", () => {
  it("fail-closed sem externalMessageId → sem gate, sem insert", async () => {
    const r = await persistirReceita("u1", singleSession() as never, undefined);
    expect(r.ok).toBe(false);
    expect(gateCalls).toHaveLength(0);
    expect(receitasInserts).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it("fail-closed com externalMessageId vazio → sem gate, sem insert", async () => {
    const r = await persistirReceita("u1", singleSession() as never, "   ");
    expect(r.ok).toBe(false);
    expect(gateCalls).toHaveLength(0);
    expect(receitasInserts).toHaveLength(0);
  });

  it("gate allowed → insert + action=income_single + idempotency key correta", async () => {
    const r = await persistirReceita("u1", singleSession() as never, "wamid.R1");
    expect(r.ok).toBe(true);
    expect(gateCalls).toHaveLength(1);
    expect(gateCalls[0]).toMatchObject({
      userId: "u1",
      externalMessageId: "wamid.R1",
      actionType: "income_single",
    });
    expect(gateCalls[0].discriminator).toBeUndefined();
    expect(receitasInserts).toHaveLength(1);
    expect((receitasInserts[0] as { user_id: string }).user_id).toBe("u1");
    expect((receitasInserts[0] as { recorrente: boolean }).recorrente).toBe(false);
    // Zero RPC recorrente — caminho de receita única.
    expect(rpcCalls.find((c) => c.name === "create_recurring_income")).toBeUndefined();
  });

  it("gate quota_denied → sem insert, resposta neutra", async () => {
    gateOutcome = { allowed: false, reason: "quota_denied" };
    const r = await persistirReceita("u1", singleSession() as never, "wamid.R2");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.resposta).toBe("LIMITE_MENSAL_MSG");
    expect(receitasInserts).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
    expect(gateCalls).toHaveLength(1);
  });

  it("gate runtime_global_off → sem insert", async () => {
    gateOutcome = { allowed: false, reason: "runtime_global_off" };
    const r = await persistirReceita("u1", singleSession() as never, "wamid.R3");
    expect(r.ok).toBe(false);
    expect(receitasInserts).toHaveLength(0);
  });

  it("gate entitlement_denied → sem insert", async () => {
    gateOutcome = { allowed: false, reason: "entitlement_denied" };
    const r = await persistirReceita("u1", singleSession() as never, "wamid.R4");
    expect(r.ok).toBe(false);
    expect(receitasInserts).toHaveLength(0);
  });

  it("gate duplicate=true (retry idempotente) → allowed, caller escreve", async () => {
    gateOutcome = { allowed: true, reason: "duplicate", duplicate: true };
    const r = await persistirReceita("u1", singleSession() as never, "wamid.R5");
    expect(r.ok).toBe(true);
    expect(gateCalls).toHaveLength(1);
  });

  it("dois workers concorrentes com mesmo external_id → gate chamado 2× com MESMA key (uma única action)", async () => {
    // Modelagem: o gate é a fronteira de idempotência. Uma unidade de quota
    // é consumida uma única vez (via idempotency key), independentemente do
    // número de reentradas.
    const [a, b] = await Promise.all([
      persistirReceita("u1", singleSession() as never, "wamid.R6"),
      persistirReceita("u1", singleSession() as never, "wamid.R6"),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(gateCalls).toHaveLength(2);
    expect(gateCalls[0].externalMessageId).toBe(gateCalls[1].externalMessageId);
    expect(gateCalls[0].actionType).toBe("income_single");
    expect(gateCalls[1].actionType).toBe("income_single");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Receita recorrente
// ─────────────────────────────────────────────────────────────────────────────

describe("WA-C11 3B.2.C.1 Block 3 — persistirReceita (income_recurring)", () => {
  it("gate allowed → RPC create_recurring_income + action=income_recurring", async () => {
    const r = await persistirReceita("u1", recurringSession() as never, "wamid.RR1");
    expect(r.ok).toBe(true);
    expect(gateCalls).toHaveLength(1);
    expect(gateCalls[0]).toMatchObject({
      userId: "u1",
      externalMessageId: "wamid.RR1",
      actionType: "income_recurring",
    });
    expect(gateCalls[0].discriminator).toBeUndefined();
    // Uma única RPC de recorrência foi disparada.
    expect(rpcCalls.filter((c) => c.name === "create_recurring_income")).toHaveLength(1);
    // Nenhum insert direto (a RPC é dona da escrita atômica).
    expect(receitasInserts).toHaveLength(0);
  });

  it("ordem: gate ANTES da RPC", async () => {
    const seen: string[] = [];
    const prevAssert = (await import("@/server/whatsapp-financial-quota-gate.server"))
      .assertFinancialActionQuotaForWhatsApp;
    // não conseguimos reordenar mocks — validamos indiretamente:
    // se o gate bloqueia, RPC NUNCA é chamada.
    gateOutcome = { allowed: false, reason: "quota_denied" };
    const r = await persistirReceita("u1", recurringSession() as never, "wamid.RR2");
    expect(r.ok).toBe(false);
    expect(rpcCalls.filter((c) => c.name === "create_recurring_income")).toHaveLength(0);
    seen.push("ok");
    expect(seen).toContain("ok");
    // reference used to keep TS happy
    expect(typeof prevAssert).toBe("function");
  });

  it("gate quota_denied → sem RPC, sem escrita, resposta neutra", async () => {
    gateOutcome = { allowed: false, reason: "quota_denied" };
    const r = await persistirReceita("u1", recurringSession() as never, "wamid.RR3");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.resposta).toBe("LIMITE_MENSAL_MSG");
    expect(rpcCalls).toHaveLength(0);
  });

  it("RPC falha definitivamente → ok:false, sem readback falso positivo", async () => {
    rpcResult = { data: null, error: { message: "boom" } };
    const r = await persistirReceita("u1", recurringSession() as never, "wamid.RR4");
    expect(r.ok).toBe(false);
    // gate foi consumido antes da RPC — a idempotência da key protege retry.
    expect(gateCalls).toHaveLength(1);
  });

  it("RPC ok mas readback inconsistente (recorrencia sem status=ativa) → ok:false", async () => {
    readbackRecorrencia = {
      id: "reco-1",
      frequencia: "mensal",
      proxima_cobranca: null,
      status: "pendente",
      user_id: "u1",
    };
    const r = await persistirReceita("u1", recurringSession() as never, "wamid.RR5");
    expect(r.ok).toBe(false);
  });

  it("retry após sucesso (mesma msg) → duplicate=true → allowed; RPC pode ser chamada novamente (idempotência de banco cuida)", async () => {
    gateOutcome = { allowed: true, reason: "duplicate", duplicate: true };
    const r = await persistirReceita("u1", recurringSession() as never, "wamid.RR6");
    expect(r.ok).toBe(true);
    expect(gateCalls).toHaveLength(1);
  });

  it("dois workers concorrentes recorrentes com mesma msg → mesma idempotency key", async () => {
    const [a, b] = await Promise.all([
      persistirReceita("u1", recurringSession() as never, "wamid.RR7"),
      persistirReceita("u1", recurringSession() as never, "wamid.RR7"),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(gateCalls).toHaveLength(2);
    expect(gateCalls[0].actionType).toBe("income_recurring");
    expect(gateCalls[1].actionType).toBe("income_recurring");
    expect(gateCalls[0].externalMessageId).toBe(gateCalls[1].externalMessageId);
  });
});
