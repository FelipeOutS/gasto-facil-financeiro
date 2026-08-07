import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Mapeamento de categorias de exclusão para tabelas do banco de dados.
 * Baseado na auditoria em docs/EXCLUSAO_SELETIVA_DADOS_USUARIO.md.
 */
const CATEGORY_TABLES: Record<string, string[]> = {
  expenses: ["gastos"],
  income: ["receitas"],
  payables: ["contas_a_pagar"],
  receivables: ["contas_a_receber"],
  subscriptions: ["recorrencias"],
  budgets: ["limites"],
  goals: ["metas_financeiras", "movimentacoes_meta"],
  savings: ["dinheiro_guardado"],
  investments: ["investimentos_ativos", "investimentos_atualizacoes", "investimentos_movimentacoes", "investimentos_rendimentos"],
  cards: ["cartoes", "faturas_cartao"],
  market: ["mercado_listas", "mercado_historico_compras", "mercado_precos_usuario", "mercado_mercados_salvos"],
  imports: ["extratos_importados", "imported_transactions", "investimentos_importacoes"]
};

export const getDeletionPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }: { data: { categories: string[] }, context: any }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;
    
    const stats: Record<string, number> = {};
    
    for (const cat of data.categories) {
      const tables = CATEGORY_TABLES[cat] || [];
      let total = 0;
      
      for (const table of tables) {
        const { count, error } = await supabaseAdmin
          .from(table as any)
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId);
          
        if (!error && count !== null) {
          total += count;
        }
      }
      stats[cat] = total;
    }
    
    return { stats };
  });

export const executeDataDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }: { data: { categories: string[]; confirmationText: string }, context: any }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    if (data.confirmationText !== "EXCLUIR") {
      throw new Error("Confirmação inválida");
    }

    const results: Record<string, { success: boolean; deletedCount?: number; error?: any }> = {};

    for (const cat of data.categories) {
      const tables = CATEGORY_TABLES[cat] || [];
      
      for (const table of tables) {
        const { error, count } = await supabaseAdmin
          .from(table as any)
          .delete()
          .eq("user_id", userId);

        results[table] = { 
          success: !error, 
          deletedCount: count || 0,
          error: error ? error.message : undefined 
        };
      }
    }

    await supabaseAdmin.from("audit_logs").insert({
      actor_user_id: userId,
      target_user_id: userId,
      action: "selective_data_deletion",
      entity_type: "multiple",
      metadata: { categories: data.categories, results }
    });

    return { success: true, results };
  });
