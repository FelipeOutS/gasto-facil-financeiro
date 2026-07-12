/**
 * WA-C9.1 — Ciclo de vida seguro dos lembretes de Contas a Pagar.
 *
 * Cobre:
 *  - Rechecagem final (`revalidateContaForDispatch`).
 *  - Fallback persistente (`findRecentSentLembreteForUser`).
 *  - Estado terminal: `markFailed` nunca ressuscita cancelled/skipped.
 *  - Cancelamento via entidade isolado por user_id.
 *
 * Nenhum envio real é executado.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  cancelarLembretesDaConta,
  revalidateContaForDispatch,
  findRecentSentLembreteForUser,
} from "../src/server/whatsapp-contas-lembretes.server";
import {
  markFailed,
  cancelByEntity,
} from "../src/server/whatsapp-notifications.server";
import {
  parseLembreteCommand,
  _resetShortContext,
} from "../src/server/whatsapp-short-context.server";

// ------------- Fake Supabase (mesma forma usada em WA-C9) -------------
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
      select() { return api; },
      eq(c: string, v: unknown) { ctx.filters.push((r) => r[c] === v); return api; },
      in(c: string, vs: unknown[]) { ctx.filters.push((r) => vs.includes(r[c])); return api; },
      lte(c: string, v: unknown) { ctx.filters.push((r) => String(r[c]) <= String(v)); return api; },
      gte(c: string, v: unknown) { ctx.filters.push((r) => String(r[c]) >= String(v)); return api; },
      order(col: string, opts?: { ascending?: boolean }) {
        ctx.orderBy = col; ctx.orderAsc = opts?.ascending ?? true; return api;
      },
      limit(n: number) { ctx.limitN = n; return api; },
      async maybeSingle() {
        const rows = applyAll();
        return { data: rows[0] ?? null, error: null };
      },
      then(resolve: (v: { data: Row[]; error: null }) => unknown) {
        return Promise.resolve(resolve({ data: applyAll() as Row[], error: null }));
      },
      update(patch: Row) { ctx.updatePatch = patch; return api; },
    });
    return api;
  }

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: { from } as any,
    tables,
  };
}

let fake: ReturnType<typeof buildFake>;
beforeEach(() => {
  fake = buildFake();
  _resetShortContext();
});

function addNotif(over: Partial<Row> = {}) {
  const base: Row = {
    id: `n-${fake.tables.whatsapp_notifications.length + 1}`,
    user_id: "u1",
    notification_type: "gi_conta_vencendo_hoje",
    category: "contas_a_pagar",
    status: "pending",
    priority: "alta",
    scheduled_at: "2026-06-28T11:00:00Z",
    attempt_count: 0,
    max_attempts: 5,
    next_attempt_at: null,
    payload: { conta_id: "c-1", due_date: "2026-06-28", valor_centavos: 12000 },
    payload_version: 1,
    dedupe_key: "payable_due:c-1:2026-06-28:conta_vencendo_hoje",
    entity_type: "conta_a_pagar",
    entity_id: "c-1",
    sent_at: null,
    failed_at: null,
    cancelled_at: null,
    skipped_reason: null,
    provider_message_id: null,
    last_error_code: null,
  };
  const row = { ...base, ...over };
  fake.tables.whatsapp_notifications.push(row);
  return row;
}

function addConta(over: Partial<Row> = {}) {
  const base: Row = {
    id: "c-1",
    user_id: "u1",
    status: "pendente",
    data_vencimento: "2026-06-28",
    valor: 120,
  };
  const row = { ...base, ...over };
  fake.tables.contas_a_pagar.push(row);
  return row;
}

// ====================================================================
// Cancelamento por entidade — isolamento entre usuários
// ====================================================================
describe("WA-C9.1 :: cancelarLembretesDaConta", () => {
  it("cancela lembrete pendente da conta correta", async () => {
    addNotif();
    const n = await cancelarLembretesDaConta("u1", "c-1", { client: fake.client });
    expect(n).toBe(1);
    expect(fake.tables.whatsapp_notifications[0].status).toBe("cancelled");
  });

  it("não toca lembrete de outro usuário", async () => {
    addNotif({ id: "n-x", user_id: "u2" });
    const n = await cancelarLembretesDaConta("u1", "c-1", { client: fake.client });
    expect(n).toBe(0);
    expect(fake.tables.whatsapp_notifications[0].status).toBe("pending");
  });

  it("não toca lembrete de outra conta", async () => {
    addNotif({ entity_id: "c-2" });
    const n = await cancelarLembretesDaConta("u1", "c-1", { client: fake.client });
    expect(n).toBe(0);
  });

  it("não revive lembrete já cancelled (cancelByEntity filtra pending)", async () => {
    addNotif({ status: "cancelled" });
    const n = await cancelByEntity("u1", "conta_a_pagar", "c-1", { client: fake.client });
    expect(n).toBe(0);
  });
});

// ====================================================================
// Rechecagem final do dispatcher
// ====================================================================
describe("WA-C9.1 :: revalidateContaForDispatch", () => {
  it("conta pendente e idêntica → ok", async () => {
    addConta();
    const n = addNotif();
    const r = await revalidateContaForDispatch(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      n as any, { client: fake.client },
    );
    expect(r.ok).toBe(true);
  });

  it("conta paga → payable_paid", async () => {
    addConta({ status: "pago" });
    const n = addNotif();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await revalidateContaForDispatch(n as any, { client: fake.client });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("payable_paid");
  });

  it("conta cancelada → payable_cancelled", async () => {
    addConta({ status: "cancelado" });
    const n = addNotif();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await revalidateContaForDispatch(n as any, { client: fake.client });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("payable_cancelled");
  });

  it("vencimento mudou → payable_changed", async () => {
    addConta({ data_vencimento: "2026-07-10" });
    const n = addNotif(); // payload due_date: 2026-06-28
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await revalidateContaForDispatch(n as any, { client: fake.client });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("payable_changed");
  });

  it("valor mudou → payable_changed", async () => {
    addConta({ valor: 150 }); // 15000 centavos
    const n = addNotif();     // payload valor_centavos: 12000
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await revalidateContaForDispatch(n as any, { client: fake.client });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("payable_changed");
  });

  it("conta inexistente / outro user → payable_not_found", async () => {
    addConta({ user_id: "u2" });
    const n = addNotif();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await revalidateContaForDispatch(n as any, { client: fake.client });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("payable_not_found");
  });

  it("categoria diferente passa direto (ok)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await revalidateContaForDispatch({
      user_id: "u1", category: "metas", entity_type: null, entity_id: null, payload: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any, { client: fake.client });
    expect(r.ok).toBe(true);
  });
});

// ====================================================================
// markFailed nunca ressuscita cancelled/skipped
// ====================================================================
describe("WA-C9.1 :: markFailed respeita estados terminais", () => {
  it("notificação cancelled não volta para pending", async () => {
    const n = addNotif({ status: "cancelled" });
    await markFailed(String(n.id), "boom", { retryable: true, currentAttempt: 0, maxAttempts: 5 }, null, { client: fake.client });
    expect(fake.tables.whatsapp_notifications[0].status).toBe("cancelled");
  });

  it("notificação skipped não volta para pending", async () => {
    const n = addNotif({ status: "skipped", skipped_reason: "payable_paid" });
    await markFailed(String(n.id), "boom", { retryable: true, currentAttempt: 0, maxAttempts: 5 }, null, { client: fake.client });
    expect(fake.tables.whatsapp_notifications[0].status).toBe("skipped");
  });

  it("notificação processing pode voltar a pending (retry normal)", async () => {
    const n = addNotif({ status: "processing" });
    await markFailed(String(n.id), "transient", { retryable: true, currentAttempt: 0, maxAttempts: 5 }, null, { client: fake.client });
    expect(fake.tables.whatsapp_notifications[0].status).toBe("pending");
  });
});

// ====================================================================
// Fallback persistente após restart
// ====================================================================
describe("WA-C9.1 :: findRecentSentLembreteForUser", () => {
  const RECENT = new Date("2026-06-28T10:00:00Z").toISOString();
  const NOW = () => new Date("2026-06-28T12:00:00Z");

  it("um único lembrete enviado recentemente → single", async () => {
    addNotif({ status: "sent", sent_at: RECENT });
    const r = await findRecentSentLembreteForUser("u1", {}, { client: fake.client, now: NOW });
    expect(r.kind).toBe("single");
    if (r.kind === "single") expect(r.contaId).toBe("c-1");
  });

  it("dois lembretes de contas distintas → ambiguous", async () => {
    addNotif({ status: "sent", sent_at: RECENT, entity_id: "c-1" });
    addNotif({ id: "n-2", status: "sent", sent_at: RECENT, entity_id: "c-2",
      dedupe_key: "payable_due:c-2:2026-06-28:conta_vencendo_hoje" });
    const r = await findRecentSentLembreteForUser("u1", {}, { client: fake.client, now: NOW });
    expect(r.kind).toBe("ambiguous");
  });

  it("nenhum lembrete recente → none", async () => {
    const r = await findRecentSentLembreteForUser("u1", {}, { client: fake.client, now: NOW });
    expect(r.kind).toBe("none");
  });

  it("lembrete sent fora da janela 24h → none", async () => {
    addNotif({ status: "sent", sent_at: new Date("2026-06-25T12:00:00Z").toISOString() });
    const r = await findRecentSentLembreteForUser("u1", {}, { client: fake.client, now: NOW });
    expect(r.kind).toBe("none");
  });

  it("não acessa lembrete de outro usuário", async () => {
    addNotif({ status: "sent", sent_at: RECENT, user_id: "u2" });
    const r = await findRecentSentLembreteForUser("u1", {}, { client: fake.client, now: NOW });
    expect(r.kind).toBe("none");
  });

  it("provider_message_id (reply_to) tem prioridade", async () => {
    addNotif({ status: "sent", sent_at: RECENT, entity_id: "c-1", provider_message_id: "wamid.AAA" });
    addNotif({ id: "n-2", status: "sent", sent_at: RECENT, entity_id: "c-2", provider_message_id: "wamid.BBB",
      dedupe_key: "payable_due:c-2:2026-06-28:conta_vencendo_hoje" });
    const r = await findRecentSentLembreteForUser("u1", { providerMessageId: "wamid.BBB" }, { client: fake.client, now: NOW });
    expect(r.kind).toBe("single");
    if (r.kind === "single") expect(r.contaId).toBe("c-2");
  });
});

// ====================================================================
// parseLembreteCommand (parser puro reusado pelo fallback)
// ====================================================================
describe("WA-C9.1 :: parseLembreteCommand", () => {
  it("reconhece os 4 atalhos", () => {
    expect(parseLembreteCommand("Paguei")?.kind).toBe("paguei");
    expect(parseLembreteCommand("já paguei")?.kind).toBe("paguei");
    expect(parseLembreteCommand("Adiar para sexta")?.kind).toBe("adiar");
    expect(parseLembreteCommand("ver detalhes")?.kind).toBe("detalhes");
    expect(parseLembreteCommand("Ignorar")?.kind).toBe("ignorar");
    expect(parseLembreteCommand("1")?.kind).toBe("paguei");
    expect(parseLembreteCommand("4")?.kind).toBe("ignorar");
  });

  it("texto vago retorna null (não dispara baixa)", () => {
    expect(parseLembreteCommand("oi")).toBeNull();
    expect(parseLembreteCommand("")).toBeNull();
    expect(parseLembreteCommand("qual o pix dele?")).toBeNull();
  });
});
