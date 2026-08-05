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
  linkData: undefined as any,
  cartoesData: [{ id: "c-nu", nome: "Nubank", user_id: "u1", ultimos_digitos: "1234" }] as Record<
    string,
    unknown
  >[],
  categoriasData: [
    { id: "cat-out", legacy_id: "outros", nome: "Outros", user_id: "u1" },
    { id: "cat-mer", legacy_id: "mercado", nome: "Mercado", user_id: "u1" },
    { id: "cat-trans", legacy_id: "transporte", nome: "Transporte", user_id: "u1" },
    { id: "cat-saude", legacy_id: "saude", nome: "Saúde", user_id: "u1" },
    { id: "cat-rest", legacy_id: "restaurante", nome: "Restaurante", user_id: "u1" },
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
const UNFILTERED = new Set<string>([]);

function rowsOf(table: string): Record<string, any>[] {
  const key = DEDICATED[table];
  if (key) return state[key] as Record<string, any>[];
  state.generic[table] ??= [];
  return state.generic[table];
}

/** Status que NÃO representam sessão ativa aguardando resposta do usuário. */
const TERMINAL_SESSION_STATES = new Set<string>([
  "salva",
  "cancelada",
  "expirada",
  "falha",
  "duplicada",
  "sem_pendencia",
  "sem_vinculo",
  "consulta",
  "erro",
]);

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
        !TERMINAL_SESSION_STATES.has(i.row.status as string),
    )?.row;
    state.pendingRow = last
      ? {
          ...last,
          session: last.parsed || last.session,
          parsed: last.parsed || last.session,
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
        // `undefined` = nenhum override (usa o vínculo padrão);
        // `null` explícito = telefone SEM vínculo.
        const link = state.linkData === undefined ? DEFAULT_LINK : state.linkData;
        if (!link) return ctx.single ? { data: null, error: null } : { data: [], error: null };
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
      // Emula o índice único parcial idx_whatsapp_messages_external_id
      // ON whatsapp_messages(external_id) WHERE external_id IS NOT NULL.
      // Sem isso os testes de idempotência concorrente (dois webhooks com o
      // mesmo external_message_id) passam indevidamente no fake.
      if (table === "whatsapp_messages") {
        for (const r of payloadRows) {
          const ext = r?.external_id;
          if (ext !== null && ext !== undefined && store.some((row) => row.external_id === ext)) {
            return {
              data: null,
              error: {
                code: "23505",
                message:
                  'duplicate key value violates unique constraint "idx_whatsapp_messages_external_id"',
              },
            };
          }
        }
      }
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
      // Espelha public.whatsapp_baixa_conta_atomic: ownership por user_id,
      // data_pagamento vinda do parâmetro e resultados not_found/noop/
      // inconsistent/not_pending/paid.
      const idx = state.contasData.findIndex(
        (x) => x.id === a?.p_conta_id && x.user_id === a?.p_user_id,
      );
      if (idx === -1) {
        return { data: [{ result: "not_found", gasto_id: null }], error: null };
      }
      const c = state.contasData[idx];
      if (c.status === "pago") {
        return {
          data: [
            {
              result: c.gasto_id ? "noop" : "inconsistent",
              gasto_id: c.gasto_id ?? null,
              nome: c.nome,
              valor: c.valor,
              data_pagamento: c.data_pagamento ?? null,
            },
          ],
          error: null,
        };
      }
      if (c.status !== "pendente") {
        return {
          data: [{ result: "not_pending", gasto_id: null, nome: c.nome, valor: c.valor }],
          error: null,
        };
      }
      const dataPagamento = String(a?.p_data_pagamento ?? new Date().toISOString().slice(0, 10));
      const gid = `g-${state.inserts.length + 1}`;
      const gastoRow = {
        id: gid,
        user_id: a.p_user_id,
        descricao: c.nome,
        valor: c.valor,
        categoria_id: c.categoria_id ?? null,
        forma_pagamento: c.forma_pagamento || "outros",
        origem: a?.p_origem ?? "whatsapp",
        data: dataPagamento,
        mes: Number(dataPagamento.slice(5, 7)),
        ano: Number(dataPagamento.slice(0, 4)),
        estabelecimento: c.beneficiario ?? "",
        tipo_gasto: "unico",
        confirmado: true,
        cartao_id: c.cartao_id ?? null,
      };
      state.inserts.push({ table: "gastos", row: gastoRow });
      state.gastosData.push(gastoRow);
      state.contasData[idx] = {
        ...c,
        status: "pago",
        data_pagamento: dataPagamento,
        gasto_id: gid,
      };
      return {
        data: [
          {
            result: "paid",
            gasto_id: gid,
            nome: c.nome,
            valor: c.valor,
            data_pagamento: dataPagamento,
          },
        ],
        error: null,
      };
    }

    if (n === "create_installment_purchase") {
      // Emula a RPC atômica: grava todas as parcelas sob o mesmo grupo.
      const parcelas: any[] = Array.isArray(a?.p_parcelas) ? a.p_parcelas : [];
      if (!parcelas.length) return { data: null, error: { message: "no_installments" } };
      const rows = parcelas.map((pc, i) => ({
        id: `gp-${a.p_grupo_id}-${pc.numero ?? i + 1}`,
        user_id: a.p_user_id,
        cartao_id: a.p_cartao_id,
        categoria_id: a.p_categoria_id,
        descricao: a.p_descricao,
        estabelecimento: a.p_estabelecimento,
        observacao: a.p_observacao,
        origem: a.p_origem ?? "whatsapp",
        grupo_parcelamento_id: a.p_grupo_id,
        total_parcelas: a.p_total_parcelas,
        parcela_atual: pc.numero ?? i + 1,
        valor: pc.valor,
        data: pc.data,
        mes: pc.mes,
        ano: pc.ano,
        invoice_month: pc.invoice_month,
        forma_pagamento: "credito",
      }));
      for (const row of rows) {
        state.gastosData.push(row);
        state.inserts.push({ table: "gastos", row });
      }
      return { data: rows, error: null };
    }
    if (n === "create_recurring_income") {
      // Emula a RPC atômica: 1 recorrência ativa + 1 receita atual vinculada.
      const valor = Number(a?.p_valor);
      if (!a?.p_user_id || !Number.isFinite(valor) || valor <= 0) {
        return { data: null, error: { message: "parametros invalidos" } };
      }
      const freq = String(a?.p_frequencia ?? "mensal").toLowerCase();
      const baseIso = String(a?.p_data);
      const [by, bm, bd] = baseIso.split("-").map((v: string) => Number(v));
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      let prox: string;
      if (freq === "mensal") {
        const dia = Number(a?.p_dia_mes);
        if (!Number.isFinite(dia) || dia < 1 || dia > 31) {
          return { data: null, error: { message: "dia_mes invalido (1..31)" } };
        }
        let y = by;
        let m = bm;
        const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
        let cand = new Date(Date.UTC(y, m - 1, Math.min(dia, lastDay(y, m))));
        if (iso(cand) <= baseIso) {
          m += 1;
          if (m > 12) {
            m = 1;
            y += 1;
          }
          cand = new Date(Date.UTC(y, m - 1, Math.min(dia, lastDay(y, m))));
        }
        prox = iso(cand);
      } else if (freq === "semanal") {
        const dow = Number(a?.p_dia_semana);
        if (!Number.isFinite(dow) || dow < 0 || dow > 6) {
          return { data: null, error: { message: "dia_semana invalido (0..6)" } };
        }
        const base = new Date(Date.UTC(by, bm - 1, bd));
        let diff = (dow - base.getUTCDay() + 7) % 7;
        if (diff === 0) diff = 7;
        prox = iso(new Date(base.getTime() + diff * 86400000));
      } else {
        const base = new Date(Date.UTC(by, bm - 1, bd));
        prox = iso(new Date(base.getTime() + 15 * 86400000));
      }
      const nome = String(a?.p_descricao ?? "").trim() || "Renda";
      const recoId = `reco-${state.recorrenciasData.length + 1}`;
      const recoRow = {
        id: recoId,
        user_id: a.p_user_id,
        nome,
        valor,
        frequencia: freq,
        proxima_cobranca: prox,
        status: "ativa",
        tipo_recorrencia: "recorrencia_fixa",
        origem: a?.p_origem ?? "whatsapp",
        observacao: a?.p_observacao ?? null,
      };
      state.recorrenciasData.push(recoRow);
      state.inserts.push({ table: "recorrencias", row: recoRow });
      const receitaId = `rct-${state.receitasData.length + 1}`;
      const receitaRow = {
        id: receitaId,
        user_id: a.p_user_id,
        descricao: nome,
        valor,
        data: baseIso,
        tipo: a?.p_tipo ?? "outros",
        recorrente: true,
        recorrencia_id: recoId,
        mes: bm,
        ano: by,
        origem: a?.p_origem ?? "whatsapp",
      };
      state.receitasData.push(receitaRow);
      state.inserts.push({ table: "receitas", row: receitaRow });
      return { data: [{ receita_id: receitaId, recorrencia_id: recoId, proxima_cobranca: prox }], error: null };
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
const MEM_TABLE = "whatsapp_merchant_category_memories";

/** Linhas de memória de mercador registradas pelo fake. */
export function merchantMemoryRows(): Record<string, any>[] {
  state.generic[MEM_TABLE] ??= [];
  return state.generic[MEM_TABLE];
}

mock.module("@/server/whatsapp-merchant-memory.server", () => ({
  merchantKeyFor: (n: string) => n?.toLowerCase().trim() || null,
  logMerchantMemoryDecision: () => {},
  MERCHANT_MEMORY_HINT_LINE: "mem",
  lookupMerchantMemory: async (args: {
    userId: string;
    merchantKey: string;
    activeCategoryIds: ReadonlySet<string>;
  }) => {
    const rows = merchantMemoryRows().filter(
      (r) =>
        r.user_id === args.userId &&
        r.merchant_key === args.merchantKey &&
        (!args.activeCategoryIds || args.activeCategoryIds.has(r.category_id)),
    );
    const eligible = rows.filter(
      (r) => (r.manual_confirmed_count ?? 0) >= 1 || (r.confirmed_count ?? 0) >= 2,
    );
    if (eligible.length === 0) return { kind: "none" };
    if (eligible.length > 1) return { kind: "ambiguous" };
    const r = eligible[0];
    return {
      kind: "eligible",
      lookup: {
        categoryId: r.category_id,
        evidence: (r.manual_confirmed_count ?? 0) >= 1 ? "manual" : "confirmed",
        manualCount: r.manual_confirmed_count ?? 0,
        confirmedCount: r.confirmed_count ?? 0,
      },
    };
  },
  recordMerchantMemory: async (args: {
    userId: string;
    merchantKey: string;
    categoryId: string;
    evidence: "manual" | "confirmed";
  }) => {
    if (!args?.userId || !args?.merchantKey || !args?.categoryId) return { ok: false };
    const store = merchantMemoryRows();
    const existing = store.find(
      (r) =>
        r.user_id === args.userId &&
        r.merchant_key === args.merchantKey &&
        r.category_id === args.categoryId,
    );
    const incManual = args.evidence === "manual" ? 1 : 0;
    if (existing) {
      existing.confirmed_count = (existing.confirmed_count ?? 0) + 1;
      existing.manual_confirmed_count = (existing.manual_confirmed_count ?? 0) + incManual;
      existing.last_confirmed_at = new Date().toISOString();
      return { ok: true };
    }
    const row = {
      id: `mm-${store.length + 1}`,
      user_id: args.userId,
      merchant_key: args.merchantKey,
      category_id: args.categoryId,
      confirmed_count: 1,
      manual_confirmed_count: incManual,
      last_confirmed_at: new Date().toISOString(),
    };
    store.push(row);
    state.inserts.push({ table: MEM_TABLE, row });
    return { ok: true };
  },
}));


export function resetState(o?: any) {
  state.inserts = [];
  state.pendingRow = null;
  state.generic = {};
  state.linkData = o && "link" in o ? o.link : undefined;
  state.cartoesData = o?.cartoes ?? [
    { id: "c-nu", nome: "Nubank", user_id: "u1", ultimos_digitos: "1234" },
  ];
  state.categoriasData = o?.categorias ?? [
    { id: "cat-out", legacy_id: "outros", nome: "Outros", user_id: "u1" },
    { id: "cat-mer", legacy_id: "mercado", nome: "Mercado", user_id: "u1" },
    { id: "cat-trans", legacy_id: "transporte", nome: "Transporte", user_id: "u1" },
    { id: "cat-saude", legacy_id: "saude", nome: "Saúde", user_id: "u1" },
    { id: "cat-rest", legacy_id: "restaurante", nome: "Restaurante", user_id: "u1" },
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
    "cartoesData",
    "categoriasData",
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
}
export function gastosInserts() {
  return state.inserts.filter((i) => i.table === "gastos");
}
export function resetCategorias(cats: any[]) {
  state.categoriasData = cats;
}
export function receitasInserts() {
  return state.inserts.filter((i) => i.table === "receitas");
}
export function recorrenciasInserts() {
  return state.inserts.filter((i) => i.table === "recorrencias");
}
