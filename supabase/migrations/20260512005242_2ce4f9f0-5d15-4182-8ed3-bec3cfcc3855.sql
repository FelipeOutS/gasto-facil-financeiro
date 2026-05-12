CREATE TABLE IF NOT EXISTS public.economic_indicators (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  indicator_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  value NUMERIC(18, 6) NOT NULL,
  currency TEXT,
  source TEXT NOT NULL DEFAULT 'awesomeapi',
  variation_percent NUMERIC(10, 4),
  high NUMERIC(18, 6),
  low NUMERIC(18, 6),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_economic_indicators_key ON public.economic_indicators(indicator_key);
CREATE INDEX IF NOT EXISTS idx_economic_indicators_fetched_at ON public.economic_indicators(fetched_at DESC);

ALTER TABLE public.economic_indicators ENABLE ROW LEVEL SECURITY;

-- Leitura pública para todos os usuários autenticados (dados de mercado, sem PII)
CREATE POLICY "Indicadores econômicos são visíveis a usuários autenticados"
ON public.economic_indicators
FOR SELECT
TO authenticated
USING (true);

-- Escrita apenas via service role (server-side). Nenhuma policy de INSERT/UPDATE/DELETE
-- para usuários autenticados — supabaseAdmin (service role) bypassa RLS.

CREATE TRIGGER trg_economic_indicators_updated_at
BEFORE UPDATE ON public.economic_indicators
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();