/**
 * WA-C11 FASE 3B.2.C.1 — Block 5: wiring do quota gate financeiro em:
 *   • `persistir` (whatsapp-contas-criar.server) → actionType
 *     `bill_create_text`, discriminator = `sessaoId`. Chamada DEPOIS do
 *     claim `conta_persistindo` e ANTES do insert em `contas_a_pagar`.
 *   • `persistir` (whatsapp-boleto-intents.server) → actionType
 *     `bill_create_boleto`, discriminator = `session.fingerprint`.
 *     Chamada DEPOIS do claim `bol_persistindo` e ANTES do insert.
 *   • `persistirManual` (whatsapp-boleto-intents.server) → actionType
 *     `bill_create_boleto`, discriminator = `sessaoId` (fallback manual
 *     não tem fingerprint). Mesma ordem claim→gate→insert.
 *
 * Cobre os 20 cenários exigidos: fail-closed, allowed, quota_denied,
 * duplicate (retry idempotente), claim perdedor (worker concorrente),
 * insert falhando, readback ausente, concorrência com mesmo external_id.
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

// Inserts na tabela `contas_a_pagar` (compartilhado entre texto e boleto).
let contasInsertRows: Array<Record<string, unknown>> = [];
let contasInsertError: { message: string } | null = null;
let contasReadbackFound = true;
let contasDupReadback: Record<string, unknown> | null = null;

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from(table: string) {
      if (table === "contas_a_pagar") {
        return {
          select: (_cols?: string) => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: contasDupReadback, error: null }),
                }),
                maybeSingle: async () => ({
                  data: contasReadbackFound ? { id: "any" } : null,
                  error: null,
                }),
              }),
              in: async () => ({
                data: contasReadbackFound ? contasInsertRows.map((r) => ({ id: r.id })) : [],
                error: null,
              }),
            }),
          }),
          insert: async (rows: Array<Record<string, unknown>>) => {
            if (contasInsertError) return { error: contasInsertError };
            contasInsertRows.push(...rows);
            return { error: null };
          },
        };
      }
      if (table === "whatsapp_messages") {
        return { update: () => ({ eq: async () => ({ error: null }) }) };
      }
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
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

// evita side-effects
mock.module("@/server/whatsapp-contas-lembretes.server", () => ({
  cancelarLembretesDaConta: async () => 0,
}));

// ---------- imports pós-mock ----------
const { persistir: persistirTexto } = await import("@/server/whatsapp-contas-criar.server");
const { persistir: persistirBoleto, persistirManual: persistirBoletoManual } =
  await import("@/server/whatsapp-boleto-intents.server");

// ---------- helpers ----------
function makeDeps() {
  const gravar: Array<{ status: string; ok: boolean }> = [];
  const atualizar: Array<{ id: string; status: string; resposta: string }> = [];
  let claimOk = true;
  return {
    gravar,
    atualizar,
    setClaimFails: () => {
      claimOk = false;
    },
    deps: {
      gravarSessao: async (
        _u: string,
        _t: string,
        _e: string | null,
        _tx: string,
        _r: string,
        status: string,
      ) => {
        gravar.push({ status, ok: claimOk });
        return {
          ok: claimOk,
          sessionId: claimOk ? "sess-claim" : null,
          status: claimOk ? status : null,
          errorCode: null,
        };
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

// ---------- fixtures ----------
function contaSession() {
  return {
    kind: "conta_a_pagar" as const,
    mensagemOriginal: "Internet 100 vence 26/06",
    nome: "Internet",
    valorCentavos: 10000,
    dataVencimento: "2026-06-26",
    recorrente: false,
    frequenciaRecorrencia: null,
    categoriaId: "cat-outros",
    categoriaLabel: "Outros",
    categorySelectionSource: "automatic" as const,
    source: "text" as const,
    diaInformado: null,
  };
}
const contaMsg = {
  telefone: "551199",
  external_id: "wamid.CONTA1",
  source: "text",
} as unknown as Parameters<typeof persistirTexto>[0]["msg"];

function boletoSession() {
  return {
    kind: "boleto" as const,
    fingerprint: "fp-boleto-1",
    tipo: "cobranca" as const,
    valorCentavos: 12000,
    vencimentoISO: "2026-06-26",
    identificacao: "Internet",
    mascara: "****1234",
    codigoBarras: "00190000090123456789012345678901234567890000",
    banco: "001",
  };
}
const boletoMsg = {
  telefone: "551199",
  external_id: "wamid.BOL1",
  source: "text",
} as unknown as Parameters<typeof persistirBoleto>[0]["msg"];

function boletoManualSession() {
  return {
    kind: "boleto_manual" as const,
    origem: "imagem" as const,
    valorCentavos: 15000,
    vencimentoISO: "2026-06-26",
    identificacao: "Condomínio",
  };
}

// ---------- reset ----------
beforeEach(() => {
  gateCalls.length = 0;
  gateOutcome = { allowed: true, reason: "allowed", duplicate: false };
  contasInsertRows = [];
  contasInsertError = null;
  contasReadbackFound = true;
  contasDupReadback = null;
});

// ═════════════════════════════════════════════════════════════════════
// persistir (conta a pagar por texto)
// ═════════════════════════════════════════════════════════════════════
describe("WA-C11 3B.2.C.1 Block 5 — persistir(conta texto) quota gate", () => {
  it("fail-closed sem external_id → sem claim, sem gate, sem insert", async () => {
    const h = makeDeps();
    const r = await persistirTexto({
      userId: "u1",
      msg: { ...contaMsg, external_id: null } as never,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: contaSession(),
      sessaoId: "sess-1",
      deps: h.deps,
    });
    expect(r.status).toBe("erro");
    expect(h.gravar).toHaveLength(0);
    expect(gateCalls).toHaveLength(0);
    expect(contasInsertRows).toHaveLength(0);
  });

  it("gate allowed → ordem claim → gate → insert e discriminator=sessaoId", async () => {
    const h = makeDeps();
    const r = await persistirTexto({
      userId: "u1",
      msg: contaMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: contaSession(),
      sessaoId: "sess-abc",
      deps: h.deps,
    });
    expect(r.status).toBe("salva");
    expect(h.gravar[0]?.status).toBe("conta_persistindo");
    expect(gateCalls).toHaveLength(1);
    expect(gateCalls[0]).toMatchObject({
      userId: "u1",
      externalMessageId: "wamid.CONTA1",
      actionType: "bill_create_text",
      discriminator: "sess-abc",
    });
    expect(contasInsertRows).toHaveLength(1);
  });

  it("gate quota_denied → claim marcado como 'erro', sem insert, resposta neutra", async () => {
    gateOutcome = { allowed: false, reason: "quota_denied" };
    const h = makeDeps();
    const r = await persistirTexto({
      userId: "u1",
      msg: contaMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: contaSession(),
      sessaoId: "sess-abc",
      deps: h.deps,
    });
    expect(r.status).toBe("erro");
    expect(r.resposta).toBe("LIMITE_MENSAL_MSG");
    expect(h.gravar[0]?.status).toBe("conta_persistindo");
    expect(gateCalls).toHaveLength(1);
    expect(contasInsertRows).toHaveLength(0);
    expect(h.atualizar.at(-1)).toMatchObject({
      status: "erro",
      resposta: "quota_blocked",
    });
  });

  it("gate duplicate=true (retry idempotente) → insert continua, key só consome 1x", async () => {
    gateOutcome = { allowed: true, reason: "duplicate", duplicate: true };
    const h = makeDeps();
    const r = await persistirTexto({
      userId: "u1",
      msg: contaMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: contaSession(),
      sessaoId: "sess-abc",
      deps: h.deps,
    });
    expect(r.status).toBe("salva");
    expect(contasInsertRows).toHaveLength(1);
  });

  it("claim perdedor (gravarSessao ok:false) → sem gate, sem insert", async () => {
    const h = makeDeps();
    h.setClaimFails();
    const r = await persistirTexto({
      userId: "u1",
      msg: contaMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: contaSession(),
      sessaoId: "sess-abc",
      deps: h.deps,
    });
    expect(r.status).toBe("erro");
    expect(gateCalls).toHaveLength(0);
    expect(contasInsertRows).toHaveLength(0);
  });

  it("insert falha após gate allowed → status erro, mas gate consumido (retry vai bater duplicate)", async () => {
    contasInsertError = { message: "boom" };
    const h = makeDeps();
    const r = await persistirTexto({
      userId: "u1",
      msg: contaMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: contaSession(),
      sessaoId: "sess-abc",
      deps: h.deps,
    });
    expect(r.status).toBe("erro");
    expect(gateCalls).toHaveLength(1);
  });

  it("readback ausente → status erro, chamada única de gate", async () => {
    contasReadbackFound = false;
    const h = makeDeps();
    const r = await persistirTexto({
      userId: "u1",
      msg: contaMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: contaSession(),
      sessaoId: "sess-abc",
      deps: h.deps,
    });
    expect(r.status).toBe("erro");
    expect(gateCalls).toHaveLength(1);
  });

  it("dois workers concorrentes com mesmo external_id → apenas um vence claim", async () => {
    const w1 = makeDeps();
    const w2 = makeDeps();
    w2.setClaimFails();
    const [r1, r2] = await Promise.all([
      persistirTexto({
        userId: "u1",
        msg: contaMsg,
        texto: "sim",
        recebidaEm: new Date().toISOString(),
        session: contaSession(),
        sessaoId: "sess-abc",
        deps: w1.deps,
      }),
      persistirTexto({
        userId: "u1",
        msg: contaMsg,
        texto: "sim",
        recebidaEm: new Date().toISOString(),
        session: contaSession(),
        sessaoId: "sess-abc",
        deps: w2.deps,
      }),
    ]);
    const salvos = [r1, r2].filter((r) => r.status === "salva");
    const erros = [r1, r2].filter((r) => r.status === "erro");
    expect(salvos).toHaveLength(1);
    expect(erros).toHaveLength(1);
    expect(gateCalls).toHaveLength(1);
    expect(contasInsertRows).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════
// persistir (boleto automático)
// ═════════════════════════════════════════════════════════════════════
describe("WA-C11 3B.2.C.1 Block 5 — persistir(boleto) quota gate", () => {
  it("fail-closed sem external_id → sem claim, sem gate, sem insert", async () => {
    const h = makeDeps();
    const r = await persistirBoleto({
      userId: "u1",
      msg: { ...boletoMsg, external_id: null } as never,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: boletoSession(),
      sessaoId: "sess-bol",
      deps: h.deps,
    });
    expect(r.status).toBe("erro");
    expect(h.gravar).toHaveLength(0);
    expect(gateCalls).toHaveLength(0);
    expect(contasInsertRows).toHaveLength(0);
  });

  it("gate allowed → claim → gate → insert; discriminator=fingerprint", async () => {
    const h = makeDeps();
    const r = await persistirBoleto({
      userId: "u1",
      msg: boletoMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: boletoSession(),
      sessaoId: "sess-bol",
      deps: h.deps,
    });
    expect(r.status).toBe("salva");
    expect(h.gravar[0]?.status).toBe("bol_persistindo");
    expect(gateCalls).toHaveLength(1);
    expect(gateCalls[0]).toMatchObject({
      externalMessageId: "wamid.BOL1",
      actionType: "bill_create_boleto",
      discriminator: "fp-boleto-1",
    });
    expect(contasInsertRows).toHaveLength(1);
    // não vaza codigoBarras em log — mas persistido em row.
    expect(contasInsertRows[0].codigo_boleto).toBeTruthy();
  });

  it("gate quota_denied → sem insert, claim marcado 'erro', resposta neutra", async () => {
    gateOutcome = { allowed: false, reason: "quota_denied" };
    const h = makeDeps();
    const r = await persistirBoleto({
      userId: "u1",
      msg: boletoMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: boletoSession(),
      sessaoId: "sess-bol",
      deps: h.deps,
    });
    expect(r.status).toBe("erro");
    expect(r.resposta).toBe("LIMITE_MENSAL_MSG");
    expect(gateCalls).toHaveLength(1);
    expect(contasInsertRows).toHaveLength(0);
    expect(h.atualizar.at(-1)).toMatchObject({ resposta: "quota_blocked" });
  });

  it("gate duplicate=true (retry) → insert continua", async () => {
    gateOutcome = { allowed: true, reason: "duplicate", duplicate: true };
    const h = makeDeps();
    const r = await persistirBoleto({
      userId: "u1",
      msg: boletoMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: boletoSession(),
      sessaoId: "sess-bol",
      deps: h.deps,
    });
    expect(r.status).toBe("salva");
    expect(contasInsertRows).toHaveLength(1);
  });

  it("claim perdedor → sem gate, sem insert", async () => {
    const h = makeDeps();
    h.setClaimFails();
    const r = await persistirBoleto({
      userId: "u1",
      msg: boletoMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: boletoSession(),
      sessaoId: "sess-bol",
      deps: h.deps,
    });
    expect(r.status).toBe("erro");
    expect(gateCalls).toHaveLength(0);
    expect(contasInsertRows).toHaveLength(0);
  });

  it("insert falha → gate consumido uma vez, resposta erro", async () => {
    contasInsertError = { message: "boom" };
    const h = makeDeps();
    const r = await persistirBoleto({
      userId: "u1",
      msg: boletoMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: boletoSession(),
      sessaoId: "sess-bol",
      deps: h.deps,
    });
    expect(r.status).toBe("erro");
    expect(gateCalls).toHaveLength(1);
  });

  it("dois workers concorrentes → só um vence claim e uma quota consumida", async () => {
    const w1 = makeDeps();
    const w2 = makeDeps();
    w2.setClaimFails();
    const [r1, r2] = await Promise.all([
      persistirBoleto({
        userId: "u1",
        msg: boletoMsg,
        texto: "sim",
        recebidaEm: new Date().toISOString(),
        session: boletoSession(),
        sessaoId: "sess-bol",
        deps: w1.deps,
      }),
      persistirBoleto({
        userId: "u1",
        msg: boletoMsg,
        texto: "sim",
        recebidaEm: new Date().toISOString(),
        session: boletoSession(),
        sessaoId: "sess-bol",
        deps: w2.deps,
      }),
    ]);
    const salvos = [r1, r2].filter((r) => r.status === "salva");
    expect(salvos).toHaveLength(1);
    expect(gateCalls).toHaveLength(1);
    expect(contasInsertRows).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════
// persistirManual (boleto — fallback manual)
// ═════════════════════════════════════════════════════════════════════
describe("WA-C11 3B.2.C.1 Block 5 — persistirManual(boleto) quota gate", () => {
  it("fail-closed sem external_id → sem claim, sem gate, sem insert", async () => {
    const h = makeDeps();
    const r = await persistirBoletoManual({
      userId: "u1",
      msg: { ...boletoMsg, external_id: null } as never,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: boletoManualSession(),
      sessaoId: "sess-man",
      deps: h.deps,
    });
    expect(r.status).toBe("erro");
    expect(gateCalls).toHaveLength(0);
    expect(contasInsertRows).toHaveLength(0);
  });

  it("gate allowed → discriminator=sessaoId; insert com codigo_boleto=null", async () => {
    const h = makeDeps();
    const r = await persistirBoletoManual({
      userId: "u1",
      msg: boletoMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: boletoManualSession(),
      sessaoId: "sess-man",
      deps: h.deps,
    });
    expect(r.status).toBe("salva");
    expect(gateCalls[0]).toMatchObject({
      actionType: "bill_create_boleto",
      discriminator: "sess-man",
    });
    expect(contasInsertRows[0].codigo_boleto).toBeNull();
  });

  it("gate quota_denied → sem insert, claim marcado 'erro'", async () => {
    gateOutcome = { allowed: false, reason: "quota_denied" };
    const h = makeDeps();
    const r = await persistirBoletoManual({
      userId: "u1",
      msg: boletoMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: boletoManualSession(),
      sessaoId: "sess-man",
      deps: h.deps,
    });
    expect(r.status).toBe("erro");
    expect(r.resposta).toBe("LIMITE_MENSAL_MSG");
    expect(contasInsertRows).toHaveLength(0);
    expect(h.atualizar.at(-1)).toMatchObject({ resposta: "quota_blocked" });
  });

  it("claim perdedor → sem gate, sem insert", async () => {
    const h = makeDeps();
    h.setClaimFails();
    const r = await persistirBoletoManual({
      userId: "u1",
      msg: boletoMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: boletoManualSession(),
      sessaoId: "sess-man",
      deps: h.deps,
    });
    expect(r.status).toBe("erro");
    expect(gateCalls).toHaveLength(0);
    expect(contasInsertRows).toHaveLength(0);
  });

  it("gate duplicate=true → insert continua", async () => {
    gateOutcome = { allowed: true, reason: "duplicate", duplicate: true };
    const h = makeDeps();
    const r = await persistirBoletoManual({
      userId: "u1",
      msg: boletoMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: boletoManualSession(),
      sessaoId: "sess-man",
      deps: h.deps,
    });
    expect(r.status).toBe("salva");
    expect(contasInsertRows).toHaveLength(1);
  });

  it("insert falha → status erro, gate consumido 1x", async () => {
    contasInsertError = { message: "boom" };
    const h = makeDeps();
    const r = await persistirBoletoManual({
      userId: "u1",
      msg: boletoMsg,
      texto: "sim",
      recebidaEm: new Date().toISOString(),
      session: boletoManualSession(),
      sessaoId: "sess-man",
      deps: h.deps,
    });
    expect(r.status).toBe("erro");
    expect(gateCalls).toHaveLength(1);
  });
});
