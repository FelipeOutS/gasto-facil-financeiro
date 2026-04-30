-- Vincular ativos, movimentações e rendimentos a uma importação
ALTER TABLE public.investimentos_ativos
  ADD COLUMN IF NOT EXISTS importacao_id uuid;

ALTER TABLE public.investimentos_movimentacoes
  ADD COLUMN IF NOT EXISTS importacao_id uuid;

ALTER TABLE public.investimentos_rendimentos
  ADD COLUMN IF NOT EXISTS importacao_id uuid;

CREATE INDEX IF NOT EXISTS idx_inv_ativos_importacao ON public.investimentos_ativos(importacao_id);
CREATE INDEX IF NOT EXISTS idx_inv_movs_importacao ON public.investimentos_movimentacoes(importacao_id);
CREATE INDEX IF NOT EXISTS idx_inv_rends_importacao ON public.investimentos_rendimentos(importacao_id);

-- Guardar contagem/resumo por importação
ALTER TABLE public.investimentos_importacoes
  ADD COLUMN IF NOT EXISTS resumo jsonb DEFAULT '{}'::jsonb;
