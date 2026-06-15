CREATE OR REPLACE FUNCTION public.handle_new_user_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin_email(NEW.email) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_plans (
    user_id,
    plano,
    status,
    current_period_start,
    current_period_end
  )
  VALUES (
    NEW.id,
    'free_ads'::public.plan_tier,
    'ativo'::public.subscription_status,
    now(),
    NULL
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user_plan() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user_plan() TO service_role;