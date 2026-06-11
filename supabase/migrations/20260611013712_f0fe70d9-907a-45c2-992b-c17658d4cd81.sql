CREATE OR REPLACE FUNCTION public.has_feature_access(_user_id uuid, _feature text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  p plan_tier;
BEGIN
  IF public.is_full_access(_user_id) THEN
    RETURN true;
  END IF;

  -- Features básicas: free_ads + planos pagos.
  IF _feature IN (
    'gastos_basico','receitas_basico','mercado_basico',
    'cartoes_basico','orcamento_basico','metas_basico'
  ) THEN
    p := public.current_plan(_user_id);
    RETURN p IN (
      'free_ads'::plan_tier,
      'pessoal_manual'::plan_tier,
      'pessoal_premium'::plan_tier,
      'mei_essencial'::plan_tier,
      'mei_inteligente'::plan_tier,
      'empresa'::plan_tier
    );
  END IF;

  -- Fase 1E-B2H — 'metas' libera free_ads + planos pagos.
  -- Limite de 2 metas no free_ads é aplicado pelo trigger
  -- tg_free_ads_quota_metas (assert_free_ads_quota, cap=2).
  IF _feature = 'metas' THEN
    p := public.current_plan(_user_id);
    RETURN p IN (
      'free_ads'::plan_tier,
      'pessoal_manual'::plan_tier,
      'pessoal_premium'::plan_tier,
      'mei_essencial'::plan_tier,
      'mei_inteligente'::plan_tier,
      'empresa'::plan_tier
    );
  END IF;

  IF NOT public.has_active_plan_access(_user_id) THEN
    RETURN false;
  END IF;

  p := public.current_plan(_user_id);

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
    WHEN 'relatorios_avancados', 'metas_visuais', 'assinaturas_recorrencias', 'whatsapp' THEN
      RETURN p IN ('pessoal_premium', 'mei_essencial', 'mei_inteligente', 'empresa');
    WHEN 'contas_a_pagar', 'contas_a_receber', 'cartoes', 'orcamento',
         'lancamentos_ilimitados' THEN
      RETURN p IN ('pessoal_manual', 'pessoal_premium', 'mei_essencial', 'mei_inteligente', 'empresa');
    ELSE
      RETURN false;
  END CASE;
END;
$function$;