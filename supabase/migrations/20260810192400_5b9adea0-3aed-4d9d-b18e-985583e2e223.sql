REVOKE ALL ON public.client_load_errors FROM anon, authenticated;
REVOKE ALL ON public.csp_reports FROM anon, authenticated;
GRANT ALL ON public.client_load_errors TO service_role;
GRANT ALL ON public.csp_reports TO service_role;