/**
 * WA-C11 FASE 3B.2.C.1 — Block 4: wiring do quota gate financeiro em
 *   • `persistirBaixa` (whatsapp-contas-pagar.server) → actionType
 *     `bill_payment`, discriminator = session.contaId. Chamada antes da
 *     RPC atômica `whatsapp_baixa_conta_atomic`.
 *   • `persistir` (whatsapp-parcelamento.server) → actionType
 *     `installment`, discriminator = grupoId. Chamada DEPOIS do claim
 *     `parc_persistindo` e ANTES da RPC `create_installment_purchase`.
 *
 * Cobertura:
 *  - fail-closed sem external_id (sem gate, sem RPC);
 *  - gate allowed → RPC chamada uma vez, quota chamada uma vez;
 *  - gate quota_denied → sem RPC, resposta neutra, claim marcado como
 *    erro quando aplicável;
 *  - retry idempotente (duplicate=true) → não bloqueia (a RPC atômica /
 *    unique index cuida da idempotência da escrita);
 *  - baixa: conta já paga com gasto vinculado → RPC devolve noop, sem
 *    novo gasto criado; retorno "salva";
 *  - parcelamento: dois workers concorrentes → o segundo perde o claim
 *    (gravarSessao retorna ok:false) e não chega ao gate nem à RPC.
 *
 * Nenhum teste chama Graph API, dispatcher ou HTTP externo.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";

// ---------- estado compartilhado ----------
const gateCalls: Array<{
  userId: string;
  externalMessageId: string;
  actionType: string;
  discriminator?: string;
}> = [];
let gateOutcome: { allowed: boolean; reason: string; duplicate?: boolean } = {
  allowed: true,
  reason: "allowed",
  duplicate: false,
};

// RPC de baixa
let baixaRpcCalls: Array<Record<string, unknown>> = [];
let baixaRpcResult: { result: string; gasto_id: string | null } = {
  result: "paid",
  gasto_id: "gasto-1",
};

// RPC de parcelamento
let installmentRpcCalls: Array<Record<string, unknown>> = [];
let installmentRpcError: { message: string } | null = null;

// Readback da baixa (contas_a_pagar)
let baixaReadback: Record<string, unknown> | null = {
  id: "conta-1",
  nome: "Internet",
  valor: 100,
  data_pagamento: "2026-06-26",
  status: "pago",
  gasto_id: "gasto-1",
};

// Readback do parcelamento (gastos com grupo_parcelamento_id)
let parcReadback: Array<{ id: string; parcela_atual: number; categoria_id: string | null }> = [];

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc(name: string, params: Record<string, unknown>) {
      if (name === "whatsapp_baixa_conta_atomic") {
        baixaRpcCalls.push(params);
        return Promise.resolve({ data: [baixaRpcResult], error: null });
      }
      if (name === "create_installment_purchase") {
        installmentRpcCalls.push(params);
        if (installmentRpcError) {
          return Promise.resolve({ data: null, error: installmentRpcError });
        }
        return Promise.resolve({
          data: parcReadback.map((r) => ({
            id: r.id,
            parcela_atual: r.parcela_atual,
            categoria_id: r.categoria_id,
          })),
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from(table: string) {
      if (table === "contas_a_pagar") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: baixaReadback, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "categorias") {
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: [{ id: "cat-outros", legacy_id: "outros", nome: "Outros" }],
              error: null,
            }),
          }),
        };
      }
      if (table === "gastos") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: parcReadback, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  },
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
      idempotencyKey: `wa:financial:${args.externalMessageId}:${args.actionType}${
        args.discriminator ? `:${args.discriminator}` : ""
      }:v1`,
      cycleSource: "calendar_month",
      quota: gateOutcome.allowed
        ? { limit: 100, used: 1, remaining: 99 }
        : { limit: 100, used: 100, remaining: 0 },
    };
  },
  financialQuotaBlockedReply: () => "LIMITE_MENSAL_MSG",
}));

// evita side-effects de cancelar-lembretes
mock.module("@/server/whatsapp-contas-lembretes.server", () => ({
  cancelarLembretesDaConta: async () => 0,
}));
mock.module("@/server/whatsapp-short-context.server", () => ({
  clearLembreteConta: () => {},
}));
mock.module("@/server/whatsapp-merchant-memory.server", () => ({
  merchantKeyFor: () => null,
  recordMerchantMemory: async () => ({ ok: true }),
}));

// ---------- imports pós-mock ----------
const { persistirBaixa } = await import(
  "@/server/whatsapp-contas-pagar.server"
);
const { persistir: persistirParcelamento } = await import(
  "@/server/whatsapp-parcelamento.server"
);

// ---------- helpers ----------
const baseMsg = {
  telefone: "551199",
  external_id: "wamid.BAIXA1",
  source: "text",
} as unknown as Parameters<typeof persistirBaixa>[0]["msg"];

function baixaDeps() {
  const gravar: Array<{ status: string }> = [];
  const atualizar: Array<{ status: string }> = [];
  return {
    gravar,
    atualizar,
    deps: {
      gravarSessao: async (
        _u: string, _t: string, _e: string | null, _tx: string, _r: string,
        status: string,
      ) => {
        gravar.push({ status });
        return { ok: true, sessionId: "sess-baixa", status, errorCode: null };
      },
      atualizarSessao: async (_id: string, status: string) => {
        atualizar.push({ status });
        return { ok: true };
      },
      fecharSessoesAnteriores: async () => {},
    } as never,
  };
}

function baixaSession() {
  return {
    kind: "baixa_conta" as const,
    contaId: "conta-1",
    candidateContaIds: null,
    dataPagamento: "2026-06-26",
  };
}

function baixaSessao() {
  return {
    id: "sess-baixa-existing",
    status: "conta_pagamento_aguardando_confirmacao",
    session: baixaSession(),
    recebida_em: new Date().toISOString(),
  };
}

// ---------- parcelamento helpers ----------
function parcDeps() {
  const gravar: Array<{ status: string; ok: boolean }> = [];
  const atualizar: Array<{ id: string; status: string; resposta: string }> = [];
  let claimOk = true;
  return {
    gravar,
    atualizar,
    setClaimFails: () => { claimOk = false; },
    deps: {
      carregarCartoes: async () => [],
      matchCartao: () => ({ match: null }),
      displayCartaoNome: (c: { nome: string }) => c.nome,
      maskCartaoLabel: (c: { nome: string }) => c.nome,
      isGenericExpenseDescription: () => false,
      gravarSessao: async (
        _u: string, _t: string, _e: string | null, _tx: string, _r: string,
        status: string,
      ) => {
        gravar.push({ status, ok: claimOk });
        return { ok: claimOk, sessionId: claimOk ? "sess-parc" : null };
      },
      atualizarSessao: async (id: string, status: string, _s: unknown, resposta: string) => {
        atualizar.push({ id, status, resposta });
        return { ok: true };
      },
      fecharSessoesAnteriores: async () => {},
      loadCategoriasParaPicker: async () => [],
      buildCategoriaListBody: async () => ({ body: "", options: {} as never }),
      resolveCategoriaPickerInput: async () => ({ kind: "invalid" as const }),
      detectCategoriaCommand: () => null,
    } as never,
  };
}

function parcSession() {
  return {
    kind: "parcelamento" as const,
    mensagemOriginal: "TV 300 em 3x nubank",
    descricao: "TV",
    valorTotal: 300,
    totalParcelas: 3,
    cartaoId: "card-1",
    cartaoNome: "Nubank",
    source: "text" as const,
  };
}

const cartaoFixture = [
  {
    id: "card-1",
    nome: "Nubank",
    diaFechamento: 15,
    diaVencimento: 22,
    user_id: "u-parc",
  } as never,
];

const parcMsg = {
  telefone: "551199",
  external_id: "wamid.PARC1",
  source: "text",
} as unknown as Parameters<typeof persistirParcelamento>[0]["msg"];

beforeEach(() => {
  gateCalls.length = 0;
  gateOutcome = { allowed: true, reason: "allowed", duplicate: false };
  baixaRpcCalls = [];
  baixaRpcResult = { result: "paid", gasto_id: "gasto-1" };
  baixaReadback = {
    id: "conta-1",
    nome: "Internet",
    valor: 100,
    data_pagamento: "2026-06-26",
    status: "pago",
    gasto_id: "gasto-1",
  };
  installmentRpcCalls = [];
  installmentRpcError = null;
  parcReadback = [
    { id: "gp1", parcela_atual: 1, categoria_id: "cat-outros" },
    { id: "gp2", parcela_atual: 2, categoria_id: "cat-outros" },
    { id: "gp3", parcela_atual: 3, categoria_id: "cat-outros" },
  ];
});

// ═════════════════════════════════════════════════════════════════════
// Baixa de conta
// ═════════════════════════════════════════════════════════════════════
describe("WA-C11 3B.2.C.1 Block 4 — persistirBaixa quota gate", () => {
  it("fail-closed sem external_id → sem gate e sem RPC", async () => {
    const { deps } = baixaDeps();
    const r = await persistirBaixa({
      userId: "u-baixa",
      msg: { ...baseMsg, external_id: null } as never,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: baixaSession(),
      sessao: baixaSessao(),
      deps,
    });
    expect(r.status).toBe("erro");
    expect(gateCalls).toHaveLength(0);
    expect(baixaRpcCalls).toHaveLength(0);
  });

  it("gate allowed → chama RPC uma vez com action=bill_payment + discriminator=contaId", async () => {
    const { deps } = baixaDeps();
    const r = await persistirBaixa({
      userId: "u-baixa",
      msg: baseMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: baixaSession(),
      sessao: baixaSessao(),
      deps,
    });
    expect(r.status).toBe("salva");
    expect(gateCalls).toHaveLength(1);
    expect(gateCalls[0]).toMatchObject({
      userId: "u-baixa",
      externalMessageId: "wamid.BAIXA1",
      actionType: "bill_payment",
      discriminator: "conta-1",
    });
    expect(gateCalls[0].discriminator).toBe("conta-1");
    expect(baixaRpcCalls).toHaveLength(1);
    expect(baixaRpcCalls[0]).toMatchObject({
      p_user_id: "u-baixa",
      p_conta_id: "conta-1",
      p_data_pagamento: "2026-06-26",
    });
  });

  it("gate quota_denied → sem RPC e resposta neutra", async () => {
    gateOutcome = { allowed: false, reason: "quota_denied" };
    const { deps } = baixaDeps();
    const r = await persistirBaixa({
      userId: "u-baixa",
      msg: baseMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: baixaSession(),
      sessao: baixaSessao(),
      deps,
    });
    expect(r.status).toBe("erro");
    expect(r.resposta).toBe("LIMITE_MENSAL_MSG");
    expect(baixaRpcCalls).toHaveLength(0);
    expect(gateCalls).toHaveLength(1);
  });

  it("gate duplicate=true (retry idempotente) → segue e chama a RPC atômica", async () => {
    gateOutcome = { allowed: true, reason: "duplicate", duplicate: true };
    const { deps } = baixaDeps();
    const r = await persistirBaixa({
      userId: "u-baixa",
      msg: baseMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: baixaSession(),
      sessao: baixaSessao(),
      deps,
    });
    expect(r.status).toBe("salva");
    expect(baixaRpcCalls).toHaveLength(1);
  });

  it("conta já paga com vínculo válido → RPC noop, resposta 'salva' sem novo gasto", async () => {
    baixaRpcResult = { result: "noop", gasto_id: "gasto-1" };
    const { deps, atualizar } = baixaDeps();
    const r = await persistirBaixa({
      userId: "u-baixa",
      msg: baseMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: baixaSession(),
      sessao: baixaSessao(),
      deps,
    });
    expect(r.status).toBe("salva");
    // gate ainda foi chamado (quota é idempotente pela mesma key em retry)
    expect(gateCalls).toHaveLength(1);
    expect(atualizar.at(-1)?.status).toBe("salva");
  });

  it("RPC erro real → não confirma salvamento", async () => {
    baixaRpcResult = { result: "not_found", gasto_id: null };
    const { deps } = baixaDeps();
    const r = await persistirBaixa({
      userId: "u-baixa",
      msg: baseMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: baixaSession(),
      sessao: baixaSessao(),
      deps,
    });
    expect(r.status).toBe("consulta");
    expect(gateCalls).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Parcelamento
// ═════════════════════════════════════════════════════════════════════
describe("WA-C11 3B.2.C.1 Block 4 — persistir(parcelamento) quota gate", () => {
  it("fail-closed sem external_id → sem claim, sem gate, sem RPC", async () => {
    const { deps, gravar } = parcDeps();
    const r = await persistirParcelamento({
      userId: "u-parc",
      msg: { ...parcMsg, external_id: null } as never,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: parcSession() as never,
      cartoes: cartaoFixture,
      sessaoId: "sess-existing",
      deps,
    });
    expect(r.status).toBe("erro");
    expect(gravar).toHaveLength(0);
    expect(gateCalls).toHaveLength(0);
    expect(installmentRpcCalls).toHaveLength(0);
  });

  it("gate allowed → claim antes do gate + RPC chamada com action=installment", async () => {
    const { deps, gravar } = parcDeps();
    const r = await persistirParcelamento({
      userId: "u-parc",
      msg: parcMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: parcSession() as never,
      cartoes: cartaoFixture,
      sessaoId: "sess-existing",
      deps,
    });
    expect(r.status).toBe("salva");
    // 1. claim ocorreu primeiro
    expect(gravar[0]?.status).toBe("parc_persistindo");
    // 2. gate DEPOIS do claim
    expect(gateCalls).toHaveLength(1);
    expect(gateCalls[0]).toMatchObject({
      userId: "u-parc",
      externalMessageId: "wamid.PARC1",
      actionType: "installment",
    });
    // discriminator é o grupoId UUID gerado — deve estar presente e não vazio
    expect(gateCalls[0].discriminator).toBeTruthy();
    // 3. RPC chamada uma vez
    expect(installmentRpcCalls).toHaveLength(1);
  });

  it("gate quota_denied após claim → sem RPC, claim marcado como 'erro', resposta neutra", async () => {
    gateOutcome = { allowed: false, reason: "quota_denied" };
    const { deps, atualizar, gravar } = parcDeps();
    const r = await persistirParcelamento({
      userId: "u-parc",
      msg: parcMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: parcSession() as never,
      cartoes: cartaoFixture,
      sessaoId: "sess-existing",
      deps,
    });
    expect(r.status).toBe("erro");
    expect(r.resposta).toBe("LIMITE_MENSAL_MSG");
    expect(gravar[0]?.status).toBe("parc_persistindo"); // claim aconteceu
    expect(gateCalls).toHaveLength(1);
    expect(installmentRpcCalls).toHaveLength(0);
    // claim recuperado para não ficar órfão
    expect(atualizar.at(-1)).toMatchObject({
      status: "erro",
      resposta: "quota_blocked",
    });
  });

  it("worker perdedor no claim (gravarSessao ok:false) → sem gate e sem RPC", async () => {
    const helper = parcDeps();
    helper.setClaimFails();
    const r = await persistirParcelamento({
      userId: "u-parc",
      msg: parcMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: parcSession() as never,
      cartoes: cartaoFixture,
      sessaoId: "sess-existing",
      deps: helper.deps,
    });
    expect(r.status).toBe("erro");
    expect(gateCalls).toHaveLength(0);
    expect(installmentRpcCalls).toHaveLength(0);
  });

  it("RPC installment falha → sem readback, claim marcado como 'erro'", async () => {
    installmentRpcError = { message: "boom" };
    const { deps, atualizar } = parcDeps();
    const r = await persistirParcelamento({
      userId: "u-parc",
      msg: parcMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: parcSession() as never,
      cartoes: cartaoFixture,
      sessaoId: "sess-existing",
      deps,
    });
    expect(r.status).toBe("erro");
    expect(gateCalls).toHaveLength(1);
    expect(installmentRpcCalls).toHaveLength(1);
    expect(atualizar.at(-1)).toMatchObject({ status: "erro", resposta: "rpc_failed" });
  });

  it("gate duplicate=true → segue e RPC atômica preserva a idempotência", async () => {
    gateOutcome = { allowed: true, reason: "duplicate", duplicate: true };
    const { deps } = parcDeps();
    const r = await persistirParcelamento({
      userId: "u-parc",
      msg: parcMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: parcSession() as never,
      cartoes: cartaoFixture,
      sessaoId: "sess-existing",
      deps,
    });
    expect(r.status).toBe("salva");
    expect(installmentRpcCalls).toHaveLength(1);
  });

  it("dois workers concorrentes com mesmo external_id → apenas um vence claim e chega ao gate/RPC", async () => {
    // Worker 1: vence claim (default). Worker 2: claim falha.
    const w1 = parcDeps();
    const w2 = parcDeps();
    w2.setClaimFails();
    const [r1, r2] = await Promise.all([
      persistirParcelamento({
        userId: "u-parc",
        msg: parcMsg,
        texto: "sim",
        recebidaEm: new Date().toISOString(),
        session: parcSession() as never,
        cartoes: cartaoFixture,
        sessaoId: "sess-existing",
        deps: w1.deps,
      }),
      persistirParcelamento({
        userId: "u-parc",
        msg: parcMsg,
        texto: "sim",
        recebidaEm: new Date().toISOString(),
        session: parcSession() as never,
        cartoes: cartaoFixture,
        sessaoId: "sess-existing",
        deps: w2.deps,
      }),
    ]);
    // Um vence, um perde. Apenas UMA quota e UMA RPC.
    const vencedor = [r1, r2].filter((r) => r.status === "salva");
    const perdedor = [r1, r2].filter((r) => r.status === "erro");
    expect(vencedor).toHaveLength(1);
    expect(perdedor).toHaveLength(1);
    expect(gateCalls).toHaveLength(1);
    expect(installmentRpcCalls).toHaveLength(1);
  });
});
