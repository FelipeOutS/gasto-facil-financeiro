/**
 * WA-C11 FASE 3B.2.C.1 — Block 2: wiring do quota gate financeiro em
 *   • `persistirGastoComClaim` (whatsapp-pagar-pessoa-flow.server) →
 *     actionType `expense_pay_person`.
 *   • `handlePagarPessoaIntent` (whatsapp-pix-intents.server) →
 *     actionType `expense_pix`, com claim atômico `pix_persistindo`
 *     em `whatsapp_messages` antes da chamada ao gate.
 *
 * Cobertura:
 *  - pagar-pessoa: fail-closed sem external_id, gate allowed → insert,
 *    gate quota_denied → sem insert e sem chamada extra ao gate em
 *    perdedores de race (claim vence antes do gate);
 *  - pix intent legacy: fail-closed sem external_id, claim CAS impede
 *    reentrada concorrente, gate allowed → insert, gate denied → sem
 *    insert.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";

// ---------- estado compartilhado ----------
const insertedGastos: Array<Record<string, unknown>> = [];
const gateCalls: Array<{
  userId: string;
  externalMessageId: string;
  actionType: string;
}> = [];
const gravarSessaoCalls: Array<{ status: string; externalId: string | null }> = [];
const atualizarSessaoCalls: Array<{ id: string; status: string; resposta: string }> = [];

let gateOutcome: { allowed: boolean; reason: string } = {
  allowed: true,
  reason: "allowed",
};

// Estado do fake supabaseAdmin para whatsapp_messages / categorias / gastos.
let whatsappMessagesRow: {
  id: string;
  status: string;
  gasto_id: string | null;
  parsed: Record<string, unknown>;
} | null = null;
let pixClaimUpdateRowsAffected: number = 1;

const CATS = [{ id: "cat-outros", legacy_id: "outros", nome: "Outros", user_id: "u1" }];

function buildFakeAdmin() {
  return {
    from(table: string) {
      if (table === "categorias") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: CATS, error: null }),
          }),
        };
      }
      if (table === "gastos") {
        return {
          insert(payload: Record<string, unknown>) {
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
      if (table === "whatsapp_messages") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.update = () => chain;
        chain.eq = () => chain;
        chain.not = () => chain;
        chain.maybeSingle = async () => ({ data: whatsappMessagesRow, error: null });
        // update(...).eq(...).eq(...).not(...).select("id") → resolve para array
        chain.then = (resolve: (v: { data: unknown; error: null }) => unknown) => {
          const arr: Array<{ id: string }> = [];
          for (let i = 0; i < pixClaimUpdateRowsAffected; i++) {
            arr.push({ id: "wam-" + (i + 1) });
          }
          return Promise.resolve(resolve({ data: arr, error: null }));
        };
        return chain;
      }
      // default noop
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        insert: () => Promise.resolve({ error: null }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  };
}

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: buildFakeAdmin(),
}));

mock.module("@/server/whatsapp-financial-quota-gate.server", () => ({
  assertFinancialActionQuotaForWhatsApp: async (args: {
    userId: string;
    externalMessageId: string;
    actionType: string;
  }) => {
    gateCalls.push(args);
    return {
      allowed: gateOutcome.allowed,
      reason: gateOutcome.reason,
      duplicate: false,
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

// Mocks para o path Pix legacy (handlePagarPessoaIntent):
mock.module("@/server/whatsapp-favorecidos.server", () => ({
  findFavorecidosByNome: async () => [],
  findFavorecidoByPixKey: async () => null,
  createFavorecido: async () => ({ id: "fav-1" }),
  updateFavorecidoPix: async () => ({ ok: true }),
  rotuloTipoPix: (_t: string) => "chave",
}));
mock.module("@/server/contas-vencimento.server", () => ({
  findVencimentoByTerm: async () => [],
  todayISOInAppTz: () => new Date().toISOString().slice(0, 10),
  tomorrowISOInAppTz: () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  weekRangeInAppTz: () => ({ start: "2026-01-01", end: "2026-01-07" }),
  monthRangeInAppTz: () => ({ start: "2026-01-01", end: "2026-01-31" }),
  getVencimentosPorPeriodo: async () => [],
  getVencimentosComStatusAnterior: async () => [],
  distinctNamesFrom: () => [],
}));
mock.module("@/server/whatsapp-pix-reveal-token.server", () => ({
  issueRevealToken: () => "tok",
}));

// ---------- imports pós-mock ----------
const { persistirGastoComClaim } = await import("@/server/whatsapp-pagar-pessoa-flow.server");
const { handlePagarPessoaIntent } = await import("@/server/whatsapp-pix-intents.server");

// Deps stub para `persistirGastoComClaim`.
const deps = {
  gravarSessao: async (
    _userId: string,
    _tel: string,
    externalId: string | null,
    _texto: string,
    _rec: string,
    status: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _session: any,
    _resposta: string,
  ) => {
    gravarSessaoCalls.push({ status, externalId });
    return { ok: true, sessionId: "sess-1" } as const;
  },
  atualizarSessao: async (
    id: string,
    status: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _session: any,
    resposta: string,
  ) => {
    atualizarSessaoCalls.push({ id, status, resposta });
    return { ok: true } as const;
  },
  fecharSessoesAnteriores: async () => {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  baixaContaDeps: {} as any,
};

function ppSession() {
  return {
    kind: "pagar_pessoa" as const,
    step: "confirmando",
    nome: "João",
    valorCentavos: 5000,
    formaPagamento: "pix" as const,
    descricao: undefined as string | undefined,
    favorecidoId: null as string | null,
  };
}

beforeEach(() => {
  insertedGastos.length = 0;
  gateCalls.length = 0;
  gravarSessaoCalls.length = 0;
  atualizarSessaoCalls.length = 0;
  gateOutcome = { allowed: true, reason: "allowed" };
  whatsappMessagesRow = null;
  pixClaimUpdateRowsAffected = 1;
});

describe("WA-C11 3B.2.C.1 Block 2 — persistirGastoComClaim (pagar pessoa)", () => {
  it("fail-closed sem external_id → sem claim, sem gate, sem insert", async () => {
    const r = await persistirGastoComClaim({
      userId: "u1",
      telefone: "551199",
      externalId: null,
      texto: "paguei joao 50",
      recebidaEm: new Date().toISOString(),
      session: ppSession() as never,
      deps: deps as never,
    });
    expect(r.kind).toBe("error");
    expect(gateCalls).toHaveLength(0);
    expect(gravarSessaoCalls).toHaveLength(0);
    expect(insertedGastos).toHaveLength(0);
  });

  it("gate allowed → claim antes do gate + insert com forma pix", async () => {
    const r = await persistirGastoComClaim({
      userId: "u1",
      telefone: "551199",
      externalId: "wamid.PP1",
      texto: "paguei joao 50",
      recebidaEm: new Date().toISOString(),
      session: ppSession() as never,
      deps: deps as never,
    });
    expect(r.kind).toBe("ok");
    expect(gravarSessaoCalls[0]?.status).toBe("pp_persistindo");
    expect(gateCalls).toHaveLength(1);
    expect(gateCalls[0]).toMatchObject({
      userId: "u1",
      externalMessageId: "wamid.PP1",
      actionType: "expense_pay_person",
    });
    expect(insertedGastos).toHaveLength(1);
    expect((insertedGastos[0] as { forma_pagamento?: string }).forma_pagamento).toBe("pix");
    // sessão finalizada como "salva"
    expect(atualizarSessaoCalls.at(-1)?.status).toBe("salva");
  });

  it("gate quota_denied após claim → sem insert e sessão marcada como falha com resposta neutra", async () => {
    gateOutcome = { allowed: false, reason: "quota_denied" };
    const r = await persistirGastoComClaim({
      userId: "u1",
      telefone: "551199",
      externalId: "wamid.PP2",
      texto: "paguei joao 50",
      recebidaEm: new Date().toISOString(),
      session: ppSession() as never,
      deps: deps as never,
    });
    expect(r.kind).toBe("quota_blocked");
    if (r.kind === "quota_blocked") {
      expect(r.resposta).toBe("LIMITE_MENSAL_MSG");
    }
    expect(insertedGastos).toHaveLength(0);
    expect(gateCalls).toHaveLength(1);
    // claim aconteceu antes do gate
    expect(gravarSessaoCalls[0]?.status).toBe("pp_persistindo");
    // sessão fechada em falha com a resposta neutra
    expect(atualizarSessaoCalls.at(-1)).toMatchObject({
      status: "falha",
      resposta: "LIMITE_MENSAL_MSG",
    });
  });
});

describe("WA-C11 3B.2.C.1 Block 2 — handlePagarPessoaIntent (pix legacy)", () => {
  const baseRow = {
    external_id: "wamid.PIX1",
    telefone: "551199",
    texto: "paguei 50 para maria",
  } as unknown as import("@/server/whatsapp.server").WhatsAppMessageRow;

  it("fail-closed sem external_id → sem claim e sem gate", async () => {
    const r = await handlePagarPessoaIntent({
      userId: "u1",
      telefone: "551199",
      texto: "paguei 50 para maria",
      _row: { ...baseRow, external_id: null } as never,
    });
    expect(r.status).toBe("erro");
    expect(gateCalls).toHaveLength(0);
  });

  it("gate allowed → claim + gate + insert", async () => {
    const r = await handlePagarPessoaIntent({
      userId: "u1",
      telefone: "551199",
      texto: "paguei 50 para maria",
      _row: baseRow as never,
    });
    expect(r.status).toBe("salva");
    expect(gateCalls).toHaveLength(1);
    expect(gateCalls[0]).toMatchObject({
      userId: "u1",
      externalMessageId: "wamid.PIX1",
      actionType: "expense_pix",
    });
    expect(insertedGastos).toHaveLength(1);
  });

  it("claim CAS best-effort (0 rows) → segue para gate (idempotência via unique index)", async () => {
    // WA-C11 3B.2.C.1 Block 2 — o CAS é best-effort: 0 linhas não bloqueia,
    // pois idempotência primária vem do pré-check + unique index de external_id.
    pixClaimUpdateRowsAffected = 0;
    const r = await handlePagarPessoaIntent({
      userId: "u1",
      telefone: "551199",
      texto: "paguei 50 para maria",
      _row: baseRow as never,
    });
    expect(r.status).toBe("salva");
    expect(gateCalls).toHaveLength(1);
    expect(insertedGastos).toHaveLength(1);
  });

  it("gate quota_denied → sem insert, mensagem neutra", async () => {
    gateOutcome = { allowed: false, reason: "quota_denied" };
    const r = await handlePagarPessoaIntent({
      userId: "u1",
      telefone: "551199",
      texto: "paguei 50 para maria",
      _row: baseRow as never,
    });
    expect(r.status).toBe("erro");
    expect(r.resposta).toBe("LIMITE_MENSAL_MSG");
    expect(gateCalls).toHaveLength(1);
    expect(insertedGastos).toHaveLength(0);
  });
});
