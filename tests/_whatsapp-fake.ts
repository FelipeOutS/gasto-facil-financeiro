import { mock } from "bun:test";

export const state = {
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  pendingRow: null as any,
  cartoesData: [{ id: "c-nu", nome: "Nubank", user_id: "u1", ultimos_digitos: "1234" }] as Record<
    string,
    unknown
  >[],
  categoriasData: [
    { id: "cat-out", legacy_id: "outros", nome: "Outros", user_id: "u1" },
    { id: "cat-int", legacy_id: "internet", nome: "Internet", user_id: "u1" },
  ] as Record<string, unknown>[],
  contasData: [] as Record<string, any>[],
};

function makeBuilder(table: string): any {
  const ctx: any = {
    table,
    op: "select",
    payload: null,
    filters: {} as Record<string, any>,
    inFilters: {} as Record<string, any[]>,
    single: false,
    selectCols: "*",
  };

  const finalize = async () => {
    if (ctx.op === "select") {
      if (table === "whatsapp_links") {
        const link = {
          user_id: "u1",
          telefone: "5511999998888",
          ativo: true,
          opt_in_em: "2026-01-01T00:00:00Z",
          revogado_em: null,
        };
        return ctx.single ? { data: link, error: null } : { data: [link], error: null };
      }
      if (table === "cartoes") return { data: state.cartoesData, error: null };
      if (table === "categorias") return { data: state.categoriasData, error: null };

      // Consultas de conta para o Readback Guard em persistirBaixa
      if (table === "contas_a_pagar") {
        const rows = state.contasData.filter((r, idx) => {
          for (const [col, val] of Object.entries(ctx.filters)) {
            let actual = r[col];
            if (col === "id" && !r.id) actual = `m-${idx + 1}`;
            if (actual !== val) return false;
          }
          return true;
        });
        return { data: ctx.single ? rows[0] || null : rows, error: null };
      }
    }

    const matchesFilters = (row: Record<string, unknown>, idx: number) => {
      for (const [col, val] of Object.entries(ctx.filters)) {
        let actual = row[col];
        if (col.includes("->>")) actual = (row[col.split("->>")[0]] as any)?.[col.split("->>")[1]];
        if (col === "id" && !row.id) actual = `m-${idx + 1}`;
        if (actual !== val) return false;
      }
      for (const [col, vals] of Object.entries(ctx.inFilters)) {
        let actual = row[col];
        if (col.includes("->>")) actual = (row[col.split("->>")[0]] as any)?.[col.split("->>")[1]];
        if (col === "id" && !row.id) actual = `m-${idx + 1}`;
        if (!vals.includes(actual)) return false;
      }
      return true;
    };

    const syncPending = () => {
      const last = state.inserts.findLast(
        (i) =>
          i.table === "whatsapp_messages" &&
          i.row.user_id &&
          i.row.telefone &&
          !["salva", "cancelada", "expirada"].includes(i.row.status as string),
      )?.row;
      state.pendingRow = last
        ? {
            id: last.id,
            status: last.status,
            session: last.parsed || last.session,
            recebida_em: last.recebida_em,
            gasto_id: last.gasto_id || null,
          }
        : null;
    };

    if (ctx.op === "insert") {
      const rows = Array.isArray(ctx.payload) ? ctx.payload : [ctx.payload];
      const inserted: any[] = rows.map((r) => {
        const newRow = {
          ...r,
          id: r.id || `m-${state.inserts.length + 1}`,
          recebida_em: r.recebida_em || new Date().toISOString(),
        };
        state.inserts.push({ table, row: newRow });
        return newRow;
      });
      if (table === "whatsapp_messages") syncPending();
      return { data: ctx.single ? inserted[0] : inserted, error: null };
    }

    if (ctx.op === "update") {
      const matched: any[] = [];
      state.inserts.forEach((entry, idx) => {
        if (entry.table === table && matchesFilters(entry.row, idx)) {
          entry.row = { ...entry.row, ...ctx.payload };
          matched.push(entry.row);
        }
      });
      if (table === "whatsapp_messages") syncPending();
      // Em atualizarSessaoOuFalhar, se faz um update e depois um select.
      // O Supabase JS .update().select() retorna o objeto.
      return { data: ctx.single ? matched[0] || null : matched, error: null };
    }

    const rows = state.inserts
      .filter((i, idx) => i.table === table && matchesFilters(i.row, idx))
      .map((i) => i.row);
    return { data: ctx.single ? rows[0] || null : rows, error: null };
  };

  const builder: any = {
    select: (c: string = "*") => {
      ctx.selectCols = c;
      return builder;
    },
    insert: (p: any) => {
      ctx.op = "insert";
      ctx.payload = p;
      return builder;
    },
    update: (p: any) => {
      ctx.op = "update";
      ctx.payload = p;
      return builder;
    },
    eq: (c: string, v: any) => {
      ctx.filters[c] = v;
      return builder;
    },
    in: (c: string, v: any[]) => {
      ctx.inFilters[c] = v;
      return builder;
    },
    maybeSingle: () => {
      ctx.single = true;
      return finalize();
    },
    single: () => {
      ctx.single = true;
      return finalize();
    },
    selectSingle: () => {
      ctx.single = true;
      return finalize();
    },
    limit: () => builder,
    order: () => builder,
    gte: () => builder,
    not: () => builder,
    delete: () => builder,
    then: (res: any) => finalize().then(res),
  };
  return builder;
}

export const fakeAdmin = {
  from: (t: string) => makeBuilder(t),
  rpc: async (n: string, a: any) => {
    if (n === "whatsapp_baixa_conta_atomic") {
      const c = state.contasData.find((x) => x.id === a.p_conta_id);
      if (c?.status === "pago") return { data: [{ result: c.gasto_id ? "noop" : "inconsistent" }] };
      const gid = `g-${state.inserts.length + 1}`;
      state.inserts.push({
        table: "gastos",
        row: {
          id: gid,
          user_id: "u1",
          descricao: c?.nome,
          valor: c?.valor,
          categoria_id: c?.categoria_id,
          forma_pagamento: c?.forma_pagamento || "outros",
          origem: "whatsapp",
          data: new Date().toISOString().slice(0, 10),
          cartao_id: c?.cartao_id || null,
        },
      });
      const idx = state.contasData.findIndex((x) => x.id === a.p_conta_id);
      if (idx !== -1)
        state.contasData[idx] = { ...state.contasData[idx], status: "pago", gasto_id: gid };
      return { data: { result: "paid", gasto_id: gid } }; // RPC no PostgREST retorna objeto se single row ou array.
    }
    return { data: true };
  },
  auth: {
    admin: {
      getUserById: async () => ({
        data: { user: { id: "u1", email: "test@example.com" } },
        error: null,
      }),
    },
  },
};

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin }));
mock.module("@/server/subscription.server", () => ({
  getSubscriptionForUserIdentity: async () => ({
    active: true,
    plan: "pessoal_premium",
    status: "ativo",
  }),
}));
mock.module("@/server/whatsapp-entitlement.server", () => ({
  getWhatsAppEntitlement: async () => ({
    allowed: true,
    plan: "pessoal_premium",
    planActive: true,
    featureIncluded: true,
    betaAllowed: true,
    linkActive: true,
    optInActive: true,
  }),
  assertWhatsAppEntitlement: async () => ({ allowed: true }),
}));
mock.module("@/server/admin-master.server", () => ({
  hasAdminMasterRole: async () => true,
  isAdminMasterEmail: () => true,
  assertAdminMaster: async () => {},
}));
mock.module("@/server/whatsapp-financial-quota-gate.server", () => ({
  assertFinancialActionQuotaForWhatsApp: async () => ({ allowed: true }),
  financialQuotaBlockedReply: () => "Quota bloqueada",
}));
mock.module("@/server/whatsapp-merchant-memory.server", () => ({
  lookupMerchantMemory: async () => ({ kind: "none" }),
  merchantKeyFor: (n: string) => n?.toLowerCase().trim() || null,
  logMerchantMemoryDecision: () => {},
  recordMerchantMemory: async () => ({ ok: true }),
  MERCHANT_MEMORY_HINT_LINE: "mem",
}));

export function resetState(o?: any) {
  state.inserts = [];
  state.pendingRow = null;
  state.cartoesData = [{ id: "c-nu", nome: "Nubank", user_id: "u1", ultimos_digitos: "1234" }];
  state.contasData = o?.contas ?? [];
  if (o?.contas)
    o.contas.forEach((c: any) => state.inserts.push({ table: "contas_a_pagar", row: c }));
}
export function gastosInserts() {
  return state.inserts.filter((i) => i.table === "gastos");
}
export function resetCategorias(cats: any[]) {
  state.categoriasData = cats;
}
