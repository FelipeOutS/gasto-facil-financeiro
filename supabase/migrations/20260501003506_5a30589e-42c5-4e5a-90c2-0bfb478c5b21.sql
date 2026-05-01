ALTER TABLE public.user_plans
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_until timestamptz;