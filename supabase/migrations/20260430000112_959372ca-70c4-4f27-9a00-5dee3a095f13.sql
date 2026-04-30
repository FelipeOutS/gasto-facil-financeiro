
-- 1) Enum de papéis
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('owner', 'admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Tabela user_roles
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3) Função has_role (SECURITY DEFINER, evita recursão RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

-- 4) Função utilitária is_owner
CREATE OR REPLACE FUNCTION public.is_owner(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'owner'
  );
$$;

-- 5) RLS policies
DROP POLICY IF EXISTS "user_roles_select_own_or_owner" ON public.user_roles;
CREATE POLICY "user_roles_select_own_or_owner"
ON public.user_roles FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'owner'));

DROP POLICY IF EXISTS "user_roles_insert_owner_only" ON public.user_roles;
CREATE POLICY "user_roles_insert_owner_only"
ON public.user_roles FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'owner'));

DROP POLICY IF EXISTS "user_roles_update_owner_only" ON public.user_roles;
CREATE POLICY "user_roles_update_owner_only"
ON public.user_roles FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'owner'));

DROP POLICY IF EXISTS "user_roles_delete_owner_only" ON public.user_roles;
CREATE POLICY "user_roles_delete_owner_only"
ON public.user_roles FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'owner'));

-- 6) Atribui owner ao Felipe (pelo e-mail) se já existir
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'owner'::public.app_role
FROM auth.users u
WHERE lower(u.email) IN (
  SELECT lower(email) FROM auth.users
  WHERE raw_user_meta_data->>'nome' ILIKE '%Felipe%Santos%Silva%'
     OR raw_user_meta_data->>'name' ILIKE '%Felipe%Santos%Silva%'
)
ON CONFLICT (user_id, role) DO NOTHING;

-- 7) Trigger: novos usuários recebem 'user' por padrão
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_role ON auth.users;
CREATE TRIGGER on_auth_user_created_role
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();
