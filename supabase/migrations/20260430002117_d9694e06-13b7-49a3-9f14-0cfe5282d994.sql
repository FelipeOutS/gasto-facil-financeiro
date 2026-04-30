-- 1) Função: e-mail está na allowlist de admin master?
CREATE OR REPLACE FUNCTION public.is_admin_email(_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(coalesce(_email, '')) IN (
    'felipe.out.silva@outlook.com',
    'michael@medeiroscenografia.com.br'
  );
$$;

-- 2) Função: usuário atual tem acesso total (owner OR e-mail na allowlist)?
CREATE OR REPLACE FUNCTION public.is_full_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_owner(_user_id)
    OR EXISTS (
      SELECT 1
      FROM auth.users u
      WHERE u.id = _user_id
        AND public.is_admin_email(u.email)
    );
$$;

-- 3) Atualiza claim_owner_if_first: e-mails na allowlist sempre se tornam owner
CREATE OR REPLACE FUNCTION public.claim_owner_if_first()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  uemail text;
  has_any_owner boolean;
  is_allowlisted boolean;
BEGIN
  IF uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT email INTO uemail FROM auth.users WHERE id = uid;
  is_allowlisted := public.is_admin_email(uemail);

  -- Allowlist: sempre garante role owner
  IF is_allowlisted THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (uid, 'owner')
    ON CONFLICT (user_id, role) DO NOTHING;
    RETURN true;
  END IF;

  -- Caso clássico: primeiro usuário vira owner
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'owner') INTO has_any_owner;
  IF has_any_owner THEN
    RETURN false;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (uid, 'owner')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN true;
END;
$$;

-- 4) current_plan: allowlist => admin_master
CREATE OR REPLACE FUNCTION public.current_plan(_user_id uuid)
RETURNS plan_tier
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.is_full_access(_user_id) THEN 'admin_master'::public.plan_tier
    ELSE COALESCE(
      (SELECT plano FROM public.user_plans WHERE user_id = _user_id),
      'free'::public.plan_tier
    )
  END;
$$;

-- 5) Promove imediatamente quem já existe e está na allowlist
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'owner'::public.app_role
FROM auth.users u
WHERE public.is_admin_email(u.email)
ON CONFLICT (user_id, role) DO NOTHING;