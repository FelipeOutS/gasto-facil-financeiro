GRANT EXECUTE ON FUNCTION public.is_full_access(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_owner(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon;