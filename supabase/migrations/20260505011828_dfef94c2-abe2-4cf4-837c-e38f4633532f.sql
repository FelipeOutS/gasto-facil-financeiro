CREATE OR REPLACE FUNCTION public.subscription_status_is_approved(_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(trim(coalesce(_status, ''))) IN ('approved', 'paid', 'authorized', 'aprovado', 'aprovada');
$$;

CREATE OR REPLACE FUNCTION public.subscription_status_is_failed(_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(trim(coalesce(_status, ''))) IN ('rejected', 'cancelled', 'canceled', 'refunded', 'charged_back', 'expired', 'recusado', 'recusada', 'cancelado', 'cancelada', 'vencido', 'vencida');
$$;

CREATE OR REPLACE FUNCTION public.subscription_payment_email(_payload jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(trim(coalesce(
    _payload #>> '{payer,email}',
    _payload #>> '{payer_email}',
    _payload #>> '{metadata,email}',
    _payload #>> '{metadata,user_email}',
    _payload #>> '{additional_info,payer,email}',
    ''
  )));
$$;

CREATE INDEX IF NOT EXISTS subscription_payments_payload_email_idx
  ON public.subscription_payments (public.subscription_payment_email(payload));

UPDATE public.subscription_payments sp
SET user_id = u.id,
    updated_at = now()
FROM auth.users u
WHERE public.subscription_status_is_approved(sp.status)
  AND public.subscription_payment_email(sp.payload) <> ''
  AND public.subscription_payment_email(sp.payload) = lower(trim(u.email))
  AND sp.user_id <> u.id;

CREATE OR REPLACE FUNCTION public.sync_user_plan_from_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_months int;
  v_start timestamptz;
  v_end timestamptz;
  v_user_id uuid;
  v_email text;
BEGIN
  IF NOT public.subscription_status_is_approved(NEW.status) THEN
    RETURN NEW;
  END IF;
  IF NEW.plano IS NULL THEN
    RETURN NEW;
  END IF;

  v_user_id := NEW.user_id;
  v_email := public.subscription_payment_email(NEW.payload);

  IF v_email <> '' THEN
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE lower(trim(email)) = v_email
    LIMIT 1;
  END IF;

  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM v_user_id THEN
    UPDATE public.subscription_payments
    SET user_id = v_user_id,
        updated_at = now()
    WHERE id = NEW.id;
  END IF;

  v_months := COALESCE(NEW.months, 1);
  IF v_months <= 0 THEN v_months := 1; END IF;

  v_start := COALESCE(NEW.paid_at, NEW.created_at, now());
  v_end := v_start + (v_months || ' months')::interval;

  IF v_start > now() OR v_end < now() THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_plans (
    user_id, plano, status, periodicidade, months,
    current_period_start, current_period_end,
    last_payment_id, cancelled_at, access_until
  ) VALUES (
    v_user_id, NEW.plano, 'ativo', NEW.periodicidade, v_months,
    v_start, v_end,
    COALESCE(NEW.provider_payment_id, NEW.id::text), NULL, NULL
  )
  ON CONFLICT (user_id) DO UPDATE
  SET plano = EXCLUDED.plano,
      status = 'ativo',
      periodicidade = EXCLUDED.periodicidade,
      months = EXCLUDED.months,
      current_period_start = EXCLUDED.current_period_start,
      current_period_end = EXCLUDED.current_period_end,
      last_payment_id = EXCLUDED.last_payment_id,
      cancelled_at = NULL,
      access_until = NULL,
      updated_at = now();

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_plans_user_id_key'
  ) THEN
    ALTER TABLE public.user_plans ADD CONSTRAINT user_plans_user_id_key UNIQUE (user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_sync_user_plan_from_payment ON public.subscription_payments;
CREATE TRIGGER trg_sync_user_plan_from_payment
AFTER INSERT OR UPDATE OF status, paid_at, plano, months, periodicidade, payload, user_id
ON public.subscription_payments
FOR EACH ROW
EXECUTE FUNCTION public.sync_user_plan_from_payment();

WITH paid AS (
  SELECT DISTINCT ON (sp.user_id)
    sp.user_id,
    sp.plano,
    sp.periodicidade,
    COALESCE(NULLIF(sp.months, 0), 1) AS months,
    COALESCE(sp.paid_at, sp.created_at) AS period_start,
    COALESCE(sp.provider_payment_id, sp.id::text) AS payment_ref
  FROM public.subscription_payments sp
  WHERE public.subscription_status_is_approved(sp.status)
    AND sp.user_id IS NOT NULL
    AND sp.plano IS NOT NULL
    AND COALESCE(sp.paid_at, sp.created_at) <= now()
    AND COALESCE(sp.paid_at, sp.created_at) + (COALESCE(NULLIF(sp.months,0),1) || ' months')::interval >= now()
  ORDER BY sp.user_id, COALESCE(sp.paid_at, sp.created_at) DESC
)
INSERT INTO public.user_plans (
  user_id, plano, status, periodicidade, months,
  current_period_start, current_period_end, last_payment_id,
  cancelled_at, access_until
)
SELECT
  paid.user_id,
  paid.plano,
  'ativo',
  paid.periodicidade,
  paid.months,
  paid.period_start,
  paid.period_start + (paid.months || ' months')::interval,
  paid.payment_ref,
  NULL,
  NULL
FROM paid
ON CONFLICT (user_id) DO UPDATE
SET plano = EXCLUDED.plano,
    status = 'ativo',
    periodicidade = EXCLUDED.periodicidade,
    months = EXCLUDED.months,
    current_period_start = EXCLUDED.current_period_start,
    current_period_end = EXCLUDED.current_period_end,
    last_payment_id = EXCLUDED.last_payment_id,
    cancelled_at = NULL,
    access_until = NULL,
    updated_at = now();