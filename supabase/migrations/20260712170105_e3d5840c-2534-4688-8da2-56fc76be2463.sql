-- WA-SEC-CA-01 — Hardening de UPDATE em public.connected_accounts
-- Corrige finding crítico "connected_accounts_self_escalation":
-- o viewer_user_id (criador do convite) podia alterar access_level do
-- próprio row para 'admin' antes/depois do aceite do owner, escalando
-- privilégios. A policy vulnerável usava apenas
--   WITH CHECK (auth.uid() = viewer_user_id)
-- sem restringir campos.
--
-- Estratégia de defesa em profundidade:
--  (1) Policies de UPDATE separadas por papel (owner, viewer, invitee).
--  (2) Trigger BEFORE UPDATE estendido para bloquear alteração de
--      campos privilegiados quando o caller é o viewer.
--  (3) Trigger existente continua bloqueando o invitee-by-email.

-- ------------------------------------------------------------------
-- (1) Reescreve a policy de UPDATE em três policies restritivas.
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS connected_accounts_update ON public.connected_accounts;

-- Owner: administra o próprio row (aceite já ocorreu; auth.uid() = owner_user_id).
CREATE POLICY connected_accounts_update_owner
ON public.connected_accounts
FOR UPDATE
TO authenticated
USING (auth.uid() = owner_user_id)
WITH CHECK (auth.uid() = owner_user_id);

-- Viewer (criador do convite): pode manter o row (nickname, remoção lógica)
-- mas o trigger abaixo bloqueia qualquer mudança em campos privilegiados
-- (access_level, owner_user_id, invited_email, viewer_user_id, status,
-- invite_token, invite_expires_at, accepted_at, refused_at).
CREATE POLICY connected_accounts_update_viewer
ON public.connected_accounts
FOR UPDATE
TO authenticated
USING (auth.uid() = viewer_user_id)
WITH CHECK (auth.uid() = viewer_user_id);

-- Invitee (identificado por e-mail): só pode transicionar pending -> accepted/refused,
-- assumindo owner_user_id = auth.uid(). Trigger bloqueia outras mutações.
CREATE POLICY connected_accounts_update_invitee
ON public.connected_accounts
FOR UPDATE
TO authenticated
USING (
  lower(trim(invited_email)) = public.current_user_email()
  AND status = 'pending'::public.connected_account_status
  AND owner_user_id IS NULL
)
WITH CHECK (
  lower(trim(invited_email)) = public.current_user_email()
  AND owner_user_id = auth.uid()
  AND status IN ('accepted'::public.connected_account_status, 'refused'::public.connected_account_status)
);

-- ------------------------------------------------------------------
-- (2) Estende o trigger de defesa em profundidade para cobrir o viewer.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.connected_accounts_prevent_invitee_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
BEGIN
  -- Owner do row: acesso total (é a única parte com direito de administrar).
  IF uid IS NOT NULL AND uid = OLD.owner_user_id THEN
    RETURN NEW;
  END IF;

  -- Viewer (criador do convite): campos privilegiados são imutáveis.
  -- Sem essa camada, viewer poderia escalar access_level para admin.
  IF uid IS NOT NULL AND uid = OLD.viewer_user_id THEN
    IF NEW.access_level IS DISTINCT FROM OLD.access_level THEN
      RAISE EXCEPTION 'Viewers cannot change access_level';
    END IF;
    IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
      RAISE EXCEPTION 'Viewers cannot change owner_user_id';
    END IF;
    IF NEW.invited_email IS DISTINCT FROM OLD.invited_email THEN
      RAISE EXCEPTION 'Viewers cannot change invited_email';
    END IF;
    IF NEW.viewer_user_id IS DISTINCT FROM OLD.viewer_user_id THEN
      RAISE EXCEPTION 'Viewers cannot change viewer_user_id';
    END IF;
    IF NEW.invite_token IS DISTINCT FROM OLD.invite_token THEN
      RAISE EXCEPTION 'Viewers cannot change invite_token';
    END IF;
    IF NEW.invite_expires_at IS DISTINCT FROM OLD.invite_expires_at THEN
      RAISE EXCEPTION 'Viewers cannot change invite_expires_at';
    END IF;
    IF NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
      RAISE EXCEPTION 'Viewers cannot change accepted_at';
    END IF;
    IF NEW.refused_at IS DISTINCT FROM OLD.refused_at THEN
      RAISE EXCEPTION 'Viewers cannot change refused_at';
    END IF;
    -- status: viewer só pode transicionar para 'removed' (revogação lógica local).
    -- Aceitar/recusar é papel exclusivo do invitee/owner.
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status <> 'removed'::public.connected_account_status THEN
        RAISE EXCEPTION 'Viewers can only set status to removed';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Demais callers: invitee-by-email. Regras existentes preservadas.
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

  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    IF OLD.owner_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Invitees cannot reassign owner_user_id';
    END IF;
    IF NEW.owner_user_id IS DISTINCT FROM uid THEN
      RAISE EXCEPTION 'Invitees can only set owner_user_id to themselves';
    END IF;
  END IF;

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
$function$;

COMMENT ON FUNCTION public.connected_accounts_prevent_invitee_escalation()
  IS 'WA-SEC-CA-01: bloqueia escalada de privilégios por viewer (criador do convite) e invitee-by-email. Campos privilegiados são imutáveis para não-owners.';