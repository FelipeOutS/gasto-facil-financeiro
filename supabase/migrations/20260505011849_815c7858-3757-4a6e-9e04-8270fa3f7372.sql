REVOKE ALL ON FUNCTION public.sync_user_plan_from_payment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_user_plan_from_payment() FROM anon;
REVOKE ALL ON FUNCTION public.sync_user_plan_from_payment() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_user_plan_from_payment() TO service_role;