ALTER TABLE public.contas_a_pagar
  ADD COLUMN IF NOT EXISTS beneficiario text,
  ADD COLUMN IF NOT EXISTS forma_pagamento text,
  ADD COLUMN IF NOT EXISTS codigo_boleto text,
  ADD COLUMN IF NOT EXISTS codigo_pix text,
  ADD COLUMN IF NOT EXISTS chave_pix text,
  ADD COLUMN IF NOT EXISTS banco_emissor text,
  ADD COLUMN IF NOT EXISTS import_batch_id uuid;

CREATE INDEX IF NOT EXISTS idx_contas_user_codigo_boleto
  ON public.contas_a_pagar (user_id, codigo_boleto)
  WHERE codigo_boleto IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contas_user_codigo_pix
  ON public.contas_a_pagar (user_id, codigo_pix)
  WHERE codigo_pix IS NOT NULL;