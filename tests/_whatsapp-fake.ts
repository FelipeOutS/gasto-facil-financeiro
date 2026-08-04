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
  const ctx: any = { 
    table, 
    op: "select", 
    payload: null, 
    filters: {} as Record<string, any>, 
    inFilters: {} as Record<string, any[]>,
    single: false 
  };

  const finalize = async () => {
    if (table === "whatsapp_links") {
      const link = { user_id: "u1", ativo: true, opt_in_em: "2026-01-01T00:00:00Z", revogado_em: null };
      return ctx.single ? { data: link, error: null } : { data: [link], error: null };
    }

    const matchesFilters = (row: Record<string, unknown>, idx: number) => {
      for (let [col, val] of Object.entries(ctx.filters)) {
        let actual = row[col];
        if (col.includes("->>")) {
           const parts = col.split("->>");
           actual = (row[parts[0]] as any)?.[parts[1]];
        }
        if (col === "id" && !row.id) actual = `m-${idx + 1}`;
        if (actual !== val) return false;
      }
      for (let [col, vals] of Object.entries(ctx.inFilters)) {
        let actual = row[col];
        if (col === "id" && !row.id) actual = `m-${idx + 1}`;
        if (!vals.includes(actual)) return false;
      }
      return true;
    };

    if (ctx.op === "insert") {
      const rows = Array.isArray(ctx.payload) ? ctx.payload : [ctx.payload];
      const insertedRows: any[] = [];
      for (const r of rows) {
        const newRow = { 
          ...r, 
          id: r.id || `m-${state.inserts.length + 1}`,
          recebida_em: r.recebida_em || new Date().toISOString()
        };
        state.inserts.push({ table, row: newRow });
        insertedRows.push(newRow);
      }
      const lastRow = insertedRows[insertedRows.length - 1];
      if (table === "whatsapp_messages" && PENDING.includes(lastRow.status as string)) {
        state.pendingRow = {
          id: lastRow.id as string,
          status: lastRow.status as string,
          session: lastRow.parsed as Record<string, unknown>,
          recebida_em: lastRow.recebida_em,
          gasto_id: lastRow.gasto_id || null,
        };
      }
      return { data: insertedRows, error: null };
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
        const lastMatching = state.inserts.findLast(i => 
          i.table === table && 
          i.row.user_id && 
          i.row.telefone && 
          !["salva", "cancelada", "expirada"].includes(i.row.status as string)
        )?.row;
        if (lastMatching) {
          state.pendingRow = {
            id: lastMatching.id as string,
            status: lastMatching.status as string,
            session: lastMatching.parsed as Record<string, unknown>,
            recebida_em: lastMatching.recebida_em,
            gasto_id: lastMatching.gasto_id || null,
          };
        } else {
          state.pendingRow = null;
        }
      }
      // CRITICAL: Return single data ifctx.single is true and we matched
      if (ctx.single) return { data: matchedRows[0] || null, error: null };
      return { data: matchedRows.length > 0 ? matchedRows : null, error: null };
    }

    const rows = state.inserts
      .filter((i, idx) => i.table === table && matchesFilters(i.row, idx))
      .map(i => i.row);
      
    if (ctx.single) return { data: rows[0] || null, error: null };
    return { data: rows, error: null };
  };

  const builder: any = {
    select: () => builder,
    insert(p: any) { ctx.op = "insert"; ctx.payload = p; return builder; },
    update(p: any) { ctx.op = "update"; ctx.payload = p; return builder; },
    delete() { ctx.op = "delete"; return builder; },
    eq(c: string, v: any) { ctx.filters[c] = v; return builder; },
    in(c: string, v: any[]) { ctx.inFilters[c] = v; return builder; },
    gte() { return builder; },
    not() { return builder; },
    order() { return builder; },
    limit() { return builder; },
    maybeSingle: () => { ctx.single = true; return finalize(); },
    single: () => { ctx.single = true; return finalize(); },
    selectSingle: () => { ctx.single = true; return finalize(); },
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
      state.inserts.push({ 
        table: "gastos", 
        row: { 
          id: gid, 
          descricao: c?.nome, 
          valor: c?.valor, 
          categoria_id: c?.categoria_id, 
          forma_pagamento: c?.forma_pagamento || "outros", 
          origem: "whatsapp", 
          data: new Date().toISOString().slice(0, 10) 
        } 
      });
      const contaIdx = state.contasData.findIndex(x => x.id === a.p_conta_id);
      if (contaIdx !== -1) { 
        state.contasData[contaIdx] = { ...state.contasData[contaIdx], status: "pago", gasto_id: gid }; 
      }
      return { data: [{ result: "paid", gasto_id: gid }] };
    }
    return { data: true };
  },
  auth: { admin: { getUserById: async () => ({ data: { user: { id: "u1", email: "test@example.com" } }, error: null }) } }
};

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin }));
mock.module("@/server/subscription.server", () => ({ 
  getSubscriptionForUserIdentity: async () => ({ active: true, plan: "pessoal_premium", status: "ativo" }) 
}));
mock.module("@/server/whatsapp-entitlement.server", () => ({ 
  getWhatsAppEntitlement: async () => ({ 
    allowed: true, plan: "pessoal_premium", planActive: true, featureIncluded: true, betaAllowed: true, linkActive: true, optInActive: true 
  }),
  assertWhatsAppEntitlement: async () => ({ allowed: true })
}));
mock.module("@/server/admin-master.server", () => ({ 
  hasAdminMasterRole: async () => true, 
  isAdminMasterEmail: () => true, 
  assertAdminMaster: async () => {} 
}));
mock.module("@/server/whatsapp-financial-quota-gate.server", () => ({ 
  assertFinancialActionQuotaForWhatsApp: async () => ({ allowed: true }),
  financialQuotaBlockedReply: () => "Quota bloqueada"
}));
mock.module("@/server/whatsapp-merchant-memory.server", () => ({ 
  lookupMerchantMemory: async () => ({ kind: "none" }),
  merchantKeyFor: (n: string) => n?.toLowerCase().trim() || null,
  logMerchantMemoryDecision: () => {},
  recordMerchantMemory: async () => ({ ok: true }),
  MERCHANT_MEMORY_HINT_LINE: "mem"
}));

export function resetState(o?: any) { 
  state.inserts = []; 
  state.pendingRow = null; 
  state.contasData = o?.contas ?? [];
  if (o?.contas) {
    o.contas.forEach((c: any) => state.inserts.push({ table: "contas_a_pagar", row: c }));
  }
}
export function gastosInserts() { return state.inserts.filter(i => i.table === "gastos"); }
export function resetCategorias(cats: any[]) { state.categoriasData = cats; }
