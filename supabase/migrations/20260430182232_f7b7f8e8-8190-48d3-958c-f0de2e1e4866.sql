ALTER TABLE public.recorrencias
ADD COLUMN IF NOT EXISTS tipo_recorrencia TEXT NOT NULL DEFAULT 'assinatura';

CREATE INDEX IF NOT EXISTS idx_recorrencias_tipo
ON public.recorrencias(user_id, tipo_recorrencia);

UPDATE public.recorrencias
SET tipo_recorrencia = CASE
  WHEN lower(coalesce(nome, '')) ~ '(aluguel|condominio|condomínio|internet|seguro|celular|telefone|mensalidade|plano|academia|curso|faculdade|escola)'
    AND lower(coalesce(nome, '')) !~ '(spotify|netflix|meli|apple|disney|amazon prime|prime video|adobe|microsoft|google one|icloud|streaming|totalpass)'
  THEN 'recorrencia_fixa'
  ELSE 'assinatura'
END
WHERE tipo_recorrencia IS NULL OR tipo_recorrencia = 'assinatura';