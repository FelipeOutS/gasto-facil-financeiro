
-- Função: sincroniza user_plans a partir de um pagamento aprovado
CREATE OR REPLACE FUNCTION public.sync_user_plan_from_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_months int;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  v_status := lower(coalesce(NEW.status, ''));
  IF v_status NOT IN ('approved', 'paid', 'authorized') THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS NULL OR NEW.plano IS NULL THEN
    RETURN NEW;
  END IF;

  v_months := COALESCE(NEW.months, 1);
  IF v_months <= 0 THEN v_months := 1; END IF;

  v_start := COALESCE(NEW.paid_at, now());
  v_end := v_start + (v_months || ' months')::interval;

  INSERT INTO public.user_plans (
    user_id, plano, status, periodicidade, months,
    current_period_start, current_period_end,
    last_payment_id, cancelled_at, access_until
  ) VALUES (
    NEW.user_id, NEW.plano, 'ativo', NEW.periodicidade, v_months,
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

-- Garante unique constraint em user_plans.user_id (necessário para ON CONFLICT)
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
AFTER INSERT OR UPDATE OF status, paid_at, plano, months, periodicidade
ON public.subscription_payments
FOR EACH ROW
EXECUTE FUNCTION public.sync_user_plan_from_payment();

-- Backfill: para cada usuário com pagamento aprovado, garante user_plans ativo
WITH last_paid AS (
  SELECT DISTINCT ON (user_id)
    user_id, plano, periodicidade, months, paid_at, created_at,
    provider_payment_id, id
  FROM public.subscription_payments
  WHERE lower(status) IN ('approved','paid','authorized')
    AND user_id IS NOT NULL AND plano IS NOT NULL
  ORDER BY user_id, COALESCE(paid_at, created_at) DESC
)
INSERT INTO public.user_plans (
  user_id, plano, status, periodicidade, months,
  current_period_start, current_period_end, last_payment_id
)
SELECT
  lp.user_id, lp.plano, 'ativo', lp.periodicidade,
  COALESCE(NULLIF(lp.months, 0), 1),
  COALESCE(lp.paid_at, lp.created_at),
  COALESCE(lp.paid_at, lp.created_at) + (COALESCE(NULLIF(lp.months,0),1) || ' months')::interval,
  COALESCE(lp.provider_payment_id, lp.id::text)
FROM last_paid lp
ON CONFLICT (user_id) DO UPDATE
SET plano = EXCLUDED.plano,
    status = CASE
      WHEN public.user_plans.status IN ('cancelado','expirado') AND public.user_plans.access_until IS NOT NULL
        THEN public.user_plans.status
      ELSE 'ativo'
    END,
    periodicidade = COALESCE(EXCLUDED.periodicidade, public.user_plans.periodicidade),
    months = EXCLUDED.months,
    current_period_start = COALESCE(public.user_plans.current_period_start, EXCLUDED.current_period_start),
    current_period_end = COALESCE(public.user_plans.current_period_end, EXCLUDED.current_period_end),
    last_payment_id = COALESCE(public.user_plans.last_payment_id, EXCLUDED.last_payment_id),
    updated_at = now()
WHERE public.user_plans.status <> 'ativo'
   OR public.user_plans.current_period_end IS NULL;
