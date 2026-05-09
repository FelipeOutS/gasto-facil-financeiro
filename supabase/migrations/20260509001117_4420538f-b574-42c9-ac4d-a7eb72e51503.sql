-- Enums
DO $$ BEGIN
  CREATE TYPE public.connected_account_status AS ENUM ('pending', 'accepted', 'refused', 'removed', 'expired');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.connected_account_access AS ENUM ('view', 'view_create', 'admin');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Tabela
CREATE TABLE IF NOT EXISTS public.connected_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Quem ENVIOU o convite e visualizará a outra conta
  viewer_user_id uuid NOT NULL,
  -- E-mail da pessoa convidada (dona dos dados a serem visualizados)
  invited_email text NOT NULL,
  -- Preenchido quando o convite é aceito (dono dos dados)
  owner_user_id uuid,
  nickname text,
  access_level public.connected_account_access NOT NULL DEFAULT 'view',
  status public.connected_account_status NOT NULL DEFAULT 'pending',
  invite_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  invite_sent_at timestamptz NOT NULL DEFAULT now(),
  invite_expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  accepted_at timestamptz,
  refused_at timestamptz,
  removed_at timestamptz,
  removed_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_connected_accounts_viewer ON public.connected_accounts(viewer_user_id);
CREATE INDEX IF NOT EXISTS idx_connected_accounts_owner ON public.connected_accounts(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_connected_accounts_email ON public.connected_accounts(lower(invited_email));
CREATE INDEX IF NOT EXISTS idx_connected_accounts_token ON public.connected_accounts(invite_token);

-- updated_at trigger
DROP TRIGGER IF EXISTS connected_accounts_set_updated_at ON public.connected_accounts;
CREATE TRIGGER connected_accounts_set_updated_at
  BEFORE UPDATE ON public.connected_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.connected_accounts ENABLE ROW LEVEL SECURITY;

-- Helper: e-mail (lowercase) do usuário autenticado
CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT lower(trim(email)) FROM auth.users WHERE id = auth.uid();
$$;

-- SELECT: viewer (quem convidou) OU dono (quem foi convidado, identificado por user_id ou e-mail)
CREATE POLICY "connected_accounts_select"
ON public.connected_accounts FOR SELECT
TO authenticated
USING (
  auth.uid() = viewer_user_id
  OR auth.uid() = owner_user_id
  OR lower(trim(invited_email)) = public.current_user_email()
);

-- INSERT: somente o próprio viewer pode criar convites em seu nome
CREATE POLICY "connected_accounts_insert"
ON public.connected_accounts FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = viewer_user_id
  AND owner_user_id IS NULL
  AND status = 'pending'
);

-- UPDATE:
-- - viewer pode atualizar nickname/access_level/status (cancelar/remover) do próprio convite
-- - convidado pode aceitar/recusar (mudar status) o convite endereçado a ele
-- - dono já aceito pode remover a conexão
CREATE POLICY "connected_accounts_update"
ON public.connected_accounts FOR UPDATE
TO authenticated
USING (
  auth.uid() = viewer_user_id
  OR auth.uid() = owner_user_id
  OR lower(trim(invited_email)) = public.current_user_email()
)
WITH CHECK (
  auth.uid() = viewer_user_id
  OR auth.uid() = owner_user_id
  OR lower(trim(invited_email)) = public.current_user_email()
);

-- DELETE: viewer ou dono podem deletar
CREATE POLICY "connected_accounts_delete"
ON public.connected_accounts FOR DELETE
TO authenticated
USING (
  auth.uid() = viewer_user_id
  OR auth.uid() = owner_user_id
);
