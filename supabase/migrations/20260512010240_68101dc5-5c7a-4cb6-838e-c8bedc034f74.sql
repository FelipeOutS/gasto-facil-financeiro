ALTER TABLE public.recorrencias
  ADD COLUMN IF NOT EXISTS moeda text NOT NULL DEFAULT 'BRL',
  ADD COLUMN IF NOT EXISTS valor_original numeric;