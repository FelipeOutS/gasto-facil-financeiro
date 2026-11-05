import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Mapeamento canônico de categorias para tabelas e lógica de dependência.
 * Ref: docs/EXCLUSAO_SELETIVA_DADOS_USUARIO.md
 */
export const CATEGORY_MAP = {
  expenses: {
    tables: ["gastos"],
    scope: "all"
  },
  income: {
    tables: ["receitas"],
    scope: "all"
  },
  payables: {
    tables: ["contas_a_pagar"],
    scopes: ["all", "paid", "pending", "overdue"]
  },
  receivables: {
    tables: ["contas_a_receber"],
    scopes: ["all", "received", "pending", "overdue"]
  },
  subscriptions: {
    tables: ["recorrencias"],
    scope: "all"
  },
  budgets: {
    tables: ["limites"],
    scope: "all"
  },
  goals: {
    tables: ["metas_financeiras", "movimentacoes_meta"],
    scope: "all"
  },
  savings: {
    tables: ["dinheiro_guardado"],
    scope: "all"
  },
  investments: {
    tables: ["investimentos_ativos", "investimentos_atualizacoes", "investimentos_movimentacoes", "investimentos_rendimentos"],
    scope: "all"
  },
  cards: {
    tables: ["cartoes", "faturas_cartao"],
    scope: "all",
    dependencyInfo: "dependency.cards.info"
  },
  market: {
    tables: ["mercado_orcamentos", "mercado_precos_usuario", "mercado_listas", "mercado_historico_compras", "mercado_mercados_salvos"],
    scope: "all"
  },
  imports: {
    tables: ["imported_transactions", "investimentos_importacoes", "extratos_importados"],
    scope: "all"
  }
} as const;

export interface DeletionSelection {
  category: keyof typeof CATEGORY_MAP;
  scope: string;
}

type Facts = import("./privacy-deletion-policy").DependencyFacts;
type CountQuery = PromiseLike<{ count: number | null; error: unknown }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabelas dinâmicas fora dos tipos gerados
type Db = any;

const STATUS_PAYABLE: Record<string, string> = { paid: "pago", pending: "pendente", overdue: "atrasado" };
const STATUS_RECEIVABLE: Record<string, string> = { received: "recebido", pending: "pendente", overdue: "atrasado" };

async function mustCount(q: CountQuery): Promise<number> {
  const { count, error } = await q;
  if (error || count === null) throw new Error("count_failed");
  return count;
}

const head = { count: "exact" as const, head: true };

/** Mesmas linhas que o RPC removeria (todas, inclusive ocultas) — soft-delete-exceção: LGPD conta tudo. */
async function countSelection(db: Db, userId: string, s: { category: keyof typeof CATEGORY_MAP; scope: string }) {
  let total = 0;
  for (const table of CATEGORY_MAP[s.category].tables) {
    let q = db.from(table).select("id", head).eq("user_id", userId);
    if (s.category === "payables" && s.scope !== "all") q = q.eq("status", STATUS_PAYABLE[s.scope]);
    if (s.category === "receivables" && s.scope !== "all") q = q.eq("status", STATUS_RECEIVABLE[s.scope]);
    total += await mustCount(q);
  }
  return total;
}

async function collectFacts(db: Db, userId: string): Promise<Facts> {
  const c = (q: CountQuery) => mustCount(q);
  const [onBatches, onGastos, onReceitas, gBem, bp, ba, bc, gCartao, fat, gRec, rRec] = await Promise.all([
    c(db.from("pluggy_import_entries").select("id", head).eq("user_id", userId).not("batch_id", "is", null)),
    c(db.from("pluggy_import_entries").select("id", head).eq("user_id", userId).eq("entry_table", "gastos")),
    c(db.from("pluggy_import_entries").select("id", head).eq("user_id", userId).eq("entry_table", "receitas")),
    // soft-delete-exceção: vínculos contam linhas ocultas porque o RPC apaga todas.
    c(db.from("gastos").select("id", head).eq("user_id", userId).not("bem_id", "is", null)),
    c(db.from("bens_pagamentos").select("id", head).eq("user_id", userId).not("gasto_id", "is", null)),
    c(db.from("bens_amortizacoes").select("id", head).eq("user_id", userId).not("gasto_id", "is", null)),
    c(db.from("bens_custos_aquisicao").select("id", head).eq("user_id", userId).not("gasto_id", "is", null)),
    // soft-delete-exceção: idem.
    c(db.from("gastos").select("id", head).eq("user_id", userId).not("cartao_id", "is", null)),
    c(db.from("faturas_cartao").select("id", head).eq("user_id", userId)),
    // soft-delete-exceção: idem.
    c(db.from("gastos").select("id", head).eq("user_id", userId).not("recorrencia_id", "is", null)),
    c(db.from("receitas").select("id", head).eq("user_id", userId).not("recorrencia_id", "is", null)),
  ]);
  return {
    pluggyEntriesOnBatches: onBatches,
    pluggyEntriesOnGastos: onGastos,
    pluggyEntriesOnReceitas: onReceitas,
    gastosComBem: gBem + bp + ba + bc,
    gastosComCartao: gCartao,
    faturas: fat,
    lancamentosComRecorrencia: gRec + rRec,
  };
}

function logFailure(event: string, ref: string, code: string, extra: Record<string, unknown> = {}) {
  // Sanitizado: sem mensagem do banco, SQL, ids ou valores.
  console.error(JSON.stringify({ event, ref, code, ...extra }));
}

export type DeletionPreviewResult =
  | {
      ok: true;
      stats: Record<string, number>;
      blockers: import("./privacy-deletion-policy").Blocker[];
      totalPrimaryRecords: number;
    }
  | { ok: false; code: string; ref: string; message: string };

export const getDeletionPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (ctx): Promise<DeletionPreviewResult> => {
    const P = await import("./privacy-deletion-policy");
    const ref = P.newErrorRef();
    const data = (ctx as { data?: { selections?: unknown } }).data;
    const v = P.validateSelections(data?.selections);
    if (!v.ok) return { ok: false, code: v.code, ref, message: P.userMessage(v.code, ref) };
    const { userId } = (ctx as unknown as { context: { userId: string } }).context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      const stats: Record<string, number> = {};
      for (const s of v.selections) stats[s.category] = await countSelection(supabaseAdmin, userId, s);
      const blockers = P.computeBlockers(v.selections, await collectFacts(supabaseAdmin, userId));
      return { ok: true, stats, blockers, totalPrimaryRecords: Object.values(stats).reduce((a, b) => a + b, 0) };
    } catch {
      logFailure("privacy_deletion_preview_failed", ref, "preview_unavailable");
      return { ok: false, code: "preview_unavailable", ref, message: P.userMessage("preview_unavailable", ref) };
    }
  });

export type DeletionExecuteResult =
  | { ok: true; results: Record<string, number> }
  | {
      ok: false;
      code: string;
      ref: string;
      message: string;
      blockers?: import("./privacy-deletion-policy").Blocker[];
    };

export const executeDataDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (ctx): Promise<DeletionExecuteResult> => {
    const P = await import("./privacy-deletion-policy");
    const ref = P.newErrorRef();
    const fail = (code: import("./privacy-deletion-policy").DeletionErrorCode, extra: Record<string, unknown> = {}) => {
      logFailure("privacy_deletion_failed", ref, code, extra);
      return { ok: false as const, code, ref, message: P.userMessage(code, ref) };
    };
    const data = (ctx as { data?: { selections?: unknown; confirmationText?: unknown } }).data;
    if (data?.confirmationText !== "EXCLUIR") return fail("invalid_confirmation");
    const v = P.validateSelections(data?.selections);
    if (!v.ok) return fail("invalid_selection");
    const { userId, supabase } = (ctx as unknown as { context: { userId: string; supabase: Db } }).context;
    const categories = v.selections.map((s) => s.category);

    // Revalida vínculos no servidor (a prévia do navegador não é confiável).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let blockers;
    try {
      blockers = P.computeBlockers(v.selections, await collectFacts(supabaseAdmin, userId));
    } catch {
      return fail("preview_unavailable", { categories });
    }
    if (blockers.length > 0) {
      return { ...fail("blocked_by_dependencies", { categories, blockers: blockers.map((b) => b.code) }), blockers };
    }

    const options: Record<string, { scope: string }> = {};
    for (const s of v.selections) options[s.category] = { scope: s.scope };

    // Cliente do próprio usuário: auth.uid() no banco = userId (o cliente admin deixaria auth.uid() nulo).
    const { data: rpcResult, error } = await supabase.rpc("execute_data_deletion_atomic", {
      p_user_id: userId,
      p_categories: categories,
      p_options: options,
    });
    if (error) {
      const code = P.classifyRpcError(error);
      return fail(code, { categories, pgCode: typeof error.code === "string" ? error.code : null });
    }
    if (!P.isConfirmedResult(rpcResult, v.selections)) return fail("unconfirmed_result", { categories });
    return { ok: true, results: rpcResult as Record<string, number> };
  });
