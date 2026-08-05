-- WA-SEC: has_role/is_owner são funções SECURITY DEFINER de checagem de papel.
-- Expostas ao papel anônimo pela Data API, permitem sondar (probe) se um
-- determinado usuário é admin/owner sem qualquer autenticação. Nenhuma policy
-- aplicada a anon/public referencia essas funções, portanto revogar a execução
-- do papel anônimo não afeta leituras públicas.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_owner(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_owner(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_owner(uuid) TO authenticated, service_role;