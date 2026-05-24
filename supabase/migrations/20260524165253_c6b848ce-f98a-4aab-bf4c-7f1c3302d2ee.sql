-- Endurecimento RLS de módulos premium (Sprint 3 - Etapa 3.5)
-- Bloqueia INSERT/UPDATE/DELETE direto via Supabase client quando o usuário
-- não tem plano ativo. Admin Master continua com bypass via has_active_plan_access.

-- ============================================================
-- Helper: bloco genérico para refazer policies de escrita
-- ============================================================

-- metas_financeiras
DROP POLICY IF EXISTS metas_insert_own ON public.metas_financeiras;
DROP POLICY IF EXISTS metas_update_own ON public.metas_financeiras;
DROP POLICY IF EXISTS metas_delete_own ON public.metas_financeiras;
DROP POLICY IF EXISTS connected_insert_metas_financeiras ON public.metas_financeiras;
DROP POLICY IF EXISTS connected_update_metas_financeiras ON public.metas_financeiras;
DROP POLICY IF EXISTS connected_delete_metas_financeiras ON public.metas_financeiras;

CREATE POLICY metas_insert_own ON public.metas_financeiras FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY metas_update_own ON public.metas_financeiras FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY metas_delete_own ON public.metas_financeiras FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY connected_insert_metas_financeiras ON public.metas_financeiras FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_update_metas_financeiras ON public.metas_financeiras FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_delete_metas_financeiras ON public.metas_financeiras FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));

-- movimentacoes_meta
DROP POLICY IF EXISTS mov_meta_insert_own ON public.movimentacoes_meta;
DROP POLICY IF EXISTS mov_meta_update_own ON public.movimentacoes_meta;
DROP POLICY IF EXISTS mov_meta_delete_own ON public.movimentacoes_meta;
DROP POLICY IF EXISTS connected_insert_movimentacoes_meta ON public.movimentacoes_meta;
DROP POLICY IF EXISTS connected_update_movimentacoes_meta ON public.movimentacoes_meta;
DROP POLICY IF EXISTS connected_delete_movimentacoes_meta ON public.movimentacoes_meta;

CREATE POLICY mov_meta_insert_own ON public.movimentacoes_meta FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY mov_meta_update_own ON public.movimentacoes_meta FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY mov_meta_delete_own ON public.movimentacoes_meta FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY connected_insert_movimentacoes_meta ON public.movimentacoes_meta FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_update_movimentacoes_meta ON public.movimentacoes_meta FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_delete_movimentacoes_meta ON public.movimentacoes_meta FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));

-- cartoes
DROP POLICY IF EXISTS cartoes_insert_own ON public.cartoes;
DROP POLICY IF EXISTS cartoes_update_own ON public.cartoes;
DROP POLICY IF EXISTS cartoes_delete_own ON public.cartoes;
DROP POLICY IF EXISTS connected_insert_cartoes ON public.cartoes;
DROP POLICY IF EXISTS connected_update_cartoes ON public.cartoes;
DROP POLICY IF EXISTS connected_delete_cartoes ON public.cartoes;

CREATE POLICY cartoes_insert_own ON public.cartoes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY cartoes_update_own ON public.cartoes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY cartoes_delete_own ON public.cartoes FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY connected_insert_cartoes ON public.cartoes FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_update_cartoes ON public.cartoes FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_delete_cartoes ON public.cartoes FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));

-- faturas_cartao
DROP POLICY IF EXISTS faturas_cartao_insert_own ON public.faturas_cartao;
DROP POLICY IF EXISTS faturas_cartao_update_own ON public.faturas_cartao;
DROP POLICY IF EXISTS faturas_cartao_delete_own ON public.faturas_cartao;
DROP POLICY IF EXISTS connected_insert_faturas_cartao ON public.faturas_cartao;
DROP POLICY IF EXISTS connected_update_faturas_cartao ON public.faturas_cartao;
DROP POLICY IF EXISTS connected_delete_faturas_cartao ON public.faturas_cartao;

CREATE POLICY faturas_cartao_insert_own ON public.faturas_cartao FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY faturas_cartao_update_own ON public.faturas_cartao FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY faturas_cartao_delete_own ON public.faturas_cartao FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY connected_insert_faturas_cartao ON public.faturas_cartao FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_update_faturas_cartao ON public.faturas_cartao FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_delete_faturas_cartao ON public.faturas_cartao FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));

-- contas_a_pagar
DROP POLICY IF EXISTS contas_a_pagar_insert_own ON public.contas_a_pagar;
DROP POLICY IF EXISTS contas_a_pagar_update_own ON public.contas_a_pagar;
DROP POLICY IF EXISTS contas_a_pagar_delete_own ON public.contas_a_pagar;
DROP POLICY IF EXISTS connected_insert_contas_a_pagar ON public.contas_a_pagar;
DROP POLICY IF EXISTS connected_update_contas_a_pagar ON public.contas_a_pagar;
DROP POLICY IF EXISTS connected_delete_contas_a_pagar ON public.contas_a_pagar;

CREATE POLICY contas_a_pagar_insert_own ON public.contas_a_pagar FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY contas_a_pagar_update_own ON public.contas_a_pagar FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY contas_a_pagar_delete_own ON public.contas_a_pagar FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY connected_insert_contas_a_pagar ON public.contas_a_pagar FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_update_contas_a_pagar ON public.contas_a_pagar FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_delete_contas_a_pagar ON public.contas_a_pagar FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));

-- contas_a_receber
DROP POLICY IF EXISTS contas_receber_insert_own ON public.contas_a_receber;
DROP POLICY IF EXISTS contas_receber_update_own ON public.contas_a_receber;
DROP POLICY IF EXISTS contas_receber_delete_own ON public.contas_a_receber;
DROP POLICY IF EXISTS connected_insert_contas_a_receber ON public.contas_a_receber;
DROP POLICY IF EXISTS connected_update_contas_a_receber ON public.contas_a_receber;
DROP POLICY IF EXISTS connected_delete_contas_a_receber ON public.contas_a_receber;

CREATE POLICY contas_receber_insert_own ON public.contas_a_receber FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY contas_receber_update_own ON public.contas_a_receber FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY contas_receber_delete_own ON public.contas_a_receber FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY connected_insert_contas_a_receber ON public.contas_a_receber FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_update_contas_a_receber ON public.contas_a_receber FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_delete_contas_a_receber ON public.contas_a_receber FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));

-- clientes
DROP POLICY IF EXISTS "Usuário cria seus clientes" ON public.clientes;
DROP POLICY IF EXISTS "Usuário atualiza seus clientes" ON public.clientes;
DROP POLICY IF EXISTS "Usuário remove seus clientes" ON public.clientes;
DROP POLICY IF EXISTS connected_insert_clientes ON public.clientes;
DROP POLICY IF EXISTS connected_update_clientes ON public.clientes;
DROP POLICY IF EXISTS connected_delete_clientes ON public.clientes;

CREATE POLICY clientes_insert_own ON public.clientes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY clientes_update_own ON public.clientes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY clientes_delete_own ON public.clientes FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY connected_insert_clientes ON public.clientes FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_update_clientes ON public.clientes FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_delete_clientes ON public.clientes FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));

-- fornecedores
DROP POLICY IF EXISTS "Usuário cria seus fornecedores" ON public.fornecedores;
DROP POLICY IF EXISTS "Usuário atualiza seus fornecedores" ON public.fornecedores;
DROP POLICY IF EXISTS "Usuário remove seus fornecedores" ON public.fornecedores;

CREATE POLICY fornecedores_insert_own ON public.fornecedores FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY fornecedores_update_own ON public.fornecedores FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY fornecedores_delete_own ON public.fornecedores FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));

-- recorrencias
DROP POLICY IF EXISTS recorrencias_insert_own ON public.recorrencias;
DROP POLICY IF EXISTS recorrencias_update_own ON public.recorrencias;
DROP POLICY IF EXISTS recorrencias_delete_own ON public.recorrencias;
DROP POLICY IF EXISTS connected_insert_recorrencias ON public.recorrencias;
DROP POLICY IF EXISTS connected_update_recorrencias ON public.recorrencias;
DROP POLICY IF EXISTS connected_delete_recorrencias ON public.recorrencias;

CREATE POLICY recorrencias_insert_own ON public.recorrencias FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY recorrencias_update_own ON public.recorrencias FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY recorrencias_delete_own ON public.recorrencias FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY connected_insert_recorrencias ON public.recorrencias FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_update_recorrencias ON public.recorrencias FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_delete_recorrencias ON public.recorrencias FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));

-- user_companies
DROP POLICY IF EXISTS user_companies_insert_own ON public.user_companies;
DROP POLICY IF EXISTS user_companies_update_own ON public.user_companies;
DROP POLICY IF EXISTS user_companies_delete_own ON public.user_companies;

CREATE POLICY user_companies_insert_own ON public.user_companies FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY user_companies_update_own ON public.user_companies FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY user_companies_delete_own ON public.user_companies FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));

-- investimentos_ativos
DROP POLICY IF EXISTS inv_ativos_insert_own ON public.investimentos_ativos;
DROP POLICY IF EXISTS inv_ativos_update_own ON public.investimentos_ativos;
DROP POLICY IF EXISTS inv_ativos_delete_own ON public.investimentos_ativos;
DROP POLICY IF EXISTS connected_insert_investimentos_ativos ON public.investimentos_ativos;
DROP POLICY IF EXISTS connected_update_investimentos_ativos ON public.investimentos_ativos;
DROP POLICY IF EXISTS connected_delete_investimentos_ativos ON public.investimentos_ativos;

CREATE POLICY inv_ativos_insert_own ON public.investimentos_ativos FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY inv_ativos_update_own ON public.investimentos_ativos FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY inv_ativos_delete_own ON public.investimentos_ativos FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY connected_insert_investimentos_ativos ON public.investimentos_ativos FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_update_investimentos_ativos ON public.investimentos_ativos FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_delete_investimentos_ativos ON public.investimentos_ativos FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));

-- investimentos_movimentacoes
DROP POLICY IF EXISTS inv_mov_insert_own ON public.investimentos_movimentacoes;
DROP POLICY IF EXISTS inv_mov_update_own ON public.investimentos_movimentacoes;
DROP POLICY IF EXISTS inv_mov_delete_own ON public.investimentos_movimentacoes;
DROP POLICY IF EXISTS connected_insert_investimentos_movimentacoes ON public.investimentos_movimentacoes;
DROP POLICY IF EXISTS connected_update_investimentos_movimentacoes ON public.investimentos_movimentacoes;
DROP POLICY IF EXISTS connected_delete_investimentos_movimentacoes ON public.investimentos_movimentacoes;

CREATE POLICY inv_mov_insert_own ON public.investimentos_movimentacoes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY inv_mov_update_own ON public.investimentos_movimentacoes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY inv_mov_delete_own ON public.investimentos_movimentacoes FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY connected_insert_investimentos_movimentacoes ON public.investimentos_movimentacoes FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_update_investimentos_movimentacoes ON public.investimentos_movimentacoes FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_delete_investimentos_movimentacoes ON public.investimentos_movimentacoes FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));

-- investimentos_atualizacoes
DROP POLICY IF EXISTS inv_atual_insert_own ON public.investimentos_atualizacoes;
DROP POLICY IF EXISTS inv_atual_update_own ON public.investimentos_atualizacoes;
DROP POLICY IF EXISTS inv_atual_delete_own ON public.investimentos_atualizacoes;
DROP POLICY IF EXISTS connected_insert_investimentos_atualizacoes ON public.investimentos_atualizacoes;
DROP POLICY IF EXISTS connected_update_investimentos_atualizacoes ON public.investimentos_atualizacoes;
DROP POLICY IF EXISTS connected_delete_investimentos_atualizacoes ON public.investimentos_atualizacoes;

CREATE POLICY inv_atual_insert_own ON public.investimentos_atualizacoes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY inv_atual_update_own ON public.investimentos_atualizacoes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY inv_atual_delete_own ON public.investimentos_atualizacoes FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY connected_insert_investimentos_atualizacoes ON public.investimentos_atualizacoes FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_update_investimentos_atualizacoes ON public.investimentos_atualizacoes FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_delete_investimentos_atualizacoes ON public.investimentos_atualizacoes FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));

-- investimentos_rendimentos
DROP POLICY IF EXISTS inv_rend_insert_own ON public.investimentos_rendimentos;
DROP POLICY IF EXISTS inv_rend_update_own ON public.investimentos_rendimentos;
DROP POLICY IF EXISTS inv_rend_delete_own ON public.investimentos_rendimentos;
DROP POLICY IF EXISTS connected_insert_investimentos_rendimentos ON public.investimentos_rendimentos;
DROP POLICY IF EXISTS connected_update_investimentos_rendimentos ON public.investimentos_rendimentos;
DROP POLICY IF EXISTS connected_delete_investimentos_rendimentos ON public.investimentos_rendimentos;

CREATE POLICY inv_rend_insert_own ON public.investimentos_rendimentos FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY inv_rend_update_own ON public.investimentos_rendimentos FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY inv_rend_delete_own ON public.investimentos_rendimentos FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY connected_insert_investimentos_rendimentos ON public.investimentos_rendimentos FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_update_investimentos_rendimentos ON public.investimentos_rendimentos FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_delete_investimentos_rendimentos ON public.investimentos_rendimentos FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));

-- investimentos_importacoes
DROP POLICY IF EXISTS inv_imp_insert_own ON public.investimentos_importacoes;
DROP POLICY IF EXISTS inv_imp_update_own ON public.investimentos_importacoes;
DROP POLICY IF EXISTS inv_imp_delete_own ON public.investimentos_importacoes;
DROP POLICY IF EXISTS connected_insert_investimentos_importacoes ON public.investimentos_importacoes;
DROP POLICY IF EXISTS connected_update_investimentos_importacoes ON public.investimentos_importacoes;
DROP POLICY IF EXISTS connected_delete_investimentos_importacoes ON public.investimentos_importacoes;

CREATE POLICY inv_imp_insert_own ON public.investimentos_importacoes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY inv_imp_update_own ON public.investimentos_importacoes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY inv_imp_delete_own ON public.investimentos_importacoes FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_active_plan_access(auth.uid()));
CREATE POLICY connected_insert_investimentos_importacoes ON public.investimentos_importacoes FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_update_investimentos_importacoes ON public.investimentos_importacoes FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));
CREATE POLICY connected_delete_investimentos_importacoes ON public.investimentos_importacoes FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_active_plan_access(user_id));
