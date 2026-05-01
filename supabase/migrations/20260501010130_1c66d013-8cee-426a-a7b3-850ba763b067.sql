
CREATE TABLE IF NOT EXISTS public.user_onboarding (
  user_id uuid PRIMARY KEY,
  account_type text,
  goals text[] NOT NULL DEFAULT '{}',
  enabled_modules text[] NOT NULL DEFAULT '{}',
  recommended_plan text,
  onboarding_completed boolean NOT NULL DEFAULT false,
  onboarding_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_onboarding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_onboarding_select_own" ON public.user_onboarding
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "user_onboarding_insert_own" ON public.user_onboarding
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_onboarding_update_own" ON public.user_onboarding
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "user_onboarding_delete_own" ON public.user_onboarding
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER user_onboarding_set_updated_at
  BEFORE UPDATE ON public.user_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
