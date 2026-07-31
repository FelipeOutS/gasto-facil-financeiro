-- ============================================================
-- Prompt 4A — Separação sandbox × produção + checkout interno
-- Estrutural, neutra, retrocompatível. Nenhum UPDATE em linhas
-- históricas; nenhum trigger de billing é acionado.
-- ============================================================

-- 1) payment_checkout_sessions -------------------------------
CREATE TABLE IF NOT EXISTS public.payment_checkout_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  plan_key text NOT NULL,
  periodicity text NOT NULL,
  expected_amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'BRL',
  environment text NOT NULL,
  purchase_origin text NOT NULL DEFAULT 'mercado_pago_web',
  external_reference text NOT NULL,
  provider text NOT NULL DEFAULT 'mercado_pago',
  provider_preference_id text,
  provider_payment_id text,
  method text,
  status text NOT NULL DEFAULT 'created',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_checkout_sessions_env_chk
    CHECK (environment IN ('production','sandbox','legacy_unknown')),
  CONSTRAINT payment_checkout_sessions_origin_chk
    CHECK (purchase_origin IN ('mercado_pago_web','apple_app_store','google_play','manual','admin','trial','legacy_unknown')),
  CONSTRAINT payment_checkout_sessions_status_chk
    CHECK (status IN ('created','pending','approved','rejected','cancelled','expired','consumed')),
  CONSTRAINT payment_checkout_sessions_amount_chk
    CHECK (expected_amount_cents > 0 AND expected_amount_cents <= 10000000)
);

GRANT SELECT ON public.payment_checkout_sessions TO authenticated;
GRANT ALL ON public.payment_checkout_sessions TO service_role;

ALTER TABLE public.payment_checkout_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "checkout_sessions_select_own" ON public.payment_checkout_sessions;
CREATE POLICY "checkout_sessions_select_own"
  ON public.payment_checkout_sessions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS payment_checkout_sessions_extref_uidx
  ON public.payment_checkout_sessions (external_reference);
CREATE UNIQUE INDEX IF NOT EXISTS payment_checkout_sessions_pref_uidx
  ON public.payment_checkout_sessions (provider, provider_preference_id)
  WHERE provider_preference_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_checkout_sessions_ppid_uidx
  ON public.payment_checkout_sessions (provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_checkout_sessions_user_idx
  ON public.payment_checkout_sessions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_checkout_sessions_expires_idx
  ON public.payment_checkout_sessions (expires_at)
  WHERE status IN ('created','pending');

CREATE OR REPLACE FUNCTION public.tg_payment_checkout_sessions_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_checkout_sessions_touch ON public.payment_checkout_sessions;
CREATE TRIGGER trg_payment_checkout_sessions_touch
  BEFORE UPDATE ON public.payment_checkout_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_payment_checkout_sessions_touch();

-- 2) payment_events — colunas neutras ------------------------
ALTER TABLE public.payment_events
  ADD COLUMN IF NOT EXISTS environment text,
  ADD COLUMN IF NOT EXISTS purchase_origin text,
  ADD COLUMN IF NOT EXISTS event_id text,
  ADD COLUMN IF NOT EXISTS provider_payment_id text,
  ADD COLUMN IF NOT EXISTS checkout_session_id uuid REFERENCES public.payment_checkout_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plano_resolved text,
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_result text,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS payload_hash text,
  ADD COLUMN IF NOT EXISTS payload_sanitized jsonb,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE public.payment_events
  DROP CONSTRAINT IF EXISTS payment_events_env_chk;
ALTER TABLE public.payment_events
  ADD CONSTRAINT payment_events_env_chk
  CHECK (environment IS NULL OR environment IN ('production','sandbox','legacy_unknown'));

ALTER TABLE public.payment_events
  DROP CONSTRAINT IF EXISTS payment_events_origin_chk;
ALTER TABLE public.payment_events
  ADD CONSTRAINT payment_events_origin_chk
  CHECK (purchase_origin IS NULL OR purchase_origin IN ('mercado_pago_web','apple_app_store','google_play','manual','admin','trial','legacy_unknown'));

CREATE INDEX IF NOT EXISTS payment_events_env_idx ON public.payment_events (environment);
CREATE INDEX IF NOT EXISTS payment_events_checkout_idx ON public.payment_events (checkout_session_id);

-- Novos eventos exigem ambiente + origem válidos (linhas antigas intactas).
CREATE OR REPLACE FUNCTION public.tg_payment_events_require_env()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.environment IS NULL OR NEW.environment NOT IN ('production','sandbox','legacy_unknown') THEN
    RAISE EXCEPTION 'payment_events.environment obrigatorio e valido em novos eventos';
  END IF;
  IF NEW.purchase_origin IS NULL OR NEW.purchase_origin NOT IN
     ('mercado_pago_web','apple_app_store','google_play','manual','admin','trial','legacy_unknown') THEN
    RAISE EXCEPTION 'payment_events.purchase_origin obrigatorio e valido em novos eventos';
  END IF;
  IF NEW.received_at IS NULL THEN
    NEW.received_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_events_require_env ON public.payment_events;
CREATE TRIGGER trg_payment_events_require_env
  BEFORE INSERT ON public.payment_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_payment_events_require_env();

-- 3) subscription_payments — colunas neutras -----------------
ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS environment text,
  ADD COLUMN IF NOT EXISTS purchase_origin text,
  ADD COLUMN IF NOT EXISTS checkout_session_id uuid REFERENCES public.payment_checkout_sessions(id) ON DELETE SET NULL;

ALTER TABLE public.subscription_payments
  DROP CONSTRAINT IF EXISTS subscription_payments_env_chk;
ALTER TABLE public.subscription_payments
  ADD CONSTRAINT subscription_payments_env_chk
  CHECK (environment IS NULL OR environment IN ('production','sandbox','legacy_unknown'));

ALTER TABLE public.subscription_payments
  DROP CONSTRAINT IF EXISTS subscription_payments_origin_chk;
ALTER TABLE public.subscription_payments
  ADD CONSTRAINT subscription_payments_origin_chk
  CHECK (purchase_origin IS NULL OR purchase_origin IN ('mercado_pago_web','apple_app_store','google_play','manual','admin','trial','legacy_unknown'));

CREATE INDEX IF NOT EXISTS subscription_payments_checkout_idx
  ON public.subscription_payments (checkout_session_id);
CREATE INDEX IF NOT EXISTS subscription_payments_env_idx
  ON public.subscription_payments (environment);

COMMENT ON COLUMN public.payment_events.environment IS 'production | sandbox | legacy_unknown. NULL = legado (registros anteriores ao Prompt 4A).';
COMMENT ON COLUMN public.subscription_payments.environment IS 'production | sandbox | legacy_unknown. NULL = legado (8 pagamentos historicos preservados).';
COMMENT ON TABLE public.payment_checkout_sessions IS 'Intencao de checkout criada pelo servidor. Fonte da verdade para resolver usuario/plano/preco no webhook via external_reference opaca.';
