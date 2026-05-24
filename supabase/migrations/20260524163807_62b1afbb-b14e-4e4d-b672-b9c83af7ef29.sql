
-- Sprint 3 Etapa 2: current_plan() seguro contra vencimento/cancelamento
CREATE OR REPLACE FUNCTION public.current_plan(_user_id uuid)
RETURNS plan_tier
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.user_plans%ROWTYPE;
  now_ts timestamptz := now();
BEGIN
  -- Admin Master / full access bypass
  IF public.is_full_access(_user_id) THEN
    RETURN 'admin_master'::public.plan_tier;
  END IF;

  SELECT * INTO r FROM public.user_plans WHERE user_id = _user_id;
  IF NOT FOUND THEN
    RETURN 'free'::public.plan_tier;
  END IF;

  -- Trial ativo (dentro do período)
  IF r.status = 'teste'::subscription_status
     AND r.trial_ends_at IS NOT NULL
     AND r.trial_ends_at > now_ts THEN
    RETURN COALESCE(r.plano, 'free'::public.plan_tier);
  END IF;

  -- Cancelado com acesso vigente até access_until
  IF r.status = 'cancelado'::subscription_status
     AND r.access_until IS NOT NULL
     AND r.access_until > now_ts THEN
    RETURN COALESCE(r.plano, 'free'::public.plan_tier);
  END IF;

  -- Plano ativo dentro do período pago
  IF r.status = 'ativo'::subscription_status
     AND (r.current_period_end IS NULL OR r.current_period_end > now_ts) THEN
    RETURN COALESCE(r.plano, 'free'::public.plan_tier);
  END IF;

  -- Qualquer outro caso (expirado, aguardando_pagamento, cancelado vencido,
  -- trial vencido, ativo com período vencido) => sem assinatura.
  RETURN 'sem_assinatura'::public.plan_tier;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.current_plan(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.current_plan(uuid) TO authenticated, service_role;

-- Helper boolean para gates futuros
CREATE OR REPLACE FUNCTION public.has_active_plan_access(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.user_plans%ROWTYPE;
  now_ts timestamptz := now();
BEGIN
  IF public.is_full_access(_user_id) THEN
    RETURN true;
  END IF;

  SELECT * INTO r FROM public.user_plans WHERE user_id = _user_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF r.plano IS NULL OR r.plano = 'free'::plan_tier OR r.plano = 'sem_assinatura'::plan_tier THEN
    RETURN false;
  END IF;

  IF r.status = 'teste'::subscription_status
     AND r.trial_ends_at IS NOT NULL
     AND r.trial_ends_at > now_ts THEN
    RETURN true;
  END IF;

  IF r.status = 'cancelado'::subscription_status
     AND r.access_until IS NOT NULL
     AND r.access_until > now_ts THEN
    RETURN true;
  END IF;

  IF r.status = 'ativo'::subscription_status
     AND (r.current_period_end IS NULL OR r.current_period_end > now_ts) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.has_active_plan_access(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.has_active_plan_access(uuid) TO authenticated, service_role;
