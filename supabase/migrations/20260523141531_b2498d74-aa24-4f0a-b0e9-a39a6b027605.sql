-- Fix 1: tighten connected_accounts UPDATE policy so an invitee can only
-- accept/refuse a still-pending invitation and cannot overwrite an
-- already-claimed owner_user_id.
DROP POLICY IF EXISTS connected_accounts_update ON public.connected_accounts;

CREATE POLICY connected_accounts_update ON public.connected_accounts
FOR UPDATE
USING (
  auth.uid() = viewer_user_id
  OR auth.uid() = owner_user_id
  OR (
    lower(trim(invited_email)) = current_user_email()
    AND status = 'pending'::connected_account_status
    AND owner_user_id IS NULL
  )
)
WITH CHECK (
  auth.uid() = viewer_user_id
  OR auth.uid() = owner_user_id
  OR (
    lower(trim(invited_email)) = current_user_email()
    AND owner_user_id = auth.uid()
    AND status = ANY (ARRAY['accepted'::connected_account_status, 'refused'::connected_account_status])
  )
);

-- Fix 2: add INSERT/UPDATE/DELETE policies on vault_pin_settings, scoped
-- strictly to the row owner. Previously only SELECT was defined, so writes
-- were effectively blocked OR open depending on context — explicitly scope
-- them to auth.uid() = user_id.
CREATE POLICY vault_pin_insert_own ON public.vault_pin_settings
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY vault_pin_update_own ON public.vault_pin_settings
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY vault_pin_delete_own ON public.vault_pin_settings
FOR DELETE
USING (auth.uid() = user_id);