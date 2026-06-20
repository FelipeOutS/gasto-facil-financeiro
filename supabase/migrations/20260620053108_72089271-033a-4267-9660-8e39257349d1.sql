-- Defense in depth: remove column-level read access to OAuth tokens
-- for any client-side role. Server-side admin (service_role) is unaffected
-- and continues to use tokens for OAuth refresh, sync, and provider calls.

REVOKE SELECT (access_token, refresh_token)
  ON public.user_integrations
  FROM authenticated;

REVOKE SELECT (access_token, refresh_token)
  ON public.user_integrations
  FROM anon;

-- Also revoke UPDATE on token columns: token rotation must go through
-- the server (service_role), not the client SDK.
REVOKE UPDATE (access_token, refresh_token)
  ON public.user_integrations
  FROM authenticated;

REVOKE UPDATE (access_token, refresh_token)
  ON public.user_integrations
  FROM anon;

-- Keep existing RLS policies (row-level "own integrations only") intact.
-- The user_integrations_safe view already has security_invoker=true,
-- so RLS continues to scope rows to auth.uid(), and the view does not
-- reference access_token / refresh_token, so it works without those grants.