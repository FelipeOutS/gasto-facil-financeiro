/**
 * WA-3.38 — Lembrete interativo com respostas rápidas "Paguei" / "Adiar".
 *
 * Escopo: integração interna (dry-run). Nenhuma chamada real à Meta.
 * Nenhuma escrita financeira definitiva. Nenhuma flag/secret alterada.
 *
 * Funções reais exercitadas:
 *  - gerarLembretesContasUsuario (geração + dedupe por user_id+dedupe_key)
 *  - revalidateContaForDispatch (rechecagem da entidade vinculada)
 *  - canDispatch  (opt-in canal, categoria, quiet hours, janela 24h)
 *  - renderLembreteConta (montagem do texto + quick replies)
 *  - resolveLembreteResposta / parseLembreteCommand (parser da resposta)
 *  - cancelarLembretesDaConta (cleanup)
 *
 * Fixture sintética isolada:
 *  - nome: "Água Lembrete WA-3.38"
 *  - valor: 32,18 (BRL)
 *  - status: pendente
 *  - recorrente=false, gasto_id=NULL, fornecedor_id=NULL, sem Pix
 *  - pertence exclusivamente ao Admin Master (userId "u-admin-master")
 *  - vencimento = hoje (BRT) para gerar `conta_vencendo_hoje`
 */
import { describe, it, expect, beforeEach, mock } from "bun:test";

// WA-C11 Fase 1 — bypass do gate de entitlement em teste dry-run.
mock.module("@/server/whatsapp-entitlement.server", () => ({
  getWhatsAppEntitlement: async () => ({ allowed: true, reason: "allowed" }),
  assertWhatsAppEntitlement: async () => ({ allowed: true, reason: "allowed" }),
}));
mock.module("../src/server/whatsapp-entitlement.server", () => ({
  getWhatsAppEntitlement: async () => ({ allowed: true, reason: "allowed" }),
  assertWhatsAppEntitlement: async () => ({ allowed: true, reason: "allowed" }),
}));
// WA-C11 Fase 3B — bypass do gate C11 (runtime/rollout/quota) em dry-run.
mock.module("@/server/whatsapp-c11-gates.server", () => ({
  runInboundProductionGate: async () => ({ allowed: true as const, userId: "u-admin-master" }),
  runNotificationCreationGate: async () => ({ allowed: true as const }),
  canCreateNotificationForUser: async () => ({
    allowed: true as const,
    reason: "allowed" as const,
  }),
  isInboundGateOk: () => true,
}));
mock.module("../src/server/whatsapp-c11-gates.server", () => ({
  runInboundProductionGate: async () => ({ allowed: true as const, userId: "u-admin-master" }),
  runNotificationCreationGate: async () => ({ allowed: true as const }),
  canCreateNotificationForUser: async () => ({
    allowed: true as const,
    reason: "allowed" as const,
  }),
  isInboundGateOk: () => true,
}));
import {
  gerarLembretesContasUsuario,
  renderLembreteConta,
  cancelarLembretesDaConta,
  revalidateContaForDispatch,
  type ContaPendenteMinimal,
} from "../src/server/whatsapp-contas-lembretes.server";
import { canDispatch, isQuietHour } from "../src/server/whatsapp-notification-gates.server";
import {
  recordLembreteConta,
  getLembreteConta,
  clearLembreteConta,
  resolveLembreteResposta,
  parseLembreteCommand,
  _resetShortContext,
} from "../src/server/whatsapp-short-context.server";

// ------------------------------------------------------------------
// Fake Supabase client — mesmo shape da suite WA-C9 (in-memory).
// ------------------------------------------------------------------
type Row = Record<string, unknown>;

function buildFake(seed?: {
  contas?: Row[];
  prefs?: Row | null;
  link?: Row | null;
  template?: Row | null;
  msg?: Row[]; // whatsapp_messages
}) {
  const tables: Record<string, Row[]> = {
    whatsapp_notifications: [],
    contas_a_pagar: [...(seed?.contas ?? [])],
    whatsapp_notification_preferences: seed?.prefs ? [seed.prefs] : [],
    whatsapp_links: seed?.link ? [seed.link] : [],
    whatsapp_notification_templates: seed?.template ? [seed.template] : [],
    whatsapp_messages: [...(seed?.msg ?? [])],
    profiles: [],
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
  return { client: { from } as any, tables };
}

// ------------------------------------------------------------------
// Fixture WA-3.38
// ------------------------------------------------------------------
const ADMIN_USER = "u-admin-master";
const OTHER_USER = "u-outro";
const TEL_ADMIN = "+5511900003838";
const TEL_OTHER = "+5511900009999";

// Fixamos "agora" — 2026-07-11 12:00 UTC = 09:00 BRT (fora de quiet hours 21-7).
const NOW = new Date("2026-07-11T12:00:00Z");
const HOJE_BRT = "2026-07-11";

const CONTA_WA_338 = {
  id: "conta-agua-wa338",
  user_id: ADMIN_USER,
  nome: "Água Lembrete WA-3.38",
  valor: 32.18,
  data_vencimento: HOJE_BRT,
  status: "pendente",
  recorrente: false,
  gasto_id: null,
  fornecedor_id: null,
};

// Conta de outro usuário — nunca deve ser tocada.
const CONTA_OUTRO = {
  id: "conta-outro-user",
  user_id: OTHER_USER,
  nome: "Não Mexer",
  valor: 999,
  data_vencimento: HOJE_BRT,
  status: "pendente",
  recorrente: false,
};

function baseSeed() {
  return {
    // Clona para evitar mutação cruzada entre testes (ex.: status → 'pago').
    contas: [{ ...CONTA_WA_338 } as Row, { ...CONTA_OUTRO } as Row],
    prefs: {
      user_id: ADMIN_USER,
      contas_a_pagar: true,
      recorrencias: true,
      metas: false,
      orcamento: false,
      ia_insights: false,
      mercado: false,
      avisos_sistema: true,
      quiet_hours_start: null,
      quiet_hours_end: null,
    } as Row,
    link: {
      user_id: ADMIN_USER,
      ativo: true,
      opt_in_em: "2026-01-01T00:00:00Z",
      revogado_em: null,
    } as Row,
    template: {
      key: "gi_conta_vencendo_hoje",
      meta_template_name: "gi_conta_vencendo_hoje",
      requires_template_window: false,
      active: true,
    } as Row,
    // sessão 24h aberta (mensagem recente do usuário)
    msg: [
      { user_id: ADMIN_USER, created_at: new Date(NOW.getTime() - 60_000).toISOString() },
    ] as Row[],
  };
}

let fake: ReturnType<typeof buildFake>;
beforeEach(() => {
  fake = buildFake(baseSeed());
  _resetShortContext();
});

const contaFetcher = (userId: string) => async () =>
  (fake.tables.contas_a_pagar as Row[])
    .filter((c) => c.user_id === userId && c.status === "pendente")
    .map(
      (c) =>
        ({
          id: c.id,
          nome: c.nome,
          valor: c.valor,
          data_vencimento: c.data_vencimento,
          status: c.status,
          recorrente: c.recorrente,
        }) as ContaPendenteMinimal,
    );

// =====================================================================
// 1) Geração do lembrete
// =====================================================================
describe("WA-3.38 :: geração do lembrete", () => {
  it("cria exatamente 1 notificação sintética para o Admin Master", async () => {
    const out = await gerarLembretesContasUsuario(ADMIN_USER, {
      client: fake.client,
      now: () => NOW,
      fetchContasPendentes: contaFetcher(ADMIN_USER),
    });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("conta_vencendo_hoje");
    expect(fake.tables.whatsapp_notifications).toHaveLength(1);

    const row = fake.tables.whatsapp_notifications[0] as Row;
    // tipo e categoria corretos
    expect(row.notification_type).toBe("gi_conta_vencendo_hoje");
    expect(row.category).toBe("contas_a_pagar");
    // vínculo pela conta correta
    expect(row.entity_type).toBe("conta_a_pagar");
    expect(row.entity_id).toBe(CONTA_WA_338.id);
    expect(row.user_id).toBe(ADMIN_USER);
    // dedupe_key determinístico
    expect(row.dedupe_key).toBe(`payable_due:${CONTA_WA_338.id}:${HOJE_BRT}:conta_vencendo_hoje`);
    // payload: só IDs/centavos/date/type — sem nome, sem descrição
    const payload = row.payload as Row;
    expect(payload.conta_id).toBe(CONTA_WA_338.id);
    expect(payload.due_date).toBe(HOJE_BRT);
    expect(payload.valor_centavos).toBe(3218);
    expect(payload.type).toBe("conta_vencendo_hoje");
    expect(payload.nome).toBeUndefined();
    // nenhum vestígio do texto sensível persistido
    expect(JSON.stringify(payload)).not.toContain("Água Lembrete");
  });

  it("nenhuma conta de outro usuário é considerada", async () => {
    await gerarLembretesContasUsuario(ADMIN_USER, {
      client: fake.client,
      now: () => NOW,
      fetchContasPendentes: contaFetcher(ADMIN_USER),
    });
    const rows = fake.tables.whatsapp_notifications as Row[];
    for (const r of rows) expect(r.user_id).toBe(ADMIN_USER);
    for (const r of rows) expect(r.entity_id).not.toBe(CONTA_OUTRO.id);
  });

  it("segunda geração é idempotente (não duplica)", async () => {
    const deps = {
      client: fake.client,
      now: () => NOW,
      fetchContasPendentes: contaFetcher(ADMIN_USER),
    };
    await gerarLembretesContasUsuario(ADMIN_USER, deps);
    await gerarLembretesContasUsuario(ADMIN_USER, deps);
    expect(fake.tables.whatsapp_notifications).toHaveLength(1);
  });
});

// =====================================================================
// 2) Gates + revalidação (dispatcher dry-run)
// =====================================================================
describe("WA-3.38 :: gates e revalidação (dry-run)", () => {
  it("canDispatch.allow=true; isQuietHour=false para Admin Master", async () => {
    const decision = await canDispatch(
      {
        userId: ADMIN_USER,
        category: "contas_a_pagar",
        requiresTemplateWindow: false,
        hasMetaTemplate: true,
      },
      { client: fake.client, now: () => NOW },
    );
    expect(decision.allow).toBe(true);
    // Admin Master não tem quiet hours configuradas → gate por hora nunca bloqueia.
    expect(isQuietHour(9, null, null)).toBe(false);
  });

  it("revalidateContaForDispatch confirma que a conta continua elegível", async () => {
    await gerarLembretesContasUsuario(ADMIN_USER, {
      client: fake.client,
      now: () => NOW,
      fetchContasPendentes: contaFetcher(ADMIN_USER),
    });
    const n = fake.tables.whatsapp_notifications[0] as Row;
    const res = await revalidateContaForDispatch(
      {
        user_id: n.user_id as string,
        category: n.category as string,
        entity_type: n.entity_type as string,
        entity_id: n.entity_id as string,
        payload: n.payload as Row,
      },
      { client: fake.client },
    );
    expect(res.ok).toBe(true);
    // status NÃO deve ter virado 'sent' — ainda pending no dry-run.
    expect(n.status ?? "pending").toBe("pending");
  });

  it("se a conta virar 'pago' antes do envio, revalidação bloqueia com payable_paid", async () => {
    await gerarLembretesContasUsuario(ADMIN_USER, {
      client: fake.client,
      now: () => NOW,
      fetchContasPendentes: contaFetcher(ADMIN_USER),
    });
    // muta a conta
    (fake.tables.contas_a_pagar[0] as Row).status = "pago";
    const n = fake.tables.whatsapp_notifications[0] as Row;
    const res = await revalidateContaForDispatch(
      {
        user_id: n.user_id as string,
        category: n.category as string,
        entity_type: n.entity_type as string,
        entity_id: n.entity_id as string,
        payload: n.payload as Row,
      },
      { client: fake.client },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("payable_paid");
  });
});

// =====================================================================
// 3) Payload interativo (texto + quick replies)
// =====================================================================
describe("WA-3.38 :: payload interativo", () => {
  it("texto contém valor BRL correto (R$ 32,18) e referência de vencimento", () => {
    const r = renderLembreteConta({
      type: "conta_vencendo_hoje",
      valorCentavos: 3218,
      nomeCurto: "Água Lembrete WA-3.38",
      dueISO: HOJE_BRT,
    });
    expect(r.text).toContain("R$ 32,18");
    // Nome curto pode aparecer entre aspas — validamos que aparece.
    expect(r.text).toContain("Água Lembrete WA-3.38");
    // Contém as duas ações rápidas obrigatórias.
    expect(r.text).toContain("Paguei");
    expect(r.text).toContain("Adiar");
    // Não expõe IDs internos, user_id, UUIDs, dedupe_key.
    expect(r.text).not.toContain(CONTA_WA_338.id);
    expect(r.text).not.toContain(ADMIN_USER);
    expect(r.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
    expect(r.text).not.toContain("payable_due:");
    expect(r.text).not.toContain("conta_id");
  });

  it("quickReplies inclui 'Paguei' e 'Adiar' como ações rápidas", () => {
    const r = renderLembreteConta({
      type: "conta_vencendo_hoje",
      valorCentavos: 3218,
      nomeCurto: "Água Lembrete WA-3.38",
      dueISO: HOJE_BRT,
    });
    expect(r.quickReplies).toContain("Paguei");
    expect(r.quickReplies).toContain("Adiar");
  });

  it("action IDs internos são opacos (nunca embutem user_id / conta_id no texto)", () => {
    // O action ID usado pelo webhook é o `provider_message_id` do lembrete +
    // o rótulo da quick reply. Nenhum ID interno do banco vai para o texto.
    const r = renderLembreteConta({
      type: "conta_vencendo_hoje",
      valorCentavos: 3218,
      nomeCurto: "Água Lembrete WA-3.38",
      dueISO: HOJE_BRT,
    });
    for (const qr of r.quickReplies) {
      expect(qr).not.toContain(CONTA_WA_338.id);
      expect(qr).not.toContain(ADMIN_USER);
      expect(qr).not.toContain("payable_due");
    }
  });
});

// =====================================================================
// 4) Resposta "Paguei"
// =====================================================================
describe("WA-3.38 :: resposta 'Paguei'", () => {
  it("classifica 'Paguei' (e '1') como kind=paguei e localiza APENAS a conta sintética", () => {
    recordLembreteConta(TEL_ADMIN, {
      contaId: CONTA_WA_338.id,
      notificationId: "notif-338",
      nomeCurto: CONTA_WA_338.nome,
      dueISO: HOJE_BRT,
    });
    expect(resolveLembreteResposta(TEL_ADMIN, "Paguei")?.kind).toBe("paguei");
    expect(resolveLembreteResposta(TEL_ADMIN, "1")?.kind).toBe("paguei");
    // Contexto continua apontando exclusivamente para a fixture — nunca outra conta.
    const ctx = getLembreteConta(TEL_ADMIN);
    expect(ctx?.contaId).toBe(CONTA_WA_338.id);
  });

  it("nenhum gasto foi criado durante a classificação (sem escrita financeira)", () => {
    recordLembreteConta(TEL_ADMIN, {
      contaId: CONTA_WA_338.id,
      notificationId: "notif-338",
      nomeCurto: CONTA_WA_338.nome,
      dueISO: HOJE_BRT,
    });
    resolveLembreteResposta(TEL_ADMIN, "Paguei");
    // Fake não tem tabela `gastos` — mas se tivesse, seguiria vazia.
    expect(fake.tables.gastos ?? []).toEqual([]);
    // A conta continua pendente até a confirmação real.
    expect((fake.tables.contas_a_pagar[0] as Row).status).toBe("pendente");
  });
});

// =====================================================================
// 5) Resposta "Adiar"
// =====================================================================
describe("WA-3.38 :: resposta 'Adiar'", () => {
  it("classifica 'Adiar para sexta' com novaData='sexta' e nunca altera vencimento", () => {
    recordLembreteConta(TEL_ADMIN, {
      contaId: CONTA_WA_338.id,
      notificationId: "notif-338",
      nomeCurto: CONTA_WA_338.nome,
      dueISO: HOJE_BRT,
    });
    const r = resolveLembreteResposta(TEL_ADMIN, "Adiar para sexta");
    expect(r?.kind).toBe("adiar");
    if (r?.kind === "adiar") expect(r.novaData).toBe("sexta");
    // Vencimento intocado — só será alterado após confirmação real do usuário.
    expect((fake.tables.contas_a_pagar[0] as Row).data_vencimento).toBe(HOJE_BRT);
  });

  it("'2' isolado também dispara Adiar (novaData=null → fluxo pede a data)", () => {
    recordLembreteConta(TEL_ADMIN, {
      contaId: CONTA_WA_338.id,
      notificationId: "notif-338",
      nomeCurto: CONTA_WA_338.nome,
      dueISO: HOJE_BRT,
    });
    const r = resolveLembreteResposta(TEL_ADMIN, "2");
    expect(r?.kind).toBe("adiar");
    if (r?.kind === "adiar") expect(r.novaData).toBeNull();
  });
});

// =====================================================================
// 6) Segurança e idempotência
// =====================================================================
describe("WA-3.38 :: segurança e idempotência", () => {
  it("replay da mesma ação não cria duplicidade (RAM idempotente)", () => {
    recordLembreteConta(TEL_ADMIN, {
      contaId: CONTA_WA_338.id,
      notificationId: "notif-338",
      nomeCurto: CONTA_WA_338.nome,
      dueISO: HOJE_BRT,
    });
    const r1 = resolveLembreteResposta(TEL_ADMIN, "Paguei");
    const r2 = resolveLembreteResposta(TEL_ADMIN, "Paguei");
    expect(r1?.kind).toBe("paguei");
    expect(r2?.kind).toBe("paguei");
    // Contexto RAM continua único; nenhum novo lembrete criado.
    expect(fake.tables.whatsapp_notifications).toHaveLength(0);
  });

  it("action de OUTRO usuário (RAM sob telefone diferente) NÃO resolve conta do Admin", () => {
    // Grava ctx para admin
    recordLembreteConta(TEL_ADMIN, {
      contaId: CONTA_WA_338.id,
      notificationId: "notif-338",
      nomeCurto: CONTA_WA_338.nome,
      dueISO: HOJE_BRT,
    });
    // Outro telefone (outro usuário) responde "Paguei" — não deve resolver nada.
    expect(resolveLembreteResposta(TEL_OTHER, "Paguei")).toBeNull();
  });

  it("action ID expirado / sem contexto RAM retorna null (falha segura)", () => {
    clearLembreteConta(TEL_ADMIN);
    expect(resolveLembreteResposta(TEL_ADMIN, "Paguei")).toBeNull();
    expect(resolveLembreteResposta(TEL_ADMIN, "1")).toBeNull();
  });

  it("parser puro é seguro para texto arbitrário (retorna null p/ não-match)", () => {
    expect(parseLembreteCommand("copiar chave pix")).toBeNull();
    expect(parseLembreteCommand("")).toBeNull();
    expect(parseLembreteCommand("dropar tabela")).toBeNull();
  });
});

// =====================================================================
// 7) Limpeza
// =====================================================================
describe("WA-3.38 :: limpeza", () => {
  it("cancelarLembretesDaConta remove APENAS o lembrete do Admin e não toca outros", async () => {
    // Cria o lembrete para o admin
    await gerarLembretesContasUsuario(ADMIN_USER, {
      client: fake.client,
      now: () => NOW,
      fetchContasPendentes: contaFetcher(ADMIN_USER),
    });
    // Também cria para o outro usuário — precisa ficar intocado.
    await gerarLembretesContasUsuario(OTHER_USER, {
      client: fake.client,
      now: () => NOW,
      fetchContasPendentes: contaFetcher(OTHER_USER),
    });
    expect(fake.tables.whatsapp_notifications).toHaveLength(2);

    const n = await cancelarLembretesDaConta(ADMIN_USER, CONTA_WA_338.id, {
      client: fake.client,
    });
    expect(n).toBe(1);

    const adminRow = (fake.tables.whatsapp_notifications as Row[]).find(
      (r) => r.user_id === ADMIN_USER,
    ) as Row;
    const outroRow = (fake.tables.whatsapp_notifications as Row[]).find(
      (r) => r.user_id === OTHER_USER,
    ) as Row;
    expect(adminRow.status).toBe("cancelled");
    expect(outroRow.status ?? "pending").toBe("pending");
  });
});
