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

export const getDeletionPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (ctx) => {
    const data = (ctx as any).data as { selections: DeletionSelection[] };
    const context = (ctx as any).context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;
    
    const stats: Record<string, number> = {};
    const dependencies: { type: string; count: number; action: string }[] = [];
    
    for (const selection of data.selections) {
      const mapping = CATEGORY_MAP[selection.category];
      if (!mapping) continue;

      let categoryTotal = 0;
      for (const table of mapping.tables) {
        let query = supabaseAdmin
          .from(table as any)
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId);

        // Apply scopes for payables/receivables
        if (selection.category === "payables" && selection.scope !== "all") {
          const statusMap: Record<string, string> = { paid: "pago", pending: "pendente", overdue: "atrasado" };
          query = query.eq("status", statusMap[selection.scope]);
        } else if (selection.category === "receivables" && selection.scope !== "all") {
          const statusMap: Record<string, string> = { received: "recebido", pending: "pendente", overdue: "atrasado" };
          query = query.eq("status", statusMap[selection.scope]);
        }

        const { count, error } = await query;
        if (!error && count !== null) {
          categoryTotal += count;
        }
      }
      stats[selection.category] = categoryTotal;

      // Add dependency info if applicable
      if (selection.category === "cards") {
        const { count: linkedExpenses } = await supabaseAdmin
          .from("gastos")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId)
          .not("cartao_id", "is", null);
        
        if (linkedExpenses && linkedExpenses > 0) {
          dependencies.push({
            type: "linked_transactions",
            count: linkedExpenses,
            action: "preserved_and_unlinked"
          });
        }
      }
    }
    
    return { stats, dependencies, totalPrimaryRecords: Object.values(stats).reduce((a, b) => a + b, 0) };
  });

export const executeDataDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (ctx) => {
    const data = (ctx as any).data as { selections: DeletionSelection[]; confirmationText: string };
    const context = (ctx as any).context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    if (data.confirmationText !== "EXCLUIR") {
      throw new Error("Confirmação inválida");
    }

    // Call the atomic PostgreSQL RPC
    const categories = data.selections.map(s => s.category);
    const options: Record<string, any> = {};
    data.selections.forEach(s => {
      options[s.category] = { scope: s.scope };
    });

    const { data: rpcResult, error } = await supabaseAdmin.rpc("execute_data_deletion_atomic", {
      p_user_id: userId,
      p_categories: categories,
      p_options: options
    });

    if (error) {
      console.error("Atomic deletion failed:", error);
      throw new Error(`Erro na exclusão atômica: ${error.message}`);
    }

    return { success: true, results: rpcResult };
  });
