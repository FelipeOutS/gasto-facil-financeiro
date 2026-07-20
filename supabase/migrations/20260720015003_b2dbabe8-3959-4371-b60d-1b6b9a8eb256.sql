DROP POLICY IF EXISTS "Authenticated users can read cnpj cache" ON public.cnpj_cache;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.cnpj_cache FROM authenticated, anon;
GRANT ALL ON public.cnpj_cache TO service_role;