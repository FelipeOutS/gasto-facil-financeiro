-- Profiles: add WITH CHECK to prevent id reassignment on update
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles
FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Connected accounts: narrow WITH CHECK so invitees can only confirm themselves as owner
DROP POLICY IF EXISTS connected_accounts_update ON public.connected_accounts;
CREATE POLICY connected_accounts_update
ON public.connected_accounts
FOR UPDATE
USING (
  auth.uid() = viewer_user_id
  OR auth.uid() = owner_user_id
  OR lower(trim(invited_email)) = public.current_user_email()
)
WITH CHECK (
  auth.uid() = viewer_user_id
  OR auth.uid() = owner_user_id
  OR (
    lower(trim(invited_email)) = public.current_user_email()
    AND owner_user_id = auth.uid()
    AND status IN ('accepted'::connected_account_status, 'refused'::connected_account_status)
  )
);