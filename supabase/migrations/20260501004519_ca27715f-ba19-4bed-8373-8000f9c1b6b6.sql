ALTER TABLE public.user_plans
  ADD COLUMN IF NOT EXISTS current_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS current_period_end   timestamptz,
  ADD COLUMN IF NOT EXISTS last_payment_id      text;

CREATE INDEX IF NOT EXISTS idx_user_plans_current_period_end
  ON public.user_plans (current_period_end);
