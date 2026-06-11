
-- Fix 1: Restrict connected_accounts UPDATE policy to authenticated role only
DROP POLICY IF EXISTS connected_accounts_update ON public.connected_accounts;
CREATE POLICY connected_accounts_update ON public.connected_accounts
  FOR UPDATE
  TO authenticated
  USING (
    (auth.uid() = viewer_user_id)
    OR (auth.uid() = owner_user_id)
    OR (
      (lower(TRIM(BOTH FROM invited_email)) = current_user_email())
      AND (status = 'pending'::connected_account_status)
      AND (owner_user_id IS NULL)
    )
  )
  WITH CHECK (
    (auth.uid() = viewer_user_id)
    OR (auth.uid() = owner_user_id)
    OR (
      (lower(TRIM(BOTH FROM invited_email)) = current_user_email())
      AND (owner_user_id = auth.uid())
      AND (status = ANY (ARRAY['accepted'::connected_account_status, 'refused'::connected_account_status]))
    )
  );

-- Fix 2: Revoke client read access to OAuth token columns on user_integrations.
-- Tokens must only be readable via service_role on the server.
REVOKE ALL ON public.user_integrations FROM anon, authenticated;
GRANT SELECT (id, user_id, provider, provider_user_id, expires_at, status, last_sync_at, last_error, scope, created_at, updated_at)
  ON public.user_integrations TO authenticated;
GRANT ALL ON public.user_integrations TO service_role;
