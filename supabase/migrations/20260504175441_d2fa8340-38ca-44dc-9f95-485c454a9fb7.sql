-- 1. Add invoice_month column (YYYY-MM format) to gastos table
ALTER TABLE public.gastos
  ADD COLUMN IF NOT EXISTS invoice_month text;

-- 2. Index for fast querying by user + payment method + invoice month
CREATE INDEX IF NOT EXISTS idx_gastos_user_invoice_month
  ON public.gastos (user_id, forma_pagamento, invoice_month);

-- 3. Backfill: compute invoice_month for existing credit card expenses
--    Rule: if purchase day <= card closing day -> invoice month = same month
--          else -> invoice month = next month
--    Fallback when no card is linked: use the purchase month itself.
UPDATE public.gastos g
SET invoice_month = to_char(
  CASE
    WHEN c.dia_fechamento IS NOT NULL AND extract(day FROM g.data)::int > c.dia_fechamento
      THEN (date_trunc('month', g.data) + interval '1 month')::date
    ELSE date_trunc('month', g.data)::date
  END,
  'YYYY-MM'
)
FROM public.cartoes c
WHERE g.cartao_id = c.id
  AND g.forma_pagamento = 'credito'
  AND g.invoice_month IS NULL;

-- Fallback: credit expenses without a linked card
UPDATE public.gastos
SET invoice_month = to_char(data, 'YYYY-MM')
WHERE forma_pagamento = 'credito'
  AND invoice_month IS NULL;