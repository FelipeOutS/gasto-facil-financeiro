import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Tabelas que armazenam dados pessoais do usuário, todas protegidas por RLS
 * com `user_id = auth.uid()`. Limpamos via service role para garantir remoção
 * mesmo após o auth.user ser excluído.
 */
const USER_DATA_TABLES = [
  "aprendizado_categoria",
  "bancos",
  "cartoes",
  "categorias",
  "contas_a_pagar",
  "contas_a_receber",
  "dinheiro_guardado",
  "extratos_importados",
  "faturas_cartao",
  "gastos",
  "investimentos_ativos",
  "investimentos_atualizacoes",
  "investimentos_importacoes",
  "investimentos_movimentacoes",
  "investimentos_rendimentos",
  "limites",
  "metas_financeiras",
  "movimentacoes_meta",
  "receitas",
  "recorrencias",
  "subscription_payments",
  "transferencias_internas",
  "user_plans",
  "user_roles",
  "whatsapp_links",
  "whatsapp_messages",
] as const;

export const deleteMyAccount = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        confirmationText: z.string().min(1).max(20),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    if (data.confirmationText !== "EXCLUIR") {
      throw new Error("Confirmação inválida");
    }

    const { userId } = context;
    if (!userId) throw new Error("Usuário não autenticado");

    // 1) Remove o profile (id = user_id em profiles)
    {
      const { error } = await supabaseAdmin
        .from("profiles")
        .delete()
        .eq("id", userId);
      if (error) {
        console.error("[deleteMyAccount] profiles", error);
      }
    }

    // 2) Limpa as demais tabelas user-scoped
    for (const table of USER_DATA_TABLES) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabaseAdmin as any)
        .from(table)
        .delete()
        .eq("user_id", userId);
      if (error) {
        console.error(`[deleteMyAccount] ${table}`, error.message);
        // Continua tentando as outras tabelas
      }
    }

    // 3) Remove o usuário do Supabase Auth — exige service role
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authError) {
      console.error("[deleteMyAccount] auth.admin.deleteUser", authError);
      throw new Error("Não foi possível excluir o usuário. Tente novamente.");
    }

    return { ok: true };
  });
