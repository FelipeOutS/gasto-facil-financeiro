
ALTER TABLE public.gastos
  ADD COLUMN fornecedor_id uuid NULL
  REFERENCES public.fornecedores(id) ON DELETE SET NULL;

CREATE INDEX gastos_fornecedor_id_idx ON public.gastos (fornecedor_id) WHERE fornecedor_id IS NOT NULL;

ALTER TABLE public.contas_a_pagar
  ADD COLUMN fornecedor_id uuid NULL
  REFERENCES public.fornecedores(id) ON DELETE SET NULL;

CREATE INDEX contas_a_pagar_fornecedor_id_idx ON public.contas_a_pagar (fornecedor_id) WHERE fornecedor_id IS NOT NULL;
