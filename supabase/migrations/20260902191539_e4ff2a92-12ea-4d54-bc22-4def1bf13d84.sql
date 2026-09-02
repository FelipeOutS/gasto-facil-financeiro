CREATE TABLE public.product_analytics_events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_name TEXT NOT NULL,
  route TEXT,
  prev_route TEXT,
  source TEXT,
  target TEXT,
  user_id UUID,
  session_id TEXT,
  platform TEXT,
  build_id TEXT,
  props JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX product_analytics_events_occurred_at_idx ON public.product_analytics_events (occurred_at DESC);
CREATE INDEX product_analytics_events_event_idx ON public.product_analytics_events (event_name, occurred_at DESC);
CREATE INDEX product_analytics_events_user_day_idx ON public.product_analytics_events (user_id, occurred_at DESC);

GRANT ALL ON public.product_analytics_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.product_analytics_events_id_seq TO service_role;

ALTER TABLE public.product_analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_analytics_events_service_role_only"
ON public.product_analytics_events FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE TABLE public.product_analytics_meta (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data_start_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);

GRANT ALL ON public.product_analytics_meta TO service_role;
ALTER TABLE public.product_analytics_meta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_analytics_meta_service_role_only"
ON public.product_analytics_meta FOR ALL TO service_role
USING (true) WITH CHECK (true);

INSERT INTO public.product_analytics_meta (id, notes)
VALUES (1, 'Fase 2 — inicio da coleta de analytics de produto (taxonomia nova, sem merge de historico do GTM)')
ON CONFLICT (id) DO NOTHING;