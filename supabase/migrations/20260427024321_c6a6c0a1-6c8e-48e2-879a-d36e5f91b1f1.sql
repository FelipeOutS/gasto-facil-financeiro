-- Tabela de contas a pagar
CREATE TABLE public.contas_a_pagar (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  nome text NOT NULL,
  valor numeric NOT NULL DEFAULT 0,
  data_vencimento date NOT NULL,
  categoria_id uuid REFERENCES public.categorias(id) ON DELETE SET NULL,
  observacao text,
  recorrente boolean NOT NULL DEFAULT false,
  recorrencia_id uuid,
  data_inicio date,
  data_fim date,
  status text NOT NULL DEFAULT 'pendente',
  data_pagamento date,
  gasto_id uuid,
  mes smallint NOT NULL,
  ano integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX idx_contas_a_pagar_user_mes_ano ON public.contas_a_pagar(user_id, ano, mes);
CREATE INDEX idx_contas_a_pagar_recorrencia ON public.contas_a_pagar(recorrencia_id) WHERE recorrencia_id IS NOT NULL;

-- RLS
ALTER TABLE public.contas_a_pagar ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contas_a_pagar_select_own"
  ON public.contas_a_pagar FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "contas_a_pagar_insert_own"
  ON public.contas_a_pagar FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "contas_a_pagar_update_own"
  ON public.contas_a_pagar FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "contas_a_pagar_delete_own"
  ON public.contas_a_pagar FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Trigger para updated_at
CREATE TRIGGER set_contas_a_pagar_updated_at
  BEFORE UPDATE ON public.contas_a_pagar
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();