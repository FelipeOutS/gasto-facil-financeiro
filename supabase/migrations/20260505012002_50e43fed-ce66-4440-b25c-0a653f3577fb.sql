REVOKE ALL ON FUNCTION public.is_full_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_full_access(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_full_access(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_full_access(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.claim_owner_if_first() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_owner_if_first() FROM anon;
REVOKE ALL ON FUNCTION public.claim_owner_if_first() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_owner_if_first() TO service_role;