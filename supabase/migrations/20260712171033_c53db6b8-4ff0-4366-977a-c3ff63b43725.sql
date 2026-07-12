-- WA-SEC-CA-01B — Defesa em profundidade: policy WITH CHECK bloqueia escalada antes do trigger.
-- Motivação: a policy connected_accounts_update_viewer usava apenas
-- (auth.uid() = viewer_user_id), delegando 100% da proteção ao trigger.
-- Requisito de defesa em profundidade: a RLS deve barrar primeiro; o trigger
-- é segunda camada. Introduz-se função booleana STABLE SECURITY DEFINER que
-- compara os valores propostos com a linha atual e recusa qualquer alteração
-- em campo sensível ou transição de status ilegítima.

-- 1) Função auxiliar de autorização (somente leitura, boolean).
CREATE OR REPLACE FUNCTION public.connected_accounts_viewer_update_allowed(
  p_row_id                 uuid,
  p_new_status             public.connected_account_status,
  p_new_access_level       public.connected_account_access,
  p_new_owner_user_id      uuid,
  p_new_viewer_user_id     uuid,
  p_new_invited_email      text,
  p_new_invite_token       text,
  p_new_invite_expires_at  timestamptz,
  p_new_accepted_at        timestamptz,
  p_new_refused_at         timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  r   public.connected_accounts%ROWTYPE;
  uid uuid := auth.uid();
BEGIN
  -- Bloqueia caller anônimo. auth.uid() é validado internamente — nunca
  -- confiar em parâmetros como prova de identidade.
  IF uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO r FROM public.connected_accounts WHERE id = p_row_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Autorização mínima: o caller PRECISA ser o viewer daquele registro.
  -- Sem isso a função poderia funcionar como oracle para descobrir dados.
  IF r.viewer_user_id IS DISTINCT FROM uid THEN
    RETURN false;
  END IF;

  -- Campos administrativos / de ownership: imutáveis pelo viewer.
  IF p_new_access_level      IS DISTINCT FROM r.access_level      THEN RETURN false; END IF;
  IF p_new_owner_user_id     IS DISTINCT FROM r.owner_user_id     THEN RETURN false; END IF;
  IF p_new_viewer_user_id    IS DISTINCT FROM r.viewer_user_id    THEN RETURN false; END IF;
  IF p_new_invited_email     IS DISTINCT FROM r.invited_email     THEN RETURN false; END IF;
  IF p_new_invite_token      IS DISTINCT FROM r.invite_token      THEN RETURN false; END IF;
  IF p_new_invite_expires_at IS DISTINCT FROM r.invite_expires_at THEN RETURN false; END IF;
  IF p_new_accepted_at       IS DISTINCT FROM r.accepted_at       THEN RETURN false; END IF;
  IF p_new_refused_at        IS DISTINCT FROM r.refused_at        THEN RETURN false; END IF;

  -- status: pass-through ou transição APENAS para 'removed'
  -- (revogação lógica local do próprio viewer). Aceitar/recusar é do invitee.
  IF p_new_status IS DISTINCT FROM r.status THEN
    IF p_new_status <> 'removed'::public.connected_account_status THEN
      RETURN false;
    END IF;
  END IF;

  -- Campos livres: nickname, removed_at, removed_by_user_id.
  RETURN true;
END;
$$;

-- 2) ACL da função: PUBLIC/anon sem EXECUTE; authenticated pode executar
-- (a policy chama a função em nome do usuário). service_role sempre.
REVOKE ALL ON FUNCTION public.connected_accounts_viewer_update_allowed(
  uuid, public.connected_account_status, public.connected_account_access,
  uuid, uuid, text, text, timestamptz, timestamptz, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.connected_accounts_viewer_update_allowed(
  uuid, public.connected_account_status, public.connected_account_access,
  uuid, uuid, text, text, timestamptz, timestamptz, timestamptz
) FROM anon;
GRANT EXECUTE ON FUNCTION public.connected_accounts_viewer_update_allowed(
  uuid, public.connected_account_status, public.connected_account_access,
  uuid, uuid, text, text, timestamptz, timestamptz, timestamptz
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.connected_accounts_viewer_update_allowed(
  uuid, public.connected_account_status, public.connected_account_access,
  uuid, uuid, text, text, timestamptz, timestamptz, timestamptz
) TO service_role;

-- 3) Substitui a policy vulnerável (apenas a do viewer). Owner/invitee/select
-- permanecem intactos; trigger `connected_accounts_prevent_invitee_escalation`
-- permanece como defesa em profundidade.
DROP POLICY IF EXISTS connected_accounts_update_viewer ON public.connected_accounts;

CREATE POLICY connected_accounts_update_viewer
ON public.connected_accounts
FOR UPDATE
TO authenticated
USING (
  auth.uid() = viewer_user_id
)
WITH CHECK (
  auth.uid() = viewer_user_id
  AND public.connected_accounts_viewer_update_allowed(
    id,
    status,
    access_level,
    owner_user_id,
    viewer_user_id,
    invited_email,
    invite_token,
    invite_expires_at,
    accepted_at,
    refused_at
  )
);

COMMENT ON FUNCTION public.connected_accounts_viewer_update_allowed(
  uuid, public.connected_account_status, public.connected_account_access,
  uuid, uuid, text, text, timestamptz, timestamptz, timestamptz
) IS
  'WA-SEC-CA-01B — Autoriza UPDATE do viewer em connected_accounts. Bloqueia '
  'alteração de campos administrativos e transições de status ilegítimas '
  'diretamente na policy (WITH CHECK). Trigger '
  'connected_accounts_prevent_invitee_escalation permanece como segunda camada.';