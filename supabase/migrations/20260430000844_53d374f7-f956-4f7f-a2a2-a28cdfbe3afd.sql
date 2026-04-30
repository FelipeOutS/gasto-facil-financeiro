
-- 1) Enums
DO $$ BEGIN
  CREATE TYPE public.plan_tier AS ENUM ('free','pessoal','mei','empresa','admin_master');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.subscription_status AS ENUM ('ativo','teste','expirado','cancelado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Tabela user_plans
CREATE TABLE IF NOT EXISTS public.user_plans (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plano public.plan_tier NOT NULL DEFAULT 'free',
  status public.subscription_status NOT NULL DEFAULT 'ativo',
  trial_ends_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_plans_select_own_or_owner" ON public.user_plans;
CREATE POLICY "user_plans_select_own_or_owner"
ON public.user_plans FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'owner'));

DROP POLICY IF EXISTS "user_plans_insert_owner_only" ON public.user_plans;
CREATE POLICY "user_plans_insert_owner_only"
ON public.user_plans FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'owner'));

DROP POLICY IF EXISTS "user_plans_update_owner_only" ON public.user_plans;
CREATE POLICY "user_plans_update_owner_only"
ON public.user_plans FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'owner'));

DROP POLICY IF EXISTS "user_plans_delete_owner_only" ON public.user_plans;
CREATE POLICY "user_plans_delete_owner_only"
ON public.user_plans FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'owner'));

-- updated_at trigger
DROP TRIGGER IF EXISTS user_plans_set_updated_at ON public.user_plans;
CREATE TRIGGER user_plans_set_updated_at
BEFORE UPDATE ON public.user_plans
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) Função current_plan: owner -> admin_master sempre
CREATE OR REPLACE FUNCTION public.current_plan(_user_id uuid)
RETURNS public.plan_tier
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.has_role(_user_id, 'owner') THEN 'admin_master'::public.plan_tier
    ELSE COALESCE(
      (SELECT plano FROM public.user_plans WHERE user_id = _user_id),
      'free'::public.plan_tier
    )
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.current_plan(uuid) FROM public, anon, authenticated;

-- 4) Trigger: novo usuário ganha plano free ativo
CREATE OR REPLACE FUNCTION public.handle_new_user_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_plans (user_id, plano, status)
  VALUES (NEW.id, 'free', 'ativo')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user_plan() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created_plan ON auth.users;
CREATE TRIGGER on_auth_user_created_plan
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_plan();

-- 5) Backfill: cria registro 'free/ativo' para usuários antigos que não têm plano
INSERT INTO public.user_plans (user_id, plano, status)
SELECT p.id, 'free', 'ativo'
FROM public.profiles p
LEFT JOIN public.user_plans up ON up.user_id = p.id
WHERE up.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;
