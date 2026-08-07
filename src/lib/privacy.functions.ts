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
  .inputValidator((d) => z.object({ categories: z.array(z.string()) }).parse(d))
  .handler(async ({ input, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;
    
    const stats: Record<string, number> = {};
    
    for (const cat of input.categories) {
      const tables = CATEGORY_TABLES[cat] || [];
      let total = 0;
      
      for (const table of tables) {
        const { count, error } = await supabaseAdmin
          .from(table)
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
  .inputValidator((d) => z.object({ 
    categories: z.array(z.string()),
    confirmationText: z.string()
  }).parse(d))
  .handler(async ({ input, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    if (input.confirmationText !== "EXCLUIR") {
      throw new Error("Confirmação inválida");
    }

    const results: Record<string, { success: boolean; deletedCount?: number; error?: any }> = {};

    // Executamos a exclusão por categoria
    for (const cat of input.categories) {
      const tables = CATEGORY_TABLES[cat] || [];
      
      for (const table of tables) {
        // Algumas tabelas podem ter dependências complexas ou RLS específicas
        // No Lovable Cloud, usamos o supabaseAdmin para garantir a execução da limpeza
        const { error, count } = await supabaseAdmin
          .from(table)
          .delete()
          .eq("user_id", userId);

        results[table] = { 
          success: !error, 
          deletedCount: count || 0,
          error: error ? error.message : undefined 
        };
      }
    }

    // Auditoria da ação destrutiva
    await supabaseAdmin.from("audit_logs").insert({
      actor_user_id: userId,
      target_user_id: userId,
      action: "selective_data_deletion",
      entity_type: "multiple",
      metadata: { categories: input.categories, results }
    });

    return { success: true, results };
  });
