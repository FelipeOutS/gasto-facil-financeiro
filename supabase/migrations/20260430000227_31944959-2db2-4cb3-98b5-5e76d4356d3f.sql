
CREATE OR REPLACE FUNCTION public.claim_owner_if_first()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  has_any_owner boolean;
BEGIN
  IF uid IS NULL THEN
    RETURN false;
  END IF;

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

-- Permite execução apenas a usuários autenticados; revoga de anon
REVOKE EXECUTE ON FUNCTION public.claim_owner_if_first() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_owner_if_first() TO authenticated;
