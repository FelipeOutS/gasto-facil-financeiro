ALTER TABLE public.gastos
  ADD COLUMN IF NOT EXISTS horario text,
  ADD COLUMN IF NOT EXISTS origem text;