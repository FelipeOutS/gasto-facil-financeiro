/**
 * WA-C9 — Testes de lembretes de contas a pagar (DRY-RUN).
 *
 * Cobre o gerador, o renderer e a ponte de respostas pós-lembrete.
 * Nenhum teste envia mensagem real.
 */
import { describe, it, expect, beforeEach, mock } from "bun:test";

// WA-C11 Fase 1 — gate de entitlement é bypassado em testes DRY-RUN.
mock.module("@/server/whatsapp-entitlement.server", () => ({
  getWhatsAppEntitlement: async () => ({ allowed: true, reason: "allowed" }),
  assertWhatsAppEntitlement: async () => ({ allowed: true, reason: "allowed" }),
}));
mock.module("../src/server/whatsapp-entitlement.server", () => ({
  getWhatsAppEntitlement: async () => ({ allowed: true, reason: "allowed" }),
  assertWhatsAppEntitlement: async () => ({ allowed: true, reason: "allowed" }),
}));
// WA-C11 Fase 3B.2.B — gate unificado é bypassado (produção real cobre
// runtime/rollout/ciclo/capacidade; testes de geração são DRY-RUN).
mock.module("@/server/whatsapp-c11-gates.server", () => ({
  canCreateNotificationForUser: async () => ({
    allowed: true,
    reason: "allowed",
    adminMaster: false,
    planCode: "pessoal_premium",
    cycleSource: "calendar_month",
  }),
  runInboundProductionGate: async () => ({
    allowed: true,
    reason: "allowed",
    duplicate: false,
    adminMaster: false,
    planCode: "pessoal_premium",
    cycleSource: "calendar_month",
    quota: null,
  }),
}));
mock.module("../src/server/whatsapp-c11-gates.server", () => ({
  canCreateNotificationForUser: async () => ({
    allowed: true,
    reason: "allowed",
    adminMaster: false,
    planCode: "pessoal_premium",
    cycleSource: "calendar_month",
  }),
  runInboundProductionGate: async () => ({
    allowed: true,
    reason: "allowed",
    duplicate: false,
    adminMaster: false,
    planCode: "pessoal_premium",
    cycleSource: "calendar_month",
    quota: null,
  }),
}));
import {
  gerarLembretesContasUsuario,
  renderLembreteConta,
  cancelarLembretesDaConta,
  type ContaPendenteMinimal,
} from "../src/server/whatsapp-contas-lembretes.server";
import {
  recordLembreteConta,
  getLembreteConta,
  clearLembreteConta,
  resolveLembreteResposta,
  _resetShortContext,
} from "../src/server/whatsapp-short-context.server";

// ----------------------- Fake supabase client (copiado da WA-C8) -----------------------
type Row = Record<string, unknown>;

function buildFake() {
  const tables: Record<string, Row[]> = {
    whatsapp_notifications: [],
    contas_a_pagar: [],
  };

  function from(table: string) {
    if (!tables[table]) tables[table] = [];
    const data = tables[table];
    const ctx = {
      filters: [] as Array<(r: Row) => boolean>,
      updatePatch: null as Row | null,
      orderBy: null as string | null,
      orderAsc: true,
      limitN: null as number | null,
      upsertOpts: null as { onConflict?: string; ignoreDuplicates?: boolean } | null,
    };

    function applyAll(): Row[] {
      if (ctx.updatePatch == null) {
        let rows = data.filter((r) => ctx.filters.every((f) => f(r)));
        if (ctx.orderBy) {
          rows = [...rows].sort((a, b) => {
            const av = String(a[ctx.orderBy!]);
            const bv = String(b[ctx.orderBy!]);
            return ctx.orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
          });
        }
        if (ctx.limitN != null) rows = rows.slice(0, ctx.limitN);
        return rows;
      }
      const updated: Row[] = [];
      for (const r of data) {
        if (ctx.filters.every((f) => f(r))) {
          Object.assign(r, ctx.updatePatch);
          updated.push(r);
        }
      }
      return updated;
    }

    const api: Record<string, unknown> = {};
    Object.assign(api, {
      select() {
        return api;
      },
      eq(col: string, val: unknown) {
        ctx.filters.push((r) => r[col] === val);
        return api;
      },
      in(col: string, vals: unknown[]) {
        ctx.filters.push((r) => vals.includes(r[col]));
        return api;
      },
      lte(col: string, val: unknown) {
        ctx.filters.push((r) => String(r[col]) <= String(val));
        return api;
      },
      gte(col: string, val: unknown) {
        ctx.filters.push((r) => String(r[col]) >= String(val));
        return api;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        ctx.orderBy = col;
        ctx.orderAsc = opts?.ascending ?? true;
        return api;
      },
      limit(n: number) {
        ctx.limitN = n;
        return api;
      },
      async maybeSingle() {
        const rows = applyAll();
        return { data: rows[0] ?? null, error: null };
      },
      then(resolve: (v: { data: Row[]; error: null }) => unknown) {
        return Promise.resolve(resolve({ data: applyAll() as Row[], error: null }));
      },
      upsert(row: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        ctx.upsertOpts = opts ?? null;
        const rows = Array.isArray(row) ? row : [row];
        for (const r of rows) {
          const conflictCols = (opts?.onConflict ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          const existing = conflictCols.length
            ? data.find((d) => conflictCols.every((c) => d[c] === r[c]))
            : undefined;
          if (existing) {
            if (opts?.ignoreDuplicates) continue;
            Object.assign(existing, r);
          } else {
            data.push({ id: r.id ?? `id-${data.length + 1}`, ...r });
          }
        }
        return api;
      },
      update(patch: Row) {
        ctx.updatePatch = patch;
        return api;
      },
    });
    return api;
  }

  return {
    client: { from } as unknown as Parameters<typeof gerarLembretesContasUsuario>[1]["client"],
    tables,
  };
}

// ----------------------- Setup -----------------------
// Fixamos "agora" para uma data conhecida. O gerador calcula hoje/amanhã em TZ
// America/Sao_Paulo. 2026-06-28T12:00:00Z = 2026-06-28 09:00 BRT.
const NOW = new Date("2026-06-28T12:00:00Z");
const HOJE_BRT = "2026-06-28";
const AMANHA_BRT = "2026-06-29";
const ONTEM_BRT = "2026-06-27";

let fake: ReturnType<typeof buildFake>;
beforeEach(() => {
  fake = buildFake();
  _resetShortContext();
});

const baseConta = (overrides: Partial<ContaPendenteMinimal> = {}): ContaPendenteMinimal => ({
  id: "c-1",
  nome: "Internet",
  valor: 120,
  data_vencimento: HOJE_BRT,
  status: "pendente",
  recorrente: false,
  ...overrides,
});

function fetchFn(contas: ContaPendenteMinimal[]) {
  return async () => contas;
}

// ============================================================
// Gerador
// ============================================================
describe("WA-C9 :: gerador de lembretes", () => {
  it("conta vencendo hoje gera 1 lembrete tipo conta_vencendo_hoje", async () => {
    const out = await gerarLembretesContasUsuario("u1", {
      client: fake.client,
      now: () => NOW,
      fetchContasPendentes: fetchFn([baseConta()]),
    });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("conta_vencendo_hoje");
    expect(fake.tables.whatsapp_notifications).toHaveLength(1);
    const row = fake.tables.whatsapp_notifications[0] as Row;
    expect(row.notification_type).toBe("gi_conta_vencendo_hoje");
    expect((row.payload as Row).conta_id).toBe("c-1");
    expect((row.payload as Row).valor_centavos).toBe(12000);
    // payload mínimo: sem nome, sem telefone
    expect((row.payload as Row).nome).toBeUndefined();
  });

  it("conta vencendo amanhã gera tipo conta_vencendo_amanha", async () => {
    const out = await gerarLembretesContasUsuario("u1", {
      client: fake.client,
      now: () => NOW,
      fetchContasPendentes: fetchFn([baseConta({ id: "c-2", data_vencimento: AMANHA_BRT })]),
    });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("conta_vencendo_amanha");
  });

  it("conta atrasada gera tipo conta_atrasada", async () => {
    const out = await gerarLembretesContasUsuario("u1", {
      client: fake.client,
      now: () => NOW,
      fetchContasPendentes: fetchFn([baseConta({ id: "c-3", data_vencimento: ONTEM_BRT })]),
    });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("conta_atrasada");
  });

  it("conta paga NÃO gera lembrete", async () => {
    const out = await gerarLembretesContasUsuario("u1", {
      client: fake.client,
      now: () => NOW,
      fetchContasPendentes: fetchFn([baseConta({ status: "pago" })]),
    });
    expect(out).toHaveLength(0);
    expect(fake.tables.whatsapp_notifications).toHaveLength(0);
  });

  it("conta cancelada NÃO gera lembrete", async () => {
    const out = await gerarLembretesContasUsuario("u1", {
      client: fake.client,
      now: () => NOW,
      fetchContasPendentes: fetchFn([baseConta({ status: "cancelada" })]),
    });
    expect(out).toHaveLength(0);
  });

  it("execução repetida não duplica (dedupe por user_id+dedupe_key)", async () => {
    const conta = baseConta();
    await gerarLembretesContasUsuario("u1", {
      client: fake.client,
      now: () => NOW,
      fetchContasPendentes: fetchFn([conta]),
    });
    await gerarLembretesContasUsuario("u1", {
      client: fake.client,
      now: () => NOW,
      fetchContasPendentes: fetchFn([conta]),
    });
    expect(fake.tables.whatsapp_notifications).toHaveLength(1);
  });

  it("conta recorrente vencendo em 5 dias gera conta_recorrente_pendente", async () => {
    const due = "2026-07-03"; // +5 dias em BRT
    const out = await gerarLembretesContasUsuario("u1", {
      client: fake.client,
      now: () => NOW,
      fetchContasPendentes: fetchFn([
        baseConta({ id: "c-r", data_vencimento: due, recorrente: true }),
      ]),
    });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("conta_recorrente_pendente");
  });

  it("conta futura não-recorrente fora da janela não gera nada", async () => {
    const out = await gerarLembretesContasUsuario("u1", {
      client: fake.client,
      now: () => NOW,
      fetchContasPendentes: fetchFn([
        baseConta({ data_vencimento: "2026-07-15", recorrente: false }),
      ]),
    });
    expect(out).toHaveLength(0);
  });

  it("logs/payload não contêm nome, telefone, descrição completa", async () => {
    await gerarLembretesContasUsuario("u1", {
      client: fake.client,
      now: () => NOW,
      fetchContasPendentes: fetchFn([baseConta({ nome: "DADO SENSÍVEL" })]),
    });
    const row = fake.tables.whatsapp_notifications[0] as Row;
    const serialized = JSON.stringify(row.payload);
    expect(serialized).not.toContain("DADO SENSÍVEL");
  });

  it("cancelarLembretesDaConta filtra user_id e marca cancelled", async () => {
    await gerarLembretesContasUsuario("u1", {
      client: fake.client,
      now: () => NOW,
      fetchContasPendentes: fetchFn([baseConta()]),
    });
    const n = await cancelarLembretesDaConta("u1", "c-1", { client: fake.client });
    expect(n).toBe(1);
    const row = fake.tables.whatsapp_notifications[0] as Row;
    expect(row.status).toBe("cancelled");
  });
});

// ============================================================
// Renderer
// ============================================================
describe("WA-C9 :: renderer", () => {
  it("renderiza texto curto com valor BRL e opções 1..4", () => {
    const r = renderLembreteConta({
      type: "conta_vencendo_hoje",
      valorCentavos: 12000,
      nomeCurto: "Internet",
      dueISO: HOJE_BRT,
    });
    expect(r.text).toContain("R$ 120,00");
    expect(r.text).toContain("1. Paguei");
    expect(r.text).toContain("4. Ignorar");
    expect(r.quickReplies).toEqual(["Paguei", "Adiar", "Ver detalhes", "Ignorar"]);
  });

  it("oculta nome quando nomeCurto não fornecido", () => {
    const r = renderLembreteConta({
      type: "conta_atrasada",
      valorCentavos: 5000,
      dueISO: ONTEM_BRT,
    });
    expect(r.text).toContain("uma conta sua");
    expect(r.text).not.toContain('"');
  });
});

// ============================================================
// Memória curta de lembrete + respostas
// ============================================================
describe("WA-C9 :: contexto curto pós-lembrete", () => {
  const tel = "+5511999998888";
  const ctx = {
    contaId: "c-1",
    notificationId: "n-1",
    nomeCurto: "Internet",
    dueISO: HOJE_BRT,
  };

  it("record/get/clear funcionam", () => {
    recordLembreteConta(tel, ctx);
    expect(getLembreteConta(tel)?.contaId).toBe("c-1");
    clearLembreteConta(tel);
    expect(getLembreteConta(tel)).toBeNull();
  });

  it('resposta "paguei" é classificada como paguei', () => {
    recordLembreteConta(tel, ctx);
    expect(resolveLembreteResposta(tel, "Paguei")?.kind).toBe("paguei");
    expect(resolveLembreteResposta(tel, "1")?.kind).toBe("paguei");
    expect(resolveLembreteResposta(tel, "já paguei")?.kind).toBe("paguei");
  });

  it('resposta "adiar para sexta" extrai novaData', () => {
    recordLembreteConta(tel, ctx);
    const r = resolveLembreteResposta(tel, "Adiar para sexta");
    expect(r?.kind).toBe("adiar");
    expect(r?.kind === "adiar" && r.novaData).toBe("sexta");
  });

  it('resposta "ver detalhes" classifica como detalhes', () => {
    recordLembreteConta(tel, ctx);
    expect(resolveLembreteResposta(tel, "ver detalhes")?.kind).toBe("detalhes");
    expect(resolveLembreteResposta(tel, "3")?.kind).toBe("detalhes");
  });

  it('resposta "ignorar" classifica como ignorar', () => {
    recordLembreteConta(tel, ctx);
    expect(resolveLembreteResposta(tel, "Ignorar")?.kind).toBe("ignorar");
    expect(resolveLembreteResposta(tel, "4")?.kind).toBe("ignorar");
  });

  it("retorna null quando não há lembrete ativo", () => {
    expect(resolveLembreteResposta(tel, "paguei")).toBeNull();
  });

  it("texto fora do conjunto esperado não é classificado", () => {
    recordLembreteConta(tel, ctx);
    expect(resolveLembreteResposta(tel, "qual o pix dele?")).toBeNull();
  });
});
