/**
 * Helpers compartilhados de mock de Supabase para os testes do WhatsApp.
 * Permitir que múltiplos test files rodem juntos sem colisão de mock.module.
 */
import { mock } from "bun:test";

export const state = {
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  pendingRow: null as null | {
    id: string;
    status: string;
    parsed: Record<string, unknown>;
    recebida_em: string;
    gasto_id?: string | null;
  },
  cartoesData: [] as Record<string, unknown>[],
  linkData: null as null | {
    user_id: string;
    telefone: string;
    ativo: boolean;
    opt_in_em: string | null;
    revogado_em: string | null;
  },
  categoriasData: [
    { id: "cat-out", legacy_id: "outros", nome: "Outros", user_id: "u1" },
    { id: "cat-mer", legacy_id: "mercado", nome: "Mercado", user_id: "u1" },
    { id: "cat-trans", legacy_id: "transporte", nome: "Transporte", user_id: "u1" },
    { id: "cat-saude", legacy_id: "saude", nome: "Saúde", user_id: "u1" },
    { id: "cat-rest", legacy_id: "restaurante", nome: "Restaurante", user_id: "u1" },
    { id: "cat-int", legacy_id: "internet", nome: "Internet", user_id: "u1" },
  ] as Record<string, unknown>[],
};

const PENDING = [
  "aguardando_confirmacao",
  "aguardando_forma_pagamento",
  "aguardando_cartao",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeBuilder(table: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx: any = { table, op: "select", payload: null, filters: {} };

  const finalize = async () => {
    if (ctx.op === "insert") {
      const rows = Array.isArray(ctx.payload) ? ctx.payload : [ctx.payload];
      for (const r of rows) state.inserts.push({ table, row: r });
      if (table === "whatsapp_messages" && PENDING.includes(rows[0]?.status)) {
        state.pendingRow = {
          id: `m-${state.inserts.length}`,
          status: rows[0].status,
          parsed: rows[0].parsed,
          recebida_em: new Date().toISOString(),
          gasto_id: null,
        };
      }
      if (table === "gastos") {
        return { data: { id: `g-${state.inserts.length}` }, error: null };
      }
      return { data: null, error: null };
    }
    if (ctx.op === "update") {
      if (table === "whatsapp_messages") {
        const s = ctx.payload?.status;
        const id = ctx.filters?.id;
        if (s === "salva" || s === "cancelada") {
          state.pendingRow = null;
        } else if (s === "expirada") {
          if (state.pendingRow && id && state.pendingRow.id === id) {
            state.pendingRow = null;
          }
        } else if (s && state.pendingRow) {
          state.pendingRow = {
            ...state.pendingRow,
            status: s,
            parsed: ctx.payload?.parsed ?? state.pendingRow.parsed,
          };
        }
      }
      return { data: null, error: null };
    }
    if (ctx.op === "delete") return { data: null, error: null };

    if (table === "whatsapp_links") return { data: state.linkData, error: null };
    if (table === "whatsapp_messages") {
      const extId = ctx.filters?.external_id;
      if (extId) {
        const found = state.inserts.find(
          (i) => i.table === "whatsapp_messages" && i.row.external_id === extId,
        );
        if (!found) return { data: null, error: null };
        return {
          data: {
            id: "x",
            status: found.row.status,
            gasto_id: found.row.gasto_id ?? null,
          },
          error: null,
        };
      }
      return { data: state.pendingRow, error: null };
    }
    if (table === "cartoes") return { data: state.cartoesData, error: null };
    if (table === "categorias") return { data: state.categoriasData, error: null };
    if (table === "gastos") return { data: { id: "x" }, error: null };
    if (table === "auth.users")
      return { data: { email: "u@example.com" }, error: null };
    return { data: null, error: null };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    select: () => builder,
    insert(p: unknown) { ctx.op = "insert"; ctx.payload = p; return builder; },
    update(p: unknown) { ctx.op = "update"; ctx.payload = p; return builder; },
    delete() { ctx.op = "delete"; return builder; },
    eq(col: string, val: unknown) { ctx.filters[col] = val; return builder; },
    in: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => builder,
    single: finalize,
    maybeSingle: finalize,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(resolve: any, reject: any) { return finalize().then(resolve, reject); },
  };
  return builder;
}

export const fakeAdmin = {
  from: (t: string) => makeBuilder(t),
  // RPC mock: por padrão libera tudo (Admin Master / beta ativa).
  // Testes específicos podem sobrescrever `fakeAdmin.rpc` para simular
  // usuário sem beta.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: async (_name: string, _args?: unknown) => ({ data: true, error: null }),
  auth: {
    admin: {
      getUserById: async () => ({
        data: { user: { email: "u@example.com" } },
      }),
    },
  },
};

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin }));
mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin }));
mock.module("@/server/subscription.server", () => ({
  getSubscriptionForUserIdentity: async () => ({ active: true, plan: "admin_master" }),
}));
mock.module("./subscription.server", () => ({
  getSubscriptionForUserIdentity: async () => ({ active: true, plan: "admin_master" }),
}));

export function resetState(opts?: {
  cartoes?: Record<string, unknown>[];
  categorias?: Record<string, unknown>[];
  link?: typeof state.linkData;
}) {
  state.inserts.length = 0;
  state.pendingRow = null;
  state.cartoesData = opts?.cartoes ?? [
    {
      id: "c-nu", nome: "Nubank", banco: "Nubank",
      limite_total: 0, dia_fechamento: 1, dia_vencimento: 10, cor: "#000",
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
  ];
  if (opts?.categorias) state.categoriasData = opts.categorias;
  else {
    state.categoriasData = [
      { id: "cat-out", legacy_id: "outros", nome: "Outros", user_id: "u1" },
      { id: "cat-mer", legacy_id: "mercado", nome: "Mercado", user_id: "u1" },
      { id: "cat-trans", legacy_id: "transporte", nome: "Transporte", user_id: "u1" },
      { id: "cat-saude", legacy_id: "saude", nome: "Saúde", user_id: "u1" },
      { id: "cat-rest", legacy_id: "restaurante", nome: "Restaurante", user_id: "u1" },
      { id: "cat-int", legacy_id: "internet", nome: "Internet", user_id: "u1" },
    ];
  }
  state.linkData = opts?.link === undefined
    ? {
        user_id: "u1",
        telefone: "5511999998888",
        ativo: true,
        opt_in_em: new Date().toISOString(),
        revogado_em: null,
      }
    : opts.link;
}

export const gastosInserts = () =>
  state.inserts.filter((i) => i.table === "gastos");
