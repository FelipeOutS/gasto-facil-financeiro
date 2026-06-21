
-- 1) Tabela de acesso beta WhatsApp
CREATE TABLE IF NOT EXISTS public.whatsapp_beta_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  ativo boolean NOT NULL DEFAULT true,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  expires_at timestamptz,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.whatsapp_beta_access TO authenticated;
GRANT ALL ON public.whatsapp_beta_access TO service_role;

ALTER TABLE public.whatsapp_beta_access ENABLE ROW LEVEL SECURITY;

-- Usuário comum só vê o próprio status; nunca lista demais participantes.
CREATE POLICY "Users can view own beta status"
  ON public.whatsapp_beta_access
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Sem políticas de INSERT/UPDATE/DELETE: toda a escrita acontece via
-- service_role em server functions com checagem de Admin Master.

CREATE OR REPLACE FUNCTION public.tg_whatsapp_beta_access_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_whatsapp_beta_access_updated_at ON public.whatsapp_beta_access;
CREATE TRIGGER trg_whatsapp_beta_access_updated_at
  BEFORE UPDATE ON public.whatsapp_beta_access
  FOR EACH ROW EXECUTE FUNCTION public.tg_whatsapp_beta_access_updated_at();

-- 2) Função única de elegibilidade
CREATE OR REPLACE FUNCTION public.can_use_whatsapp(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.whatsapp_beta_access%ROWTYPE;
  now_ts timestamptz := now();
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  -- Admin Master sempre passa.
  IF public.is_full_access(_user_id) THEN
    RETURN true;
  END IF;

  SELECT * INTO r
  FROM public.whatsapp_beta_access
  WHERE user_id = _user_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF NOT r.ativo THEN
    RETURN false;
  END IF;

  IF r.revoked_at IS NOT NULL THEN
    RETURN false;
  END IF;

  IF r.expires_at IS NOT NULL AND r.expires_at <= now_ts THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.can_use_whatsapp(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_use_whatsapp(uuid) TO authenticated, service_role;

-- 3) Quota WhatsApp: contar lançamentos por origem='whatsapp' como gastos normais.
CREATE OR REPLACE FUNCTION public.assert_free_ads_quota(_user_id uuid, _resource text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  used int := 0;
  cap  int := 0;
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;
  IF public.current_plan(_user_id) <> 'free_ads'::public.plan_tier THEN
    RETURN;
  END IF;

  CASE _resource
    WHEN 'gastos' THEN
      cap := 30;
      SELECT count(*) INTO used
      FROM public.gastos
      WHERE user_id = _user_id
        AND (origem IS NULL OR origem = '' OR origem = 'whatsapp')
        AND data >= date_trunc('month', now())::date;
    WHEN 'receitas' THEN
      cap := 10;
      SELECT count(*) INTO used
      FROM public.receitas
      WHERE user_id = _user_id
        AND (origem IS NULL OR origem = '' OR origem = 'whatsapp')
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
      RETURN;
  END CASE;

  IF used >= cap THEN
    RAISE EXCEPTION 'free_ads_quota_exceeded:%', _resource
      USING ERRCODE = 'check_violation';
  END IF;
END;
$function$;

-- Trigger gastos: também aciona quota quando origem='whatsapp'.
CREATE OR REPLACE FUNCTION public.tg_free_ads_quota_gastos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.origem IS NULL OR NEW.origem = '' OR NEW.origem = 'whatsapp' THEN
    PERFORM public.assert_free_ads_quota(NEW.user_id, 'gastos');
  END IF;
  RETURN NEW;
END $function$;
