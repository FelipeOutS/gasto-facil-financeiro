
-- ============= user_integrations =============
CREATE TABLE public.user_integrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('mercado_pago')),
  provider_user_id TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected','disconnected','error','pending')),
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  scope TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX idx_user_integrations_user ON public.user_integrations(user_id);

ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;

-- Usuário só vê SUAS integrações, mas NUNCA expomos tokens via SELECT amplo:
-- usamos uma view segura para o frontend (sem tokens).
CREATE POLICY "users select own integrations"
  ON public.user_integrations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users insert own integrations"
  ON public.user_integrations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users update own integrations"
  ON public.user_integrations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "users delete own integrations"
  ON public.user_integrations FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_user_integrations_updated_at
  BEFORE UPDATE ON public.user_integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- View pública (somente leitura, sem tokens) para uso no frontend
CREATE OR REPLACE VIEW public.user_integrations_safe
WITH (security_invoker = true) AS
SELECT
  id, user_id, provider, provider_user_id, status,
  last_sync_at, last_error, expires_at, created_at, updated_at
FROM public.user_integrations;

-- ============= imported_transactions =============
CREATE TABLE public.imported_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  integration_id UUID REFERENCES public.user_integrations(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('mercado_pago')),
  provider_transaction_id TEXT NOT NULL,
  type TEXT,
  title TEXT,
  description TEXT,
  amount NUMERIC(14,2),
  currency TEXT DEFAULT 'BRL',
  payment_method TEXT,
  status TEXT,
  occurred_at TIMESTAMPTZ,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, provider_transaction_id)
);

CREATE INDEX idx_imported_transactions_user ON public.imported_transactions(user_id);
CREATE INDEX idx_imported_transactions_occurred ON public.imported_transactions(user_id, occurred_at DESC);

ALTER TABLE public.imported_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users select own imported tx"
  ON public.imported_transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users insert own imported tx"
  ON public.imported_transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users update own imported tx"
  ON public.imported_transactions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "users delete own imported tx"
  ON public.imported_transactions FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_imported_transactions_updated_at
  BEFORE UPDATE ON public.imported_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
