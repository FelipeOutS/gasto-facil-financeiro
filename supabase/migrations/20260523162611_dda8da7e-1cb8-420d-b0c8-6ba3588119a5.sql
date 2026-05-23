
CREATE TABLE IF NOT EXISTS public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'mercado_pago',
  external_payment_id text NOT NULL,
  event_type text,
  status text NOT NULL,
  raw_status text,
  user_id uuid,
  subscription_id uuid,
  payment_id uuid,
  metadata jsonb,
  processed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_events_unique
  ON public.payment_events(provider, external_payment_id, COALESCE(event_type, ''));

CREATE INDEX IF NOT EXISTS idx_payment_events_user ON public.payment_events(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_status ON public.payment_events(status);
CREATE INDEX IF NOT EXISTS idx_payment_events_created_at ON public.payment_events(created_at DESC);

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_events_admin_select"
  ON public.payment_events
  FOR SELECT
  TO authenticated
  USING (public.is_full_access(auth.uid()));
