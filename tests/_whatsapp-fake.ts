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
  gastosData: [] as Record<string, unknown>[],
  receitasData: [] as Record<string, unknown>[],
  contasData: [] as Record<string, unknown>[],
  // WA-C7 — favorecidos (reuso de fornecedores). Cada teste pode
  // semear via resetState({ favorecidos: [...] }).
  favorecidosData: [] as Record<string, unknown>[],
  // WA-R1-Fix — recorrências para o fluxo de receitas recorrentes
  recorrenciasData: [] as Record<string, unknown>[],
  // WA-Q-Orcamento — limites/orçamento do usuário
  limitesData: [] as Record<string, unknown>[],
};

const PENDING = [
  "aguardando_confirmacao",
  "aguardando_forma_pagamento",
  "aguardando_cartao",
  "aguardando_descricao_e_valor_gasto",
  "consulta_categoria_ambigua",
  "aguardando_categoria_gasto",
  "aguardando_consulta_fatura",
  "parc_aguardando_total",
  "parc_aguardando_quantidade",
  "parc_aguardando_cartao",
  "parc_aguardando_confirmacao",
  "parc_aguardando_categoria",
  "parc_persistindo",
  "rec_aguardando_tipo",
  "rec_aguardando_valor",
  "rec_aguardando_recorrencia",
  "rec_aguardando_frequencia",
  "rec_aguardando_dia",
  "rec_aguardando_categoria",
  "rec_aguardando_confirmacao",
  // WA-G5A — comprovante/foto
  "img_aguardando_confirmacao",
  "img_aguardando_valor",
  "img_aguardando_descricao",
  "img_aguardando_pagamento",
  "img_aguardando_ajuste",
  "img_aguardando_data_confirmacao",
  "img_aguardando_categoria_obrigatoria",
  // WA-C1 — paginação de vencimentos/contas a pagar.
  "aguardando_consulta_vencimentos",
  // WA-C2 — criação de conta a pagar.
  "conta_aguardando_nome",
  "conta_aguardando_valor",
  "conta_aguardando_vencimento",
  "conta_aguardando_recorrencia",
  "conta_aguardando_categoria",
  "conta_aguardando_confirmacao",
  "conta_persistindo",
  // WA-C3 — baixa de conta a pagar (marcar como paga).
  "conta_pagamento_aguardando_escolha",
  "conta_pagamento_aguardando_confirmacao",
  "conta_pagamento_aguardando_data",
  // WA-C4 — edição/cancelamento de conta a pagar.
  "conta_edicao_aguardando_escolha",
  "conta_edicao_aguardando_campo",
  "conta_edicao_aguardando_valor",
  "conta_edicao_aguardando_vencimento",
  "conta_edicao_aguardando_categoria",
  "conta_edicao_aguardando_nome",
  "conta_edicao_aguardando_escopo_recorrencia",
  "conta_edicao_aguardando_confirmacao",
  "conta_cancelamento_aguardando_confirmacao",
  "conta_edicao_persistindo",
  // WA-C7.2.b — pagamento para pessoa (state machine).
  "pp_aguardando_favorecido",
  "pp_aguardando_valor",
  "pp_aguardando_descricao",
  "pp_aguardando_confirmar_conta",
  "pp_aguardando_escolha_conta",
  "pp_persistindo",
  // WA-C10.a — cadastro de boleto por texto.
  "bol_aguardando_valor",
  "bol_aguardando_vencimento",
  "bol_aguardando_identificacao",
  "bol_aguardando_confirmacao",
  "bol_aguardando_duplicidade",
  "bol_aguardando_selecao_candidato",
  "bol_aguardando_confirmacao_manual",
  "bol_persistindo",
];


// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeBuilder(table: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx: any = { table, op: "select", payload: null, filters: {}, notFilters: [] };

  const finalize = async () => {
    const matchesFilters = (row: Record<string, unknown>, idx: number) => {
      for (const [col, val] of Object.entries(ctx.filters)) {
        const actual = col === "id"
          ? `m-${idx + 1}`
          : col === "parsed->>kind"
            ? (row.parsed as Record<string, unknown> | undefined)?.kind
            : col === "parsed->>imageSha256"
              ? (row.parsed as Record<string, unknown> | undefined)?.imageSha256
              : row[col];
        if (Array.isArray(val)) {
          if (!val.includes(actual)) return false;
        } else if (actual !== val) return false;
      }
      for (const nf of ctx.notFilters as Array<{ col: string; op: string; val: unknown }>) {
        const actual = nf.col === "id"
          ? `m-${idx + 1}`
          : nf.col === "parsed->>kind"
            ? (row.parsed as Record<string, unknown> | undefined)?.kind
            : row[nf.col];
        if (nf.op === "in" && typeof nf.val === "string") {
          const blocked = nf.val.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, ""));
          if (blocked.includes(String(actual))) return false;
        }
      }
      return true;
    };
    if (ctx.op === "insert") {
      const rows = Array.isArray(ctx.payload) ? ctx.payload : [ctx.payload];
      // WA-F3.3 — espelha o índice único parcial em whatsapp_messages
      // (external_id) WHERE external_id IS NOT NULL. Dois inserts
      // concorrentes com o mesmo external_id falham → garante que o
      // "claim atômico" do parcelamento bloqueie corridas reais.
      if (table === "whatsapp_messages" && rows[0]?.external_id) {
        const dup = state.inserts.some(
          (i) => i.table === "whatsapp_messages" && i.row.external_id === rows[0].external_id,
        );
        if (dup) {
          return { data: null, error: { code: "23505", message: "duplicate external_id" } };
        }
      }
      for (const r of rows) state.inserts.push({ table, row: r });
      // WA-C2 — espelha inserts em contas_a_pagar para o readback e para
      // a integração com WA-C1 (consulta de vencimentos).
      if (table === "contas_a_pagar") {
        for (const r of rows) state.contasData.push(r);
      }
      // WA-C7 — espelha inserts em fornecedores e devolve um id estável
      // para o readback (`select … maybeSingle()`).
      if (table === "fornecedores") {
        for (const r of rows) {
          const id = `forn-${state.favorecidosData.length + 1}`;
          state.favorecidosData.push({ id, apelido: null, ...r });
        }
      }

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
      if (table === "fornecedores") {
        // Devolve a última linha favorecidoData inserida (id estável).
        const last = state.favorecidosData[state.favorecidosData.length - 1] ?? null;
        return { data: last, error: null };
      }
      if (table === "whatsapp_messages") {
        return {
          data: { id: `m-${state.inserts.length}`, status: rows[0]?.status ?? null },
          error: null,
        };
      }
      return { data: null, error: null };
    }
    if (ctx.op === "update") {
      if (table === "whatsapp_messages") {
        state.inserts.forEach((entry, idx) => {
          if (entry.table === "whatsapp_messages" && matchesFilters(entry.row, idx)) {
            entry.row = { ...entry.row, ...ctx.payload };
          }
        });
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
      // WA-C3/WA-C4 — update condicional de contas_a_pagar. Suporta
      // filtros por equality, IN (array) e range (gte/lte/lt).
      if (table === "contas_a_pagar") {
        const updatedRows: Record<string, unknown>[] = [];
        for (const c of state.contasData) {
          let match = true;
          for (const [col, val] of Object.entries(ctx.filters)) {
            const actual = (c as Record<string, unknown>)[col];
            if (Array.isArray(val)) {
              if (!val.includes(actual)) { match = false; break; }
            } else if (actual !== val) {
              match = false;
              break;
            }
          }
          if (match && ctx.range) {
            for (const col of Object.keys(ctx.range)) {
              const v = (c as Record<string, unknown>)[col];
              const rg = ctx.range[col];
              if (rg.gte != null && !(v != null && (v as string | number) >= rg.gte)) { match = false; break; }
              if (rg.lte != null && !(v != null && (v as string | number) <= rg.lte)) { match = false; break; }
              if (rg.lt != null && !(v != null && (v as string | number) < rg.lt)) { match = false; break; }
            }
          }
          if (match) {
            Object.assign(c, ctx.payload);
            updatedRows.push(c);
          }
        }
        if (ctx.single) return { data: updatedRows[0] ?? null, error: null };
        return { data: updatedRows, error: null };
      }
      // WA-C7 — update de fornecedores (Pix). Aplica filtros por id/user_id.
      if (table === "fornecedores") {
        const updatedRows: Record<string, unknown>[] = [];
        for (const f of state.favorecidosData) {
          let match = true;
          for (const [col, val] of Object.entries(ctx.filters)) {
            if ((f as Record<string, unknown>)[col] !== val) {
              match = false;
              break;
            }
          }
          if (match) {
            Object.assign(f, ctx.payload);
            updatedRows.push(f);
          }
        }
        if (ctx.single) return { data: updatedRows[0] ?? null, error: null };
        return { data: updatedRows, error: null };
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
            parsed: found.row.parsed ?? null,
          },
          error: null,
        };
      }
      // Lista por user_id+telefone (usada pelo dedup de imagens, WA-G5A).
      // Apenas quando NÃO foi pedido maybeSingle/single.
      if (ctx.filters?.user_id && !ctx.filters?.id && !ctx.single) {
        const rows = state.inserts
          .map((i, idx) => ({ i, idx }))
          .filter(({ i, idx }) => i.table === "whatsapp_messages" && matchesFilters(i.row, idx))
          .map(({ i, idx }) => ({
            id: `m-${idx + 1}`,
            status: i.row.status,
            gasto_id: i.row.gasto_id ?? null,
            parsed: i.row.parsed ?? null,
            recebida_em: i.row.recebida_em ?? new Date(Date.now() + idx).toISOString(),
          }));
        return { data: rows, error: null };
      }
      return { data: state.pendingRow, error: null };
    }
    if (table === "cartoes") return { data: state.cartoesData, error: null };
    if (table === "categorias") {
      const uid = ctx.filters?.user_id;
      const rows = uid
        ? state.categoriasData.filter((c) => c.user_id === uid)
        : state.categoriasData;
      return { data: rows, error: null };
    }
    if (table === "gastos") {
      if (ctx.filters?.id) return { data: { id: ctx.filters.id }, error: null };
      const uid = ctx.filters?.user_id;
      // Filtra por user_id apenas quando as linhas declaram esse campo;
      // mantém compatibilidade com fixtures legadas sem `user_id`.
      let base = uid
        ? state.gastosData.filter((g) => g.user_id === undefined || g.user_id === uid)
        : state.gastosData;
      // WA-F3.2 — readback de compra parcelada filtra por grupo.
      if (ctx.filters?.grupo_parcelamento_id) {
        base = base.filter(
          (g) => g.grupo_parcelamento_id === ctx.filters.grupo_parcelamento_id,
        );
      }
      return { data: applyRangeFilters(base, ctx.range), error: null };
    }
    if (table === "receitas") {
      const idF = ctx.filters?.id;
      const uid = ctx.filters?.user_id;
      let base = state.receitasData as Array<Record<string, unknown>>;
      if (idF !== undefined) base = base.filter((r) => r.id === idF);
      if (uid !== undefined) base = base.filter((r) => r.user_id === undefined || r.user_id === uid);
      const ranged = applyRangeFilters(base, ctx.range);
      if (ctx.single) return { data: ranged[0] ?? null, error: null };
      return { data: ranged, error: null };
    }
    if (table === "recorrencias") {
      const idF = ctx.filters?.id;
      const uid = ctx.filters?.user_id;
      let base = state.recorrenciasData as Array<Record<string, unknown>>;
      if (idF !== undefined) base = base.filter((r) => r.id === idF);
      if (uid !== undefined) base = base.filter((r) => r.user_id === undefined || r.user_id === uid);
      if (ctx.single) return { data: base[0] ?? null, error: null };
      return { data: base, error: null };
    }
    if (table === "contas_a_pagar") {
      const uid = ctx.filters?.user_id;
      let base = uid
        ? state.contasData.filter((c) => c.user_id === undefined || c.user_id === uid)
        : state.contasData;
      if (ctx.filters?.status) {
        base = base.filter((c) => c.status === ctx.filters.status);
      }
      if (ctx.filters?.id !== undefined && !Array.isArray(ctx.filters.id)) {
        base = base.filter((c) => c.id === ctx.filters.id);
      }
      if (Array.isArray(ctx.filters?.id)) {
        const ids = ctx.filters.id as unknown[];
        base = base.filter((c) => ids.includes(c.id));
      }
      // WA-C10.a — dedup por código de boleto.
      if (ctx.filters?.codigo_boleto !== undefined) {
        base = base.filter((c) => c.codigo_boleto === ctx.filters.codigo_boleto);
      }
      const ranged = applyRangeFilters(base, ctx.range);
      if (ctx.single) return { data: ranged[0] ?? null, error: null };
      return { data: ranged, error: null };
    }
    // WA-C7 — select de fornecedores. Aplica filtros por user_id/ativo/id.
    if (table === "fornecedores") {
      const uid = ctx.filters?.user_id;
      let base = uid
        ? state.favorecidosData.filter(
            (f) => f.user_id === undefined || f.user_id === uid,
          )
        : state.favorecidosData;
      if (ctx.filters?.ativo !== undefined) {
        base = base.filter((f) => f.ativo === ctx.filters.ativo);
      }
      if (ctx.filters?.id !== undefined) {
        base = base.filter((f) => f.id === ctx.filters.id);
      }
      if (ctx.single) return { data: base[0] ?? null, error: null };
      return { data: base, error: null };
    }
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
    in(col: string, vals: unknown[]) { ctx.filters[col] = vals; return builder; },
    filter(col: string, op: string, val: unknown) {
      if (op === "eq") ctx.filters[col] = val;
      return builder;
    },
    not(col: string, op: string, val: unknown) { ctx.notFilters.push({ col, op, val }); return builder; },
    gte(col: string, val: unknown) {
      ctx.range = ctx.range ?? {};
      (ctx.range[col] = ctx.range[col] ?? {}).gte = val;
      return builder;
    },
    lt(col: string, val: unknown) {
      ctx.range = ctx.range ?? {};
      (ctx.range[col] = ctx.range[col] ?? {}).lt = val;
      return builder;
    },
    lte(col: string, val: unknown) {
      ctx.range = ctx.range ?? {};
      (ctx.range[col] = ctx.range[col] ?? {}).lte = val;
      return builder;
    },
    gt: () => builder,
    order: () => builder,
    limit: () => builder,
    single() { ctx.single = true; return finalize(); },
    maybeSingle() { ctx.single = true; return finalize(); },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(resolve: any, reject: any) { return finalize().then(resolve, reject); },
  };
  return builder;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyRangeFilters(rows: any, range: any): any {
  if (!Array.isArray(rows) || !range) return rows;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.filter((r: any) => {
    for (const col of Object.keys(range)) {
      const v = r?.[col];
      if (v == null) continue;
      const rg = range[col];
      if (rg.gte != null && !(v >= rg.gte)) return false;
      if (rg.lte != null && !(v <= rg.lte)) return false;
      if (rg.lt != null && !(v < rg.lt)) return false;
    }
    return true;
  });
}

export const fakeAdmin = {
  from: (t: string) => makeBuilder(t),
  // RPC mock: por padrão libera tudo (Admin Master / beta ativa).
  // WA-F3.2 — `create_installment_purchase` é simulada como atômica:
  // injeta uma linha em `state.inserts` e em `state.gastosData` por
  // parcela, permitindo readback (`select … eq grupo_parcelamento_id`)
  // funcionar. Testes podem sobrescrever `fakeAdmin.rpc` para simular
  // falha; nesse caso, nenhuma linha é inserida (cumpre o invariante
  // de atomicidade exposto pela RPC real).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: async (name: string, args?: Record<string, unknown>) => {
    if (name === "create_installment_purchase") {
      const parcelas = (args?.p_parcelas ?? []) as Array<Record<string, unknown>>;
      const userId = args?.p_user_id as string;
      const cartaoId = args?.p_cartao_id as string;
      const categoriaId = (args?.p_categoria_id ?? null) as string | null;
      const grupoId = args?.p_grupo_id as string;
      const total = args?.p_total_parcelas as number;
      const descricao = (args?.p_descricao ?? "") as string;
      const observacao = (args?.p_observacao ?? null) as string | null;
      const out: Array<Record<string, unknown>> = [];
      for (const p of parcelas) {
        const idx = state.inserts.length + 1;
        const id = `g-${idx}`;
        const row = {
          id,
          user_id: userId,
          cartao_id: cartaoId,
          categoria_id: categoriaId,
          descricao,
          estabelecimento: descricao,
          observacao,
          valor: p.valor,
          data: p.data,
          mes: p.mes,
          ano: p.ano,
          invoice_month: p.invoice_month,
          forma_pagamento: "credito",
          tipo_gasto: "parcelado",
          parcela_atual: p.numero,
          total_parcelas: total,
          grupo_parcelamento_id: grupoId,
          origem: "whatsapp",
          confirmado: true,
        };
        state.inserts.push({ table: "gastos", row });
        state.gastosData.push(row);
        out.push({
          id,
          parcela_atual: p.numero as number,
          invoice_month: p.invoice_month as string,
          valor: p.valor as number,
        });
      }
      return { data: out, error: null };
    }
    // WA-R1-Fix — atômica: 1 receita + 1 recorrência ativa.
    if (name === "create_recurring_income") {
      const userId = args?.p_user_id as string;
      const descricao = (args?.p_descricao ?? "Renda") as string;
      const valor = Number(args?.p_valor ?? 0);
      const data = args?.p_data as string;
      const tipo = (args?.p_tipo ?? "outros") as string;
      const freq = (args?.p_frequencia ?? "mensal") as string;
      const diaMes = args?.p_dia_mes as number | null | undefined;
      const diaSemana = args?.p_dia_semana as number | null | undefined;
      // calcula próxima cobrança estritamente futura (mesma lógica da RPC SQL)
      const baseD = new Date(`${data}T00:00:00Z`);
      let prox = new Date(baseD);
      if (freq === "mensal") {
        const dia = Math.min(diaMes ?? 1, 31);
        prox = new Date(Date.UTC(baseD.getUTCFullYear(), baseD.getUTCMonth(), dia));
        if (prox <= baseD) {
          prox = new Date(Date.UTC(baseD.getUTCFullYear(), baseD.getUTCMonth() + 1, dia));
        }
      } else if (freq === "semanal") {
        const dow = diaSemana ?? 0;
        let diff = ((dow - baseD.getUTCDay() + 7) % 7);
        if (diff === 0) diff = 7;
        prox.setUTCDate(prox.getUTCDate() + diff);
      } else {
        prox.setUTCDate(prox.getUTCDate() + 15);
      }
      const proxIso = prox.toISOString().slice(0, 10);
      const recIdx = state.inserts.length + 1;
      const recorrenciaId = `reco-${recIdx}`;
      const recoRow = {
        id: recorrenciaId,
        user_id: userId,
        nome: descricao,
        valor,
        frequencia: freq,
        proxima_cobranca: proxIso,
        status: "ativa",
        tipo_recorrencia: "recorrencia_fixa",
        origem: "whatsapp",
      };
      state.inserts.push({ table: "recorrencias", row: recoRow });
      state.recorrenciasData.push(recoRow);
      const receitaIdx = state.inserts.length + 1;
      const receitaId = `rec-${receitaIdx}`;
      const [y, m] = data.split("-").map(Number);
      const recRow = {
        id: receitaId,
        user_id: userId,
        descricao,
        valor,
        data,
        tipo,
        recorrente: true,
        recorrencia_id: recorrenciaId,
        mes: m,
        ano: y,
        origem: "whatsapp",
      };
      state.inserts.push({ table: "receitas", row: recRow });
      state.receitasData.push(recRow);
      return {
        data: [{ receita_id: receitaId, recorrencia_id: recorrenciaId, proxima_cobranca: proxIso }],
        error: null,
      };
    }
    return { data: true, error: null };
  },
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
  gastos?: Record<string, unknown>[];
  receitas?: Record<string, unknown>[];
  contas?: Record<string, unknown>[];
  favorecidos?: Record<string, unknown>[];
}) {
  state.inserts.length = 0;
  state.pendingRow = null;
  // WA-G3: limpa o cache anti-repetição do menu/saudação entre testes.
  try {
    // import dinâmico evita ciclo na fase de bootstrap dos mocks.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("../src/server/whatsapp-consultas.server") as {
      _resetConversationalCache?: () => void;
    };
    mod._resetConversationalCache?.();
  } catch {
    /* noop */
  }

  state.gastosData = opts?.gastos ?? [];
  state.receitasData = opts?.receitas ?? [];
  state.recorrenciasData = [];
  state.contasData = opts?.contas ?? [];
  state.favorecidosData = opts?.favorecidos ?? [];
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

export const receitasInserts = () =>
  state.inserts.filter((i) => i.table === "receitas");

export const recorrenciasInserts = () =>
  state.inserts.filter((i) => i.table === "recorrencias");
