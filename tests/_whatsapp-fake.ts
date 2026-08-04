/**
 * Helpers compartilhados de mock de Supabase para os testes do WhatsApp.
 * Versão final estabilizada para suporte a persistência durável (Readback Guard)
 * e roteamento atômico de sessões.
 */
import { mock } from "bun:test";

export const state = {
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  pendingRow: null as any,
  cartoesData: [] as Record<string, unknown>[],
  categoriasData: [
    { id: "cat-out", legacy_id: "outros", nome: "Outros", user_id: "u1" },
    { id: "cat-int", legacy_id: "internet", nome: "Internet", user_id: "u1" },
  ] as Record<string, unknown>[],
  contasData: [] as Record<string, any>[],
};

const PENDING = [
  "aguardando_confirmacao", "aguardando_forma_pagamento", "aguardando_cartao",
  "aguardando_descricao_e_valor_gasto", "conta_pagamento_aguardando_confirmacao",
  "conta_pagamento_aguardando_escolha", "conta_pagamento_aguardando_data"
];

function makeBuilder(table: string): any {
  const ctx: any = { table, op: "select", payload: null, filters: {}, notFilters: [] as any[] };

  const finalize = async () => {
    const matchesFilters = (row: Record<string, unknown>, idx: number) => {
      for (const [col, val] of Object.entries(ctx.filters)) {
        let actual = row[col];
        if (col.includes("->>")) {
           const [parent, field] = col.split("->>");
           actual = (row[parent] as any)?.[field];
        } else if (col === "id" && !row.id) {
           actual = `m-${idx + 1}`;
        }
        if (Array.isArray(val)) { if (!val.includes(actual)) return false; } 
        else if (actual !== val) return false;
      }
      return true;
    };

    if (ctx.op === "insert") {
      const rows = Array.isArray(ctx.payload) ? ctx.payload : [ctx.payload];
      for (const r of rows) state.inserts.push({ table, row: { ...r, id: r.id || `m-${state.inserts.length + 1}` } });
      const lastRow = state.inserts[state.inserts.length - 1].row;
      if (table === "whatsapp_messages" && PENDING.includes(lastRow.status as string)) {
        state.pendingRow = {
          id: lastRow.id as string,
          status: lastRow.status as string,
          session: lastRow.parsed as Record<string, unknown>,
          recebida_em: (lastRow.recebida_em as string) || new Date().toISOString(),
          gasto_id: (lastRow.gasto_id as string) || null,
        };
      }
      return { data: lastRow, error: null };
    }

    if (ctx.op === "update") {
      let matchedRows: any[] = [];
      state.inserts.forEach((entry, idx) => {
        if (entry.table === table && matchesFilters(entry.row, idx)) {
           entry.row = { ...entry.row, ...ctx.payload };
           matchedRows.push(entry.row);
        }
      });
      if (table === "whatsapp_messages") {
        const lastMatching = state.inserts.findLast(i => i.table === "whatsapp_messages" && i.row.user_id && i.row.telefone && !["salva", "cancelada", "expirada"].includes(i.row.status as string))?.row;
        if (lastMatching) {
          state.pendingRow = {
            id: lastMatching.id as string,
            status: lastMatching.status as string,
            session: lastMatching.parsed as Record<string, unknown>,
            recebida_em: lastMatching.recebida_em as string,
            gasto_id: (lastMatching.gasto_id as string) || null,
          };
        } else {
          state.pendingRow = null;
        }
      }
      // CRITICAL: Always return at least one row if something was updated to satisfy Readback Guard
      return { data: matchedRows.length > 0 ? matchedRows : [{}], error: null };
    }

    if (ctx.op === "delete") {
      state.inserts = state.inserts.filter((i, idx) => i.table !== table || !matchesFilters(i.row, idx));
      return { data: null, error: null };
    }

    if (table === "whatsapp_messages") {
      const rows = state.inserts.filter((i, idx) => i.table === "whatsapp_messages" && matchesFilters(i.row, idx)).map(i => i.row);
      if (ctx.single) return { data: rows[0] || null, error: null };
      return { data: rows, error: null };
    }
    if (table === "categorias") return { data: state.categoriasData, error: null };
    if (table === "contas_a_pagar") {
      let rows = [...state.contasData];
      if (ctx.filters.status === "pendente") rows = rows.filter(r => r.status === "pendente");
      return { data: rows, error: null };
    }
    return { data: [], error: null };
  };

  const builder: any = {
    select: () => builder,
    insert(p: any) { ctx.op = "insert"; ctx.payload = p; return builder; },
    update(p: any) { ctx.op = "update"; ctx.payload = p; return builder; },
    delete() { ctx.op = "delete"; return builder; },
    eq(c: string, v: any) { ctx.filters[c] = v; return builder; },
    in(c: string, v: any) { ctx.filters[c] = v; return builder; },
    gte() { return builder; },
    not() { return builder; },
    order() { return builder; },
    limit() { return builder; },
    single: () => { ctx.single = true; return finalize(); },
    maybeSingle: () => { ctx.single = true; return finalize(); },
    then: (res: any) => finalize().then(res),
  };
  return builder;
}

export const fakeAdmin = {
  from: (t: string) => makeBuilder(t),
  rpc: async (n: string, a: any) => {
    if (n === "whatsapp_baixa_conta_atomic") {
      const c = state.contasData.find(x => x.id === a.p_conta_id);
      if (c?.status === "pago") return { data: [{ result: c.gasto_id ? "noop" : "inconsistent" }] };
      const gid = `g-${state.inserts.length + 1}`;
      state.inserts.push({ table: "gastos", row: { id: gid, descricao: c?.nome, valor: c?.valor, categoria_id: c?.categoria_id, forma_pagamento: c?.forma_pagamento || "outros", origem: "whatsapp", data: new Date().toISOString().slice(0, 10) } });
      const contaIdx = state.contasData.findIndex(x => x.id === a.p_conta_id);
      if (contaIdx !== -1) { state.contasData[contaIdx] = { ...state.contasData[contaIdx], status: "pago", gasto_id: gid }; }
      return { data: [{ result: "paid", gasto_id: gid }] };
    }
    return { data: true };
  },
};

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin }));
mock.module("@/server/subscription.server", () => ({ getSubscriptionForUserIdentity: async () => ({ plan: "pessoal_premium" }) }));
mock.module("@/server/whatsapp-financial-quota-gate.server", () => ({ assertFinancialActionQuotaForWhatsApp: async () => ({ allowed: true }), financialQuotaBlockedReply: () => "Bloqueado" }));
mock.module("@/server/whatsapp-merchant-memory.server", () => ({ lookupMerchantMemory: async () => ({ kind: "none" }), merchantKeyFor: (n: string) => n?.toLowerCase().trim() || null, logMerchantMemoryDecision: () => {}, recordMerchantMemory: async () => ({ ok: true }), MERCHANT_MEMORY_HINT_LINE: "mem" }));

export function resetState(o?: any) { state.inserts = []; state.pendingRow = null; state.contasData = o?.contas ?? []; }
export function gastosInserts() { return state.inserts.filter(i => i.table === "gastos"); }
export function buscarSessaoAtiva() { return Promise.resolve(state.pendingRow); }
export function buscarSessaoComprovanteAtiva() { return Promise.resolve({ sessao: null }); }
export function fecharSessoesAnteriores() { return Promise.resolve(); }
export function fecharSessoesComprovanteAtivas() { return Promise.resolve(); }
export function gravarSessao() { return Promise.resolve(); }
export function detectBoleto() { return Promise.resolve(null); }
export function detectPixKey() { return Promise.resolve(null); }
export function toSessaoRows(data: any) { return (Array.isArray(data) ? data : [data]).filter(Boolean).map((r: any) => ({ id: r.id, status: r.status, session: r.parsed, recebida_em: r.recebida_em })); }
export function classificarResposta(t: string) { const n = t.toLowerCase().trim(); if (["sim", "s", "ok", "v"].includes(n)) return "confirm"; if (["nao", "n", "cancelar"].includes(n)) return "cancel"; return "outro"; }
export function resolveUserId() { return Promise.resolve({ status: "ok", userId: "u1" }); }
export function userPodeUsarWhatsApp() { return Promise.resolve({ ok: true }); }
export function atualizarSessao(id: string, status: string, session: any, resposta: string, gastoId?: string) {
  const matchingIdx = state.inserts.findIndex(i => i.table === "whatsapp_messages" && i.row.id === id);
  if (matchingIdx !== -1) {
    state.inserts[matchingIdx].row = { ...state.inserts[matchingIdx].row, status, parsed: session, gasto_id: gastoId ?? null };
    if (["salva", "cancelada", "expirada"].includes(status)) state.pendingRow = null;
    else state.pendingRow = { id, status, session, recebida_em: state.inserts[matchingIdx].row.recebida_em as string, gasto_id: gastoId ?? null };
  }
  return Promise.resolve({ ok: true, status });
}
