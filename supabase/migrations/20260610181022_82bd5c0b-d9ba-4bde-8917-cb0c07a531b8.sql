-- =========================================================================
-- Fase 1E-B2A: helpers SQL + quotas free_ads (free_ads-only, fail-closed)
-- Nenhuma policy RLS existente é alterada. Nenhuma feature liberada.
-- Triggers só restringem quando current_plan(user_id) = 'free_ads'.
-- =========================================================================

-- 1) has_paid_plan_access ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_paid_plan_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_full_access(_user_id)
      OR (
        public.has_active_plan_access(_user_id)
        AND public.current_plan(_user_id) NOT IN (
          'free'::public.plan_tier,
          'sem_assinatura'::public.plan_tier,
          'free_ads'::public.plan_tier
        )
      );
$$;
REVOKE EXECUTE ON FUNCTION public.has_paid_plan_access(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.has_paid_plan_access(uuid) TO authenticated, service_role;

-- 2) has_basic_feature_access ---------------------------------------------
-- Reconhece features básicas futuras. Não conectada a nenhuma policy ainda.
CREATE OR REPLACE FUNCTION public.has_basic_feature_access(_user_id uuid, _feature text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE p public.plan_tier;
BEGIN
  IF public.is_full_access(_user_id) THEN RETURN true; END IF;
  IF NOT public.has_active_plan_access(_user_id) THEN RETURN false; END IF;
  p := public.current_plan(_user_id);
  CASE _feature
    WHEN 'gastos_basico','receitas_basico','mercado_basico',
         'cartoes_basico','orcamento_basico','metas_basico' THEN
      RETURN p IN (
        'free_ads'::public.plan_tier,
        'pessoal_manual'::public.plan_tier,
        'pessoal_premium'::public.plan_tier,
        'mei_essencial'::public.plan_tier,
        'mei_inteligente'::public.plan_tier,
        'empresa'::public.plan_tier
      );
    ELSE
      RETURN false;
  END CASE;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.has_basic_feature_access(uuid, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.has_basic_feature_access(uuid, text) TO authenticated, service_role;

-- 3) assert_free_ads_quota ------------------------------------------------
-- Whitelist fechada por recurso. Só executa restrição se for free_ads.
CREATE OR REPLACE FUNCTION public.assert_free_ads_quota(_user_id uuid, _resource text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  used int := 0;
  cap  int := 0;
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;
  -- Free-ads-only: qualquer outro plano (pago, trial, sem_assinatura, admin)
  -- passa sem nenhuma checagem -> usuários atuais não são afetados.
  IF public.current_plan(_user_id) <> 'free_ads'::public.plan_tier THEN
    RETURN;
  END IF;

  CASE _resource
    WHEN 'gastos' THEN
      cap := 30;
      SELECT count(*) INTO used
      FROM public.gastos
      WHERE user_id = _user_id
        AND (origem IS NULL OR origem = '')
        AND data >= date_trunc('month', now())::date;
    WHEN 'receitas' THEN
      cap := 10;
      SELECT count(*) INTO used
      FROM public.receitas
      WHERE user_id = _user_id
        AND (origem IS NULL OR origem = '')
        AND data >= date_trunc('month', now())::date;
    WHEN 'mercado_listas' THEN
      cap := 2;
      SELECT count(*) INTO used
      FROM public.mercado_listas
      WHERE user_id = _user_id
        AND coalesce(status, '') <> 'done';
    WHEN 'metas' THEN
      cap := 2;
      SELECT count(*) INTO used
      FROM public.metas_financeiras
      WHERE user_id = _user_id;
    WHEN 'cartoes' THEN
      cap := 1;
      SELECT count(*) INTO used
      FROM public.cartoes
      WHERE user_id = _user_id;
    WHEN 'orcamento' THEN
      cap := 1;
      SELECT count(*) INTO used
      FROM public.limites
      WHERE user_id = _user_id;
    ELSE
      RETURN; -- recurso desconhecido: não bloqueia
  END CASE;

  IF used >= cap THEN
    RAISE EXCEPTION 'free_ads_quota_exceeded:%', _resource
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.assert_free_ads_quota(uuid, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.assert_free_ads_quota(uuid, text) TO authenticated, service_role;

-- 4) Trigger functions (uma por recurso, recurso hardcoded -> sem SQL dinâmico)
CREATE OR REPLACE FUNCTION public.tg_free_ads_quota_gastos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.origem IS NULL OR NEW.origem = '' THEN
    PERFORM public.assert_free_ads_quota(NEW.user_id, 'gastos');
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_free_ads_quota_receitas()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.origem IS NULL OR NEW.origem = '' THEN
    PERFORM public.assert_free_ads_quota(NEW.user_id, 'receitas');
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_free_ads_quota_mercado_listas()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_free_ads_quota(NEW.user_id, 'mercado_listas');
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_free_ads_quota_metas()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_free_ads_quota(NEW.user_id, 'metas');
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_free_ads_quota_cartoes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_free_ads_quota(NEW.user_id, 'cartoes');
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_free_ads_quota_limites()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_free_ads_quota(NEW.user_id, 'orcamento');
  RETURN NEW;
END $$;

-- 5) Attach triggers (drop-if-exists para idempotência)
DROP TRIGGER IF EXISTS free_ads_quota_gastos          ON public.gastos;
DROP TRIGGER IF EXISTS free_ads_quota_receitas        ON public.receitas;
DROP TRIGGER IF EXISTS free_ads_quota_mercado_listas  ON public.mercado_listas;
DROP TRIGGER IF EXISTS free_ads_quota_metas           ON public.metas_financeiras;
DROP TRIGGER IF EXISTS free_ads_quota_cartoes         ON public.cartoes;
DROP TRIGGER IF EXISTS free_ads_quota_limites         ON public.limites;

CREATE TRIGGER free_ads_quota_gastos
  BEFORE INSERT ON public.gastos
  FOR EACH ROW EXECUTE FUNCTION public.tg_free_ads_quota_gastos();

CREATE TRIGGER free_ads_quota_receitas
  BEFORE INSERT ON public.receitas
  FOR EACH ROW EXECUTE FUNCTION public.tg_free_ads_quota_receitas();

CREATE TRIGGER free_ads_quota_mercado_listas
  BEFORE INSERT ON public.mercado_listas
  FOR EACH ROW EXECUTE FUNCTION public.tg_free_ads_quota_mercado_listas();

CREATE TRIGGER free_ads_quota_metas
  BEFORE INSERT ON public.metas_financeiras
  FOR EACH ROW EXECUTE FUNCTION public.tg_free_ads_quota_metas();

CREATE TRIGGER free_ads_quota_cartoes
  BEFORE INSERT ON public.cartoes
  FOR EACH ROW EXECUTE FUNCTION public.tg_free_ads_quota_cartoes();

CREATE TRIGGER free_ads_quota_limites
  BEFORE INSERT ON public.limites
  FOR EACH ROW EXECUTE FUNCTION public.tg_free_ads_quota_limites();
