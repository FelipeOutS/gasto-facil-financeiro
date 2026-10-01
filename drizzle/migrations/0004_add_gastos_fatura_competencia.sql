ALTER TABLE public.gastos ADD COLUMN IF NOT EXISTS fatura_competencia text NULL;
ALTER TABLE public.gastos ADD CONSTRAINT gastos_fatura_competencia_format
  CHECK (fatura_competencia IS NULL OR fatura_competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
CREATE INDEX IF NOT EXISTS idx_gastos_user_cartao_fatura_competencia
  ON public.gastos (user_id, cartao_id, fatura_competencia);
COMMENT ON COLUMN public.gastos.fatura_competencia IS 'Competência da fatura (YYYY-MM do mês de VENCIMENTO). NULL = registro legado: fatura derivada de invoice_month/data pelo ciclo antigo.';
COMMENT ON COLUMN public.gastos.invoice_month IS 'Mês de referência do gasto (quando comprei). Para registros com fatura_competencia NULL também é usado como ciclo legado da fatura.';