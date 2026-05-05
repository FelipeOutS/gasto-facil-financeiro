-- 1) Corrigir o pagamento aprovado da Andrea (cartão) e ativar plano dela.
-- Atualiza o registro de cartão pendente com o paymentId real aprovado no MP.
UPDATE public.subscription_payments
SET status = 'approved',
    paid_at = COALESCE(paid_at, now()),
    provider_payment_id = '157751310068',
    payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
      'reconciled_by', 'manual_admin_fix',
      'mp_payment_id', '157751310068',
      'mp_order_id', 40547558967,
      'mp_status', 'approved'
    ),
    updated_at = now()
WHERE id = '44c8e0da-329e-4286-9f30-c9a60feaf883'
  AND status <> 'approved';

-- Garantir plano ativo (o trigger sync_user_plan_from_payment cobre isso, mas reforçamos):
INSERT INTO public.user_plans (
  user_id, plano, status, periodicidade, months,
  current_period_start, current_period_end,
  last_payment_id, cancelled_at, access_until
)
SELECT user_id, plano, 'ativo', periodicidade, COALESCE(months,3),
       COALESCE(paid_at, created_at),
       COALESCE(paid_at, created_at) + (COALESCE(months,3) || ' months')::interval,
       provider_payment_id, NULL, NULL
FROM public.subscription_payments
WHERE id = '44c8e0da-329e-4286-9f30-c9a60feaf883'
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