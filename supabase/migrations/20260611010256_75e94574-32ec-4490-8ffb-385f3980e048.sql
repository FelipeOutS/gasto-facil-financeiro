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