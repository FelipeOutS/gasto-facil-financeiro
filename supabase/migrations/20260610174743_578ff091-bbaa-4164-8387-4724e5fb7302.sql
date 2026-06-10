CREATE OR REPLACE FUNCTION public.is_free_ads(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_plans
    WHERE user_id = _user_id
      AND plano = 'free_ads'::public.plan_tier
      AND status = 'ativo'::public.subscription_status
  );
$$;

REVOKE ALL ON FUNCTION public.is_free_ads(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_free_ads(uuid) TO authenticated, service_role;