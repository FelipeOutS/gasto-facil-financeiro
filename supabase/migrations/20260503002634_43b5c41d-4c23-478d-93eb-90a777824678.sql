
ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS periodicidade text NOT NULL DEFAULT 'mensal',
  ADD COLUMN IF NOT EXISTS months smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS discount_percent numeric NOT NULL DEFAULT 0;

ALTER TABLE public.user_plans
  ADD COLUMN IF NOT EXISTS periodicidade text,
  ADD COLUMN IF NOT EXISTS months smallint;
