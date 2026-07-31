-- Prompt 2 (continuação) — Contadores de quota devem ignorar receitas em soft delete.
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
        AND deleted_at IS NULL
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

CREATE OR REPLACE FUNCTION public.tg_free_ads_quota_receitas()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  used int := 0;
  month_start date;
  month_end date;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.origem IS NOT NULL AND NEW.origem <> '' THEN
    RETURN NEW;
  END IF;

  IF public.current_plan(NEW.user_id) <> 'free_ads'::public.plan_tier THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.recorrente, false) THEN
    RAISE EXCEPTION 'premium_required:receitas_recorrentes'
      USING ERRCODE = 'check_violation';
  END IF;

  month_start := date_trunc('month', NEW.data)::date;
  month_end := (month_start + interval '1 month')::date;

  SELECT count(*) INTO used
  FROM public.receitas
  WHERE user_id = NEW.user_id
    AND deleted_at IS NULL
    AND (origem IS NULL OR origem = '')
    AND data >= month_start
    AND data < month_end;

  IF used >= 10 THEN
    RAISE EXCEPTION 'free_ads_quota_exceeded:receitas'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;