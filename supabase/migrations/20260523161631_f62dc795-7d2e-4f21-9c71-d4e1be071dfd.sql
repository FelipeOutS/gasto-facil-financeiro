
CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  route text NOT NULL,
  ip_address text,
  user_id uuid,
  user_agent text,
  method text,
  blocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_key ON public.rate_limit_events(key);
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_route ON public.rate_limit_events(route);
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_ip ON public.rate_limit_events(ip_address);
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_user ON public.rate_limit_events(user_id);
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_blocked ON public.rate_limit_events(blocked);
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_created_at ON public.rate_limit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_key_created ON public.rate_limit_events(key, created_at DESC);

ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rate_limit_events_admin_select"
  ON public.rate_limit_events
  FOR SELECT
  TO authenticated
  USING (public.is_full_access(auth.uid()));
