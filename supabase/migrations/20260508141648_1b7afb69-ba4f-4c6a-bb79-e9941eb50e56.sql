ALTER TABLE public.dinheiro_guardado
  ADD COLUMN IF NOT EXISTS meta_id uuid;

CREATE INDEX IF NOT EXISTS dinheiro_guardado_meta_id_idx
  ON public.dinheiro_guardado (meta_id);