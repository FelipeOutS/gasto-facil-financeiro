import { mock } from "bun:test";

const DEFAULT_LINK = {
  user_id: "u1",
  telefone: "5511999998888",
  ativo: true,
  opt_in_em: "2026-01-01T00:00:00Z",
  revogado_em: null,
};

export const state = {
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  pendingRow: null as any,
  linkData: null as any,
  cartoesData: [{ id: "c-nu", nome: "Nubank", user_id: "u1", ultimos_digitos: "1234" }] as Record<
    string,
    unknown
  >[],
  categoriasData: [
    { id: "cat-out", legacy_id: "outros", nome: "Outros", user_id: "u1" },
    { id: "cat-int", legacy_id: "internet", nome: "Internet", user_id: "u1" },
  ] as Record<string, unknown>[],
  contasData: [] as Record<string, any>[],
  contasReceberData: [] as Record<string, any>[],
  gastosData: [] as Record<string, any>[],
  receitasData: [] as Record<string, any>[],
  recorrenciasData: [] as Record<string, any>[],
  transferenciasData: [] as Record<string, any>[],
  metasData: [] as Record<string, any>[],
  limitesData: [] as Record<string, any>[],
  favorecidosData: [] as Record<string, any>[],
  pixPendingSecretsData: [] as Record<string, any>[],
  /** Armazenamento genérico para tabelas sem array dedicado (whatsapp_messages, etc.). */
  generic: {} as Record<string, Record<string, any>[]>,
};

/** Tabelas com array dedicado no state (lido por referência a cada consulta). */
const DEDICATED: Record<string, keyof typeof state> = {
  cartoes: "cartoesData",
  categorias: "categoriasData",
  contas_a_pagar: "contasData",
  contas_a_receber: "contasReceberData",
  gastos: "gastosData",
  receitas: "receitasData",
  recorrencias: "recorrenciasData",
  transferencias_internas: "transferenciasData",
  metas_financeiras: "metasData",
  limites: "limitesData",
  fornecedores: "favorecidosData",
  whatsapp_pix_pending_secrets: "pixPendingSecretsData",
};

/** Tabelas cujo conteúdo é devolvido integralmente (comportamento histórico do fake). */
const UNFILTERED = new Set(["cartoes", "categorias"]);

function rowsOf(table: string): Record<string, any>[] {
  const key = DEDICATED[table];
  if (key) return state[key] as Record<string, any>[];
  state.generic[table] ??= [];
  return state.generic[table];
}

function norm(v: unknown): unknown {
  return v === undefined ? null : v;
}

function readPath(row: Record<string, any>, col: string): unknown {
  if (!col.includes("->")) return row[col];
  const [base, ...rest] = col.split(/->>?/);
  let cur: any = row[base];
  for (const seg of rest) cur = cur?.[seg];
  return cur;
}

function likeToRegex(pattern: string, insensitive: boolean): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
  return new RegExp(`^${escaped}$`, insensitive ? "i" : "");
}

type Cond = { col: string; op: string; val: any; negate?: boolean };

function cmp(actual: unknown, expected: unknown): number {
  const an = typeof actual === "number" ? actual : Number(actual);
  const en = typeof expected === "number" ? expected : Number(expected);
  if (!Number.isNaN(an) && !Number.isNaN(en) && actual !== null && expected !== null) {
    return an === en ? 0 : an < en ? -1 : 1;
  }
  const as = String(actual);
  const es = String(expected);
  return as === es ? 0 : as < es ? -1 : 1;
}

function matchCond(row: Record<string, any>, c: Cond): boolean {
  const actual = norm(readPath(row, c.col));
  let ok: boolean;
  switch (c.op) {
    case "eq":
      ok = String(actual) === String(norm(c.val)) || actual === norm(c.val);
      break;
    case "neq":
      ok = !(String(actual) === String(norm(c.val)) || actual === norm(c.val));
      break;
    case "is":
      ok = actual === norm(c.val);
      break;
    case "gt":
      ok = actual !== null && cmp(actual, c.val) > 0;
      break;
    case "gte":
      ok = actual !== null && cmp(actual, c.val) >= 0;
      break;
    case "lt":
      ok = actual !== null && cmp(actual, c.val) < 0;
      break;
    case "lte":
      ok = actual !== null && cmp(actual, c.val) <= 0;
      break;
    case "in": {
      const list = Array.isArray(c.val)
        ? c.val
        : String(c.val)
            .replace(/^\(|\)$/g, "")
            .split(",")
            .map((v) => v.trim().replace(/^"|"$/g, ""));
      ok = list.some((v) => String(norm(v)) === String(actual));
      break;
    }
    case "like":
      ok = actual !== null && likeToRegex(String(c.val), false).test(String(actual));
      break;
    case "ilike":
      ok = actual !== null && likeToRegex(String(c.val), true).test(String(actual));
      break;
    default:
      ok = true;
  }
  return c.negate ? !ok : ok;
}

/** Suporte básico a `.or("a.eq.1,b.ilike.%x%")`. */
function parseOr(expr: string): Cond[] {
  return expr
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [col, op, ...rest] = part.split(".");
      let raw: any = rest.join(".");
      if (raw === "null") raw = null;
      else if (raw === "true") raw = true;
      else if (raw === "false") raw = false;
      return { col, op, val: raw } as Cond;
    });
}

function makeBuilder(table: string): any {
  const ctx: any = {
    table,
    op: "select",
    payload: null,
    conds: [] as Cond[],
    orGroups: [] as Cond[][],
    single: false,
    selectCols: "*",
    head: false,
    count: false,
    orderBy: null as null | { col: string; asc: boolean },
    limitN: null as null | number,
  };

  const matches = (row: Record<string, any>) => {
    for (const c of ctx.conds) if (!matchCond(row, c)) return false;
    for (const group of ctx.orGroups) {
      if (!group.some((c) => matchCond(row, c))) return false;
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

  const shape = (rows: Record<string, any>[]) => {
    let out = rows;
    if (ctx.orderBy) {
      const { col, asc } = ctx.orderBy;
      out = [...out].sort((a, b) => cmp(norm(readPath(a, col)), norm(readPath(b, col))) * (asc ? 1 : -1));
    }
    if (typeof ctx.limitN === "number") out = out.slice(0, ctx.limitN);
    return out;
  };

  const finalize = async () => {
    if (ctx.op === "select") {
      if (table === "whatsapp_links") {
        const link = state.linkData ?? DEFAULT_LINK;
        return ctx.single ? { data: link, error: null } : { data: [link], error: null };
      }
      const all = rowsOf(table);
      const rows = UNFILTERED.has(table) ? all : all.filter(matches);
      if (ctx.count || ctx.head) {
        return { data: ctx.head ? null : shape(rows), count: rows.length, error: null };
      }
      const shaped = shape(rows);
      return { data: ctx.single ? (shaped[0] ?? null) : shaped, error: null };
    }

    if (ctx.op === "insert") {
      const payloadRows = Array.isArray(ctx.payload) ? ctx.payload : [ctx.payload];
      const store = rowsOf(table);
      const inserted: any[] = payloadRows.map((r) => {
        const newRow = {
          ...r,
          id: r.id || `m-${state.inserts.length + 1}`,
          recebida_em: r.recebida_em || new Date().toISOString(),
        };
        state.inserts.push({ table, row: newRow });
        store.push(newRow);
        return newRow;
      });
      if (table === "whatsapp_messages") syncPending();
      return { data: ctx.single ? inserted[0] : inserted, error: null };
    }

    if (ctx.op === "update") {
      const matched: any[] = [];
      const store = rowsOf(table);
      store.forEach((row, idx) => {
        if (!matches(row)) return;
        const updated = { ...row, ...ctx.payload };
        store[idx] = updated;
        const logged = state.inserts.find((e) => e.table === table && e.row === row);
        if (logged) logged.row = updated;
        matched.push(updated);
      });
      if (table === "whatsapp_messages") syncPending();
      return { data: ctx.single ? (matched[0] ?? null) : matched, error: null };
    }

    if (ctx.op === "delete") {
      const store = rowsOf(table);
      const removed = store.filter(matches);
      for (const row of removed) {
        const i = store.indexOf(row);
        if (i !== -1) store.splice(i, 1);
      }
      if (table === "whatsapp_messages") syncPending();
      return { data: removed, error: null };
    }

    return { data: ctx.single ? null : [], error: null };
  };

  const addCond = (col: string, op: string, val: any, negate = false) => {
    ctx.conds.push({ col, op, val, negate });
    return builder;
  };

  const builder: any = {
    select: (c: string = "*", opts?: { count?: string; head?: boolean }) => {
      ctx.selectCols = c;
      if (opts?.count) ctx.count = true;
      if (opts?.head) ctx.head = true;
      if (ctx.head || ctx.count) return finalize();
      return builder;
    },
    insert: (p: any) => {
      ctx.op = "insert";
      ctx.payload = p;
      return builder;
    },
    upsert: (p: any) => {
      ctx.op = "insert";
      ctx.payload = p;
      return builder;
    },
    update: (p: any) => {
      ctx.op = "update";
      ctx.payload = p;
      return builder;
    },
    delete: () => {
      ctx.op = "delete";
      return builder;
    },
    eq: (c: string, v: any) => addCond(c, "eq", v),
    neq: (c: string, v: any) => addCond(c, "neq", v),
    gt: (c: string, v: any) => addCond(c, "gt", v),
    gte: (c: string, v: any) => addCond(c, "gte", v),
    lt: (c: string, v: any) => addCond(c, "lt", v),
    lte: (c: string, v: any) => addCond(c, "lte", v),
    is: (c: string, v: any) => addCond(c, "is", v),
    like: (c: string, v: any) => addCond(c, "like", v),
    ilike: (c: string, v: any) => addCond(c, "ilike", v),
    in: (c: string, v: any[]) => addCond(c, "in", v),
    filter: (c: string, op: string, v: any) => addCond(c, op, v),
    not: (c: string, op: string, v: any) => addCond(c, op, v, true),
    or: (expr: string) => {
      ctx.orGroups.push(parseOr(expr));
      return builder;
    },
    order: (c: string, opts?: { ascending?: boolean }) => {
      ctx.orderBy = { col: c, asc: opts?.ascending !== false };
      return builder;
    },
    limit: (n?: number) => {
      if (typeof n === "number") ctx.limitN = n;
      return builder;
    },
    range: (from: number, to: number) => {
      ctx.limitN = to - from + 1;
      return builder;
    },
    match: (obj: Record<string, any>) => {
      for (const [c, v] of Object.entries(obj)) addCond(c, "eq", v);
      return builder;
    },
    contains: () => builder,
    containedBy: () => builder,
    overlaps: () => builder,
    abortSignal: () => builder,
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
    then: (res: any, rej?: any) => finalize().then(res, rej),
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
  state.generic = {};
  state.linkData = o?.link ?? null;
  state.cartoesData = o?.cartoes ?? [
    { id: "c-nu", nome: "Nubank", user_id: "u1", ultimos_digitos: "1234" },
  ];
  state.categoriasData = o?.categorias ?? [
    { id: "cat-out", legacy_id: "outros", nome: "Outros", user_id: "u1" },
    { id: "cat-int", legacy_id: "internet", nome: "Internet", user_id: "u1" },
  ];
  state.contasData = o?.contas ?? [];
  state.contasReceberData = o?.contasReceber ?? [];
  state.gastosData = o?.gastos ?? [];
  state.receitasData = o?.receitas ?? [];
  state.recorrenciasData = o?.recorrencias ?? [];
  state.transferenciasData = o?.transferencias ?? [];
  state.metasData = o?.metas ?? [];
  state.limitesData = o?.limites ?? [];
  state.favorecidosData = o?.favorecidos ?? [];
  state.pixPendingSecretsData = o?.pixPendingSecrets ?? [];
  // Ids sintéticos estáveis para linhas semeadas sem id (compatibilidade histórica).
  state.contasData.forEach((c: any, i: number) => {
    if (!c.id) c.id = `m-${i + 1}`;
  });
  // O usuário canônico do fake é "u1": linhas semeadas sem user_id pertencem a ele.
  for (const key of [
    "contasData",
    "contasReceberData",
    "gastosData",
    "receitasData",
    "recorrenciasData",
    "transferenciasData",
    "metasData",
    "limitesData",
    "favorecidosData",
  ] as const) {
    (state[key] as any[]).forEach((r: any) => {
      if (r && r.user_id === undefined) r.user_id = "u1";
    });
  }
  if (o?.contas)
    o.contas.forEach((c: any) => state.inserts.push({ table: "contas_a_pagar", row: c }));
}
export function gastosInserts() {
  return state.inserts.filter((i) => i.table === "gastos");
}
export function resetCategorias(cats: any[]) {
  state.categoriasData = cats;
}
