
-- Tighten SELECT policy: invitees no longer read raw row (which leaks invite_token).
-- They go through SECURITY DEFINER RPCs that omit invite_token.
DROP POLICY IF EXISTS connected_accounts_select ON public.connected_accounts;

CREATE POLICY connected_accounts_select ON public.connected_accounts
FOR SELECT TO authenticated
USING (auth.uid() = viewer_user_id OR auth.uid() = owner_user_id);

-- RPC: list pending/active invites addressed to current user's email, WITHOUT invite_token
CREATE OR REPLACE FUNCTION public.list_my_pending_invites()
RETURNS TABLE (
  id uuid,
  viewer_user_id uuid,
  invited_email text,
  owner_user_id uuid,
  nickname text,
  access_level public.connected_account_access,
  status public.connected_account_status,
  invite_sent_at timestamptz,
  invite_expires_at timestamptz,
  accepted_at timestamptz,
  refused_at timestamptz,
  removed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ca.id, ca.viewer_user_id, ca.invited_email, ca.owner_user_id, ca.nickname,
         ca.access_level, ca.status, ca.invite_sent_at, ca.invite_expires_at,
         ca.accepted_at, ca.refused_at, ca.removed_at
  FROM public.connected_accounts ca
  WHERE lower(trim(ca.invited_email)) = public.current_user_email()
    AND ca.status <> 'removed'::public.connected_account_status;
$$;

GRANT EXECUTE ON FUNCTION public.list_my_pending_invites() TO authenticated;

-- RPC: fetch a single invite by its token (URL flow), WITHOUT returning the token itself
CREATE OR REPLACE FUNCTION public.fetch_invite_by_token(_token text)
RETURNS TABLE (
  id uuid,
  viewer_user_id uuid,
  invited_email text,
  owner_user_id uuid,
  nickname text,
  access_level public.connected_account_access,
  status public.connected_account_status,
  invite_sent_at timestamptz,
  invite_expires_at timestamptz,
  accepted_at timestamptz,
  refused_at timestamptz,
  removed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ca.id, ca.viewer_user_id, ca.invited_email, ca.owner_user_id, ca.nickname,
         ca.access_level, ca.status, ca.invite_sent_at, ca.invite_expires_at,
         ca.accepted_at, ca.refused_at, ca.removed_at
  FROM public.connected_accounts ca
  WHERE ca.invite_token = _token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_invite_by_token(text) TO anon, authenticated;
