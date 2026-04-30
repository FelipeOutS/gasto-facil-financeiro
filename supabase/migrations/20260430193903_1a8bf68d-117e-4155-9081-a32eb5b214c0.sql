-- Campo de última atualização no ativo
ALTER TABLE public.investimentos_ativos
  ADD COLUMN IF NOT EXISTS ultima_atualizacao timestamp with time zone;

-- Tabela de histórico de atualizações
CREATE TABLE IF NOT EXISTS public.investimentos_atualizacoes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  ativo_id uuid NOT NULL,
  valor_anterior numeric,
  valor_novo numeric,
  preco_anterior numeric,
  preco_novo numeric,
  data_atualizacao timestamp with time zone NOT NULL DEFAULT now(),
  observacao text,
  origem text NOT NULL DEFAULT 'manual',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_atualizacoes_user ON public.investimentos_atualizacoes(user_id);
CREATE INDEX IF NOT EXISTS idx_inv_atualizacoes_ativo ON public.investimentos_atualizacoes(ativo_id);

ALTER TABLE public.investimentos_atualizacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inv_atual_select_own"
  ON public.investimentos_atualizacoes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "inv_atual_insert_own"
  ON public.investimentos_atualizacoes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "inv_atual_update_own"
  ON public.investimentos_atualizacoes FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "inv_atual_delete_own"
  ON public.investimentos_atualizacoes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);