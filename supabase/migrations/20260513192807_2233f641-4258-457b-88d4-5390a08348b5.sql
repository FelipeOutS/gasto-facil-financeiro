-- Prevent invitees (matching only by invited_email) from escalating privileges
-- via the connected_accounts UPDATE policy. Owner and viewer keep full control.

CREATE OR REPLACE FUNCTION public.connected_accounts_prevent_invitee_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  is_owner_or_viewer boolean;
BEGIN
  -- Owners and viewers (the parties that already control the row) are unrestricted.
  is_owner_or_viewer :=
    uid IS NOT NULL
    AND (uid = OLD.viewer_user_id OR uid = OLD.owner_user_id);

  IF is_owner_or_viewer THEN
    RETURN NEW;
  END IF;

  -- Anyone else reaching this trigger can only be the invitee matched by email.
  -- They may only change status (accept/refuse), the matching timestamps, and
  -- claim owner_user_id when transitioning from pending -> accepted.

  IF NEW.access_level IS DISTINCT FROM OLD.access_level THEN
    RAISE EXCEPTION 'Invitees cannot change access_level';
  END IF;
  IF NEW.invited_email IS DISTINCT FROM OLD.invited_email THEN
    RAISE EXCEPTION 'Invitees cannot change invited_email';
  END IF;
  IF NEW.viewer_user_id IS DISTINCT FROM OLD.viewer_user_id THEN
    RAISE EXCEPTION 'Invitees cannot change viewer_user_id';
  END IF;
  IF NEW.invite_token IS DISTINCT FROM OLD.invite_token THEN
    RAISE EXCEPTION 'Invitees cannot change invite_token';
  END IF;
  IF NEW.invite_expires_at IS DISTINCT FROM OLD.invite_expires_at THEN
    RAISE EXCEPTION 'Invitees cannot change invite_expires_at';
  END IF;

  -- owner_user_id may only go from NULL to the current invitee (acceptance).
  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    IF OLD.owner_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Invitees cannot reassign owner_user_id';
    END IF;
    IF NEW.owner_user_id IS DISTINCT FROM uid THEN
      RAISE EXCEPTION 'Invitees can only set owner_user_id to themselves';
    END IF;
  END IF;

  -- status may only move pending -> accepted/refused.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status <> 'pending' THEN
      RAISE EXCEPTION 'Invitees can only change status from pending';
    END IF;
    IF NEW.status NOT IN ('accepted', 'refused') THEN
      RAISE EXCEPTION 'Invitees can only set status to accepted or refused';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS connected_accounts_prevent_escalation
  ON public.connected_accounts;

CREATE TRIGGER connected_accounts_prevent_escalation
  BEFORE UPDATE ON public.connected_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.connected_accounts_prevent_invitee_escalation();