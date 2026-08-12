ALTER TABLE public.contas_a_pagar
  ADD COLUMN IF NOT EXISTS recorrencia_intervalo integer,
  ADD COLUMN IF NOT EXISTS recorrencia_unidade text;

ALTER TABLE public.contas_a_pagar
  ADD CONSTRAINT contas_a_pagar_recorrencia_unidade_check
  CHECK (recorrencia_unidade IS NULL OR recorrencia_unidade IN ('dia','semana','mes','ano'));

ALTER TABLE public.contas_a_pagar
  ADD CONSTRAINT contas_a_pagar_recorrencia_intervalo_check
  CHECK (recorrencia_intervalo IS NULL OR recorrencia_intervalo >= 1);

UPDATE public.contas_a_pagar
SET recorrencia_intervalo = CASE frequencia_recorrencia
      WHEN 'quinzenal' THEN 2 ELSE 1 END,
    recorrencia_unidade = CASE frequencia_recorrencia
      WHEN 'semanal' THEN 'semana'
      WHEN 'quinzenal' THEN 'semana'
      WHEN 'anual' THEN 'ano'
      ELSE 'mes' END
WHERE recorrente IS TRUE AND recorrencia_unidade IS NULL;