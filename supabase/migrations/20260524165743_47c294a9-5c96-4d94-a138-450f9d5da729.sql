-- =====================================================================
-- Sprint 3 — Etapa 3.6: Gate RLS por feature específica.
-- Cria has_feature_access(uid, feature) espelhando src/lib/plans.ts e
-- substitui as policies de escrita premium para usar a feature correta.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.has_feature_access(_user_id uuid, _feature text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p plan_tier;
BEGIN
  -- Admin Master / full access bypass
  IF public.is_full_access(_user_id) THEN
    RETURN true;
  END IF;

  -- Sem plano ativo, nenhuma feature
  IF NOT public.has_active_plan_access(_user_id) THEN
    RETURN false;
  END IF;

  p := public.current_plan(_user_id);

  -- Features com whitelist explícita (mirror de FEATURE_PLAN_WHITELIST)
  CASE _feature
    WHEN 'investimentos', 'investimentos_futuro' THEN
      RETURN p IN ('pessoal_premium', 'mei_inteligente', 'empresa');
    WHEN 'importacoes', 'importar_extrato', 'importar_fatura', 'importar_conta' THEN
      RETURN p IN ('pessoal_premium', 'mei_inteligente', 'empresa');
    WHEN 'contas_a_receber_avancado', 'gasto_ai' THEN
      RETURN p IN ('pessoal_premium', 'mei_inteligente', 'empresa');
    WHEN 'centro_de_custo', 'perfil_cnpj', 'perfil_empresarial', 'recursos_empresa' THEN
      RETURN p = 'empresa';
    WHEN 'recursos_mei' THEN
      RETURN p IN ('mei_essencial', 'mei_inteligente');
    WHEN 'contas_conectadas' THEN
      RETURN p IN ('pessoal_premium', 'mei_essencial', 'mei_inteligente', 'empresa');
    WHEN 'empresa_inteligente' THEN
      RETURN p IN ('mei_essencial', 'mei_inteligente', 'empresa');
    -- Features lineares — threshold pessoal_premium (FEATURE_MIN_PLAN)
    WHEN 'relatorios_avancados', 'metas_visuais', 'assinaturas_recorrencias', 'whatsapp' THEN
      RETURN p IN ('pessoal_premium', 'mei_essencial', 'mei_inteligente', 'empresa');
    -- Features lineares — threshold pessoal_manual (qualquer plano pago)
    WHEN 'contas_a_pagar', 'contas_a_receber', 'cartoes', 'orcamento',
         'lancamentos_ilimitados', 'metas' THEN
      RETURN p IN ('pessoal_manual', 'pessoal_premium', 'mei_essencial', 'mei_inteligente', 'empresa');
    ELSE
      -- Feature desconhecida: nega por segurança
      RETURN false;
  END CASE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.has_feature_access(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_feature_access(uuid, text) TO authenticated, service_role;

-- =====================================================================
-- Recriação das policies de escrita usando has_feature_access(feature)
-- =====================================================================

-- ---------- metas_financeiras (feature: metas) ----------
DROP POLICY IF EXISTS metas_insert_own ON public.metas_financeiras;
DROP POLICY IF EXISTS metas_update_own ON public.metas_financeiras;
DROP POLICY IF EXISTS metas_delete_own ON public.metas_financeiras;
DROP POLICY IF EXISTS connected_insert_metas_financeiras ON public.metas_financeiras;
DROP POLICY IF EXISTS connected_update_metas_financeiras ON public.metas_financeiras;
DROP POLICY IF EXISTS connected_delete_metas_financeiras ON public.metas_financeiras;

CREATE POLICY metas_insert_own ON public.metas_financeiras FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'metas'));
CREATE POLICY metas_update_own ON public.metas_financeiras FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'metas'))
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'metas'));
CREATE POLICY metas_delete_own ON public.metas_financeiras FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'metas'));
CREATE POLICY connected_insert_metas_financeiras ON public.metas_financeiras FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_feature_access(user_id, 'metas'));
CREATE POLICY connected_update_metas_financeiras ON public.metas_financeiras FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'metas'))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'metas'));
CREATE POLICY connected_delete_metas_financeiras ON public.metas_financeiras FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'metas'));

-- ---------- movimentacoes_meta (feature: metas) ----------
DROP POLICY IF EXISTS mov_meta_insert_own ON public.movimentacoes_meta;
DROP POLICY IF EXISTS mov_meta_update_own ON public.movimentacoes_meta;
DROP POLICY IF EXISTS mov_meta_delete_own ON public.movimentacoes_meta;
DROP POLICY IF EXISTS connected_insert_movimentacoes_meta ON public.movimentacoes_meta;
DROP POLICY IF EXISTS connected_update_movimentacoes_meta ON public.movimentacoes_meta;
DROP POLICY IF EXISTS connected_delete_movimentacoes_meta ON public.movimentacoes_meta;

CREATE POLICY mov_meta_insert_own ON public.movimentacoes_meta FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'metas'));
CREATE POLICY mov_meta_update_own ON public.movimentacoes_meta FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'metas'))
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'metas'));
CREATE POLICY mov_meta_delete_own ON public.movimentacoes_meta FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'metas'));
CREATE POLICY connected_insert_movimentacoes_meta ON public.movimentacoes_meta FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_feature_access(user_id, 'metas'));
CREATE POLICY connected_update_movimentacoes_meta ON public.movimentacoes_meta FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'metas'))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'metas'));
CREATE POLICY connected_delete_movimentacoes_meta ON public.movimentacoes_meta FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'metas'));

-- ---------- cartoes (feature: cartoes) ----------
DROP POLICY IF EXISTS cartoes_insert_own ON public.cartoes;
DROP POLICY IF EXISTS cartoes_update_own ON public.cartoes;
DROP POLICY IF EXISTS cartoes_delete_own ON public.cartoes;
DROP POLICY IF EXISTS connected_insert_cartoes ON public.cartoes;
DROP POLICY IF EXISTS connected_update_cartoes ON public.cartoes;
DROP POLICY IF EXISTS connected_delete_cartoes ON public.cartoes;

CREATE POLICY cartoes_insert_own ON public.cartoes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'cartoes'));
CREATE POLICY cartoes_update_own ON public.cartoes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'cartoes'))
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'cartoes'));
CREATE POLICY cartoes_delete_own ON public.cartoes FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'cartoes'));
CREATE POLICY connected_insert_cartoes ON public.cartoes FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_feature_access(user_id, 'cartoes'));
CREATE POLICY connected_update_cartoes ON public.cartoes FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'cartoes'))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'cartoes'));
CREATE POLICY connected_delete_cartoes ON public.cartoes FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'cartoes'));

-- ---------- faturas_cartao (feature: cartoes) ----------
DROP POLICY IF EXISTS faturas_cartao_insert_own ON public.faturas_cartao;
DROP POLICY IF EXISTS faturas_cartao_update_own ON public.faturas_cartao;
DROP POLICY IF EXISTS faturas_cartao_delete_own ON public.faturas_cartao;
DROP POLICY IF EXISTS connected_insert_faturas_cartao ON public.faturas_cartao;
DROP POLICY IF EXISTS connected_update_faturas_cartao ON public.faturas_cartao;
DROP POLICY IF EXISTS connected_delete_faturas_cartao ON public.faturas_cartao;

CREATE POLICY faturas_cartao_insert_own ON public.faturas_cartao FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'cartoes'));
CREATE POLICY faturas_cartao_update_own ON public.faturas_cartao FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'cartoes'))
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'cartoes'));
CREATE POLICY faturas_cartao_delete_own ON public.faturas_cartao FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'cartoes'));
CREATE POLICY connected_insert_faturas_cartao ON public.faturas_cartao FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_feature_access(user_id, 'cartoes'));
CREATE POLICY connected_update_faturas_cartao ON public.faturas_cartao FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'cartoes'))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'cartoes'));
CREATE POLICY connected_delete_faturas_cartao ON public.faturas_cartao FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'cartoes'));

-- ---------- contas_a_pagar (feature: contas_a_pagar) ----------
DROP POLICY IF EXISTS contas_a_pagar_insert_own ON public.contas_a_pagar;
DROP POLICY IF EXISTS contas_a_pagar_update_own ON public.contas_a_pagar;
DROP POLICY IF EXISTS contas_a_pagar_delete_own ON public.contas_a_pagar;
DROP POLICY IF EXISTS connected_insert_contas_a_pagar ON public.contas_a_pagar;
DROP POLICY IF EXISTS connected_update_contas_a_pagar ON public.contas_a_pagar;
DROP POLICY IF EXISTS connected_delete_contas_a_pagar ON public.contas_a_pagar;

CREATE POLICY contas_a_pagar_insert_own ON public.contas_a_pagar FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'contas_a_pagar'));
CREATE POLICY contas_a_pagar_update_own ON public.contas_a_pagar FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'contas_a_pagar'))
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'contas_a_pagar'));
CREATE POLICY contas_a_pagar_delete_own ON public.contas_a_pagar FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'contas_a_pagar'));
CREATE POLICY connected_insert_contas_a_pagar ON public.contas_a_pagar FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_feature_access(user_id, 'contas_a_pagar'));
CREATE POLICY connected_update_contas_a_pagar ON public.contas_a_pagar FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'contas_a_pagar'))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'contas_a_pagar'));
CREATE POLICY connected_delete_contas_a_pagar ON public.contas_a_pagar FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'contas_a_pagar'));

-- ---------- contas_a_receber (feature: contas_a_receber) ----------
DROP POLICY IF EXISTS contas_receber_insert_own ON public.contas_a_receber;
DROP POLICY IF EXISTS contas_receber_update_own ON public.contas_a_receber;
DROP POLICY IF EXISTS contas_receber_delete_own ON public.contas_a_receber;
DROP POLICY IF EXISTS connected_insert_contas_a_receber ON public.contas_a_receber;
DROP POLICY IF EXISTS connected_update_contas_a_receber ON public.contas_a_receber;
DROP POLICY IF EXISTS connected_delete_contas_a_receber ON public.contas_a_receber;

CREATE POLICY contas_receber_insert_own ON public.contas_a_receber FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'contas_a_receber'));
CREATE POLICY contas_receber_update_own ON public.contas_a_receber FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'contas_a_receber'))
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'contas_a_receber'));
CREATE POLICY contas_receber_delete_own ON public.contas_a_receber FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'contas_a_receber'));
CREATE POLICY connected_insert_contas_a_receber ON public.contas_a_receber FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_feature_access(user_id, 'contas_a_receber'));
CREATE POLICY connected_update_contas_a_receber ON public.contas_a_receber FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'contas_a_receber'))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'contas_a_receber'));
CREATE POLICY connected_delete_contas_a_receber ON public.contas_a_receber FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'contas_a_receber'));

-- ---------- clientes (feature: empresa_inteligente) ----------
DROP POLICY IF EXISTS clientes_insert_own ON public.clientes;
DROP POLICY IF EXISTS clientes_update_own ON public.clientes;
DROP POLICY IF EXISTS clientes_delete_own ON public.clientes;
DROP POLICY IF EXISTS connected_insert_clientes ON public.clientes;
DROP POLICY IF EXISTS connected_update_clientes ON public.clientes;
DROP POLICY IF EXISTS connected_delete_clientes ON public.clientes;

CREATE POLICY clientes_insert_own ON public.clientes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'empresa_inteligente'));
CREATE POLICY clientes_update_own ON public.clientes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'empresa_inteligente'))
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'empresa_inteligente'));
CREATE POLICY clientes_delete_own ON public.clientes FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'empresa_inteligente'));
CREATE POLICY connected_insert_clientes ON public.clientes FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_feature_access(user_id, 'empresa_inteligente'));
CREATE POLICY connected_update_clientes ON public.clientes FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'empresa_inteligente'))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'empresa_inteligente'));
CREATE POLICY connected_delete_clientes ON public.clientes FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'empresa_inteligente'));

-- ---------- fornecedores (feature: empresa_inteligente) ----------
DROP POLICY IF EXISTS fornecedores_insert_own ON public.fornecedores;
DROP POLICY IF EXISTS fornecedores_update_own ON public.fornecedores;
DROP POLICY IF EXISTS fornecedores_delete_own ON public.fornecedores;

CREATE POLICY fornecedores_insert_own ON public.fornecedores FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'empresa_inteligente'));
CREATE POLICY fornecedores_update_own ON public.fornecedores FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'empresa_inteligente'))
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'empresa_inteligente'));
CREATE POLICY fornecedores_delete_own ON public.fornecedores FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'empresa_inteligente'));

-- ---------- recorrencias (feature: assinaturas_recorrencias) ----------
DROP POLICY IF EXISTS recorrencias_insert_own ON public.recorrencias;
DROP POLICY IF EXISTS recorrencias_update_own ON public.recorrencias;
DROP POLICY IF EXISTS recorrencias_delete_own ON public.recorrencias;
DROP POLICY IF EXISTS connected_insert_recorrencias ON public.recorrencias;
DROP POLICY IF EXISTS connected_update_recorrencias ON public.recorrencias;
DROP POLICY IF EXISTS connected_delete_recorrencias ON public.recorrencias;

CREATE POLICY recorrencias_insert_own ON public.recorrencias FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'assinaturas_recorrencias'));
CREATE POLICY recorrencias_update_own ON public.recorrencias FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'assinaturas_recorrencias'))
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'assinaturas_recorrencias'));
CREATE POLICY recorrencias_delete_own ON public.recorrencias FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'assinaturas_recorrencias'));
CREATE POLICY connected_insert_recorrencias ON public.recorrencias FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_feature_access(user_id, 'assinaturas_recorrencias'));
CREATE POLICY connected_update_recorrencias ON public.recorrencias FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'assinaturas_recorrencias'))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'assinaturas_recorrencias'));
CREATE POLICY connected_delete_recorrencias ON public.recorrencias FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'assinaturas_recorrencias'));

-- ---------- user_companies (feature: empresa_inteligente) ----------
DROP POLICY IF EXISTS user_companies_insert_own ON public.user_companies;
DROP POLICY IF EXISTS user_companies_update_own ON public.user_companies;
DROP POLICY IF EXISTS user_companies_delete_own ON public.user_companies;

CREATE POLICY user_companies_insert_own ON public.user_companies FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'empresa_inteligente'));
CREATE POLICY user_companies_update_own ON public.user_companies FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'empresa_inteligente'))
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'empresa_inteligente'));
CREATE POLICY user_companies_delete_own ON public.user_companies FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'empresa_inteligente'));

-- ---------- investimentos_ativos (feature: investimentos) ----------
DROP POLICY IF EXISTS inv_ativos_insert_own ON public.investimentos_ativos;
DROP POLICY IF EXISTS inv_ativos_update_own ON public.investimentos_ativos;
DROP POLICY IF EXISTS inv_ativos_delete_own ON public.investimentos_ativos;
DROP POLICY IF EXISTS connected_insert_investimentos_ativos ON public.investimentos_ativos;
DROP POLICY IF EXISTS connected_update_investimentos_ativos ON public.investimentos_ativos;
DROP POLICY IF EXISTS connected_delete_investimentos_ativos ON public.investimentos_ativos;

CREATE POLICY inv_ativos_insert_own ON public.investimentos_ativos FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'investimentos'));
CREATE POLICY inv_ativos_update_own ON public.investimentos_ativos FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'investimentos'))
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'investimentos'));
CREATE POLICY inv_ativos_delete_own ON public.investimentos_ativos FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'investimentos'));
CREATE POLICY connected_insert_investimentos_ativos ON public.investimentos_ativos FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_feature_access(user_id, 'investimentos'));
CREATE POLICY connected_update_investimentos_ativos ON public.investimentos_ativos FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'investimentos'))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'investimentos'));
CREATE POLICY connected_delete_investimentos_ativos ON public.investimentos_ativos FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'investimentos'));

-- ---------- investimentos_movimentacoes ----------
DROP POLICY IF EXISTS inv_mov_insert_own ON public.investimentos_movimentacoes;
DROP POLICY IF EXISTS inv_mov_update_own ON public.investimentos_movimentacoes;
DROP POLICY IF EXISTS inv_mov_delete_own ON public.investimentos_movimentacoes;
DROP POLICY IF EXISTS connected_insert_investimentos_movimentacoes ON public.investimentos_movimentacoes;
DROP POLICY IF EXISTS connected_update_investimentos_movimentacoes ON public.investimentos_movimentacoes;
DROP POLICY IF EXISTS connected_delete_investimentos_movimentacoes ON public.investimentos_movimentacoes;

CREATE POLICY inv_mov_insert_own ON public.investimentos_movimentacoes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'investimentos'));
CREATE POLICY inv_mov_update_own ON public.investimentos_movimentacoes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'investimentos'))
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'investimentos'));
CREATE POLICY inv_mov_delete_own ON public.investimentos_movimentacoes FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'investimentos'));
CREATE POLICY connected_insert_investimentos_movimentacoes ON public.investimentos_movimentacoes FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_feature_access(user_id, 'investimentos'));
CREATE POLICY connected_update_investimentos_movimentacoes ON public.investimentos_movimentacoes FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'investimentos'))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'investimentos'));
CREATE POLICY connected_delete_investimentos_movimentacoes ON public.investimentos_movimentacoes FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'investimentos'));

-- ---------- investimentos_atualizacoes ----------
DROP POLICY IF EXISTS inv_atual_insert_own ON public.investimentos_atualizacoes;
DROP POLICY IF EXISTS inv_atual_update_own ON public.investimentos_atualizacoes;
DROP POLICY IF EXISTS inv_atual_delete_own ON public.investimentos_atualizacoes;
DROP POLICY IF EXISTS connected_insert_investimentos_atualizacoes ON public.investimentos_atualizacoes;
DROP POLICY IF EXISTS connected_update_investimentos_atualizacoes ON public.investimentos_atualizacoes;
DROP POLICY IF EXISTS connected_delete_investimentos_atualizacoes ON public.investimentos_atualizacoes;

CREATE POLICY inv_atual_insert_own ON public.investimentos_atualizacoes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'investimentos'));
CREATE POLICY inv_atual_update_own ON public.investimentos_atualizacoes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'investimentos'))
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'investimentos'));
CREATE POLICY inv_atual_delete_own ON public.investimentos_atualizacoes FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'investimentos'));
CREATE POLICY connected_insert_investimentos_atualizacoes ON public.investimentos_atualizacoes FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_feature_access(user_id, 'investimentos'));
CREATE POLICY connected_update_investimentos_atualizacoes ON public.investimentos_atualizacoes FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'investimentos'))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'investimentos'));
CREATE POLICY connected_delete_investimentos_atualizacoes ON public.investimentos_atualizacoes FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'investimentos'));

-- ---------- investimentos_rendimentos ----------
DROP POLICY IF EXISTS inv_rend_insert_own ON public.investimentos_rendimentos;
DROP POLICY IF EXISTS inv_rend_update_own ON public.investimentos_rendimentos;
DROP POLICY IF EXISTS inv_rend_delete_own ON public.investimentos_rendimentos;
DROP POLICY IF EXISTS connected_insert_investimentos_rendimentos ON public.investimentos_rendimentos;
DROP POLICY IF EXISTS connected_update_investimentos_rendimentos ON public.investimentos_rendimentos;
DROP POLICY IF EXISTS connected_delete_investimentos_rendimentos ON public.investimentos_rendimentos;

CREATE POLICY inv_rend_insert_own ON public.investimentos_rendimentos FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'investimentos'));
CREATE POLICY inv_rend_update_own ON public.investimentos_rendimentos FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'investimentos'))
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'investimentos'));
CREATE POLICY inv_rend_delete_own ON public.investimentos_rendimentos FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'investimentos'));
CREATE POLICY connected_insert_investimentos_rendimentos ON public.investimentos_rendimentos FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_feature_access(user_id, 'investimentos'));
CREATE POLICY connected_update_investimentos_rendimentos ON public.investimentos_rendimentos FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'investimentos'))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'investimentos'));
CREATE POLICY connected_delete_investimentos_rendimentos ON public.investimentos_rendimentos FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'investimentos'));

-- ---------- investimentos_importacoes ----------
DROP POLICY IF EXISTS inv_imp_insert_own ON public.investimentos_importacoes;
DROP POLICY IF EXISTS inv_imp_update_own ON public.investimentos_importacoes;
DROP POLICY IF EXISTS inv_imp_delete_own ON public.investimentos_importacoes;
DROP POLICY IF EXISTS connected_insert_investimentos_importacoes ON public.investimentos_importacoes;
DROP POLICY IF EXISTS connected_update_investimentos_importacoes ON public.investimentos_importacoes;
DROP POLICY IF EXISTS connected_delete_investimentos_importacoes ON public.investimentos_importacoes;

CREATE POLICY inv_imp_insert_own ON public.investimentos_importacoes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'investimentos'));
CREATE POLICY inv_imp_update_own ON public.investimentos_importacoes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'investimentos'))
  WITH CHECK (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'investimentos'));
CREATE POLICY inv_imp_delete_own ON public.investimentos_importacoes FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.has_feature_access(auth.uid(), 'investimentos'));
CREATE POLICY connected_insert_investimentos_importacoes ON public.investimentos_importacoes FOR INSERT TO authenticated
  WITH CHECK (public.can_create_in_account(user_id) AND public.has_feature_access(user_id, 'investimentos'));
CREATE POLICY connected_update_investimentos_importacoes ON public.investimentos_importacoes FOR UPDATE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'investimentos'))
  WITH CHECK (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'investimentos'));
CREATE POLICY connected_delete_investimentos_importacoes ON public.investimentos_importacoes FOR DELETE TO authenticated
  USING (public.can_admin_account(user_id) AND public.has_feature_access(user_id, 'investimentos'));
