ALTER TABLE public.contas_a_pagar
  ADD COLUMN IF NOT EXISTS mes_referencia text;

UPDATE public.contas_a_pagar
SET mes_referencia = to_char(data_vencimento, 'YYYY-MM')
WHERE mes_referencia IS NULL;

CREATE INDEX IF NOT EXISTS idx_contas_a_pagar_mes_ref
  ON public.contas_a_pagar (user_id, mes_referencia);