-- Adiciona campos para detalhamento da semântica da taxa de juros

ALTER TABLE public.bens_financiamentos 
ADD COLUMN IF NOT EXISTS taxa_juros_periodicidade TEXT DEFAULT 'anual' CHECK (taxa_juros_periodicidade IN ('mensal', 'anual')),
ADD COLUMN IF NOT EXISTS taxa_juros_tipo TEXT DEFAULT 'nominal' CHECK (taxa_juros_tipo IN ('nominal', 'efetiva', 'nao_definido'));

-- Para financiamentos existentes, marcamos como 'nao_definido' para solicitar confirmação
-- Mas por compatibilidade, o motor continuará usando o comportamento atual se for 'nao_definido'.
UPDATE public.bens_financiamentos SET taxa_juros_tipo = 'nao_definido' WHERE taxa_juros_tipo IS NULL;

-- Grants
GRANT SELECT, INSERT, UPDATE ON public.bens_financiamentos TO authenticated;
