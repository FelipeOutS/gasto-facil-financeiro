-- Tabela de ativos
CREATE TABLE public.investimentos_ativos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  nome TEXT NOT NULL,
  ticker TEXT,
  tipo TEXT NOT NULL DEFAULT 'outros',
  instituicao TEXT,
  quantidade NUMERIC,
  preco_medio NUMERIC,
  preco_atual NUMERIC,
  valor_aplicado NUMERIC NOT NULL DEFAULT 0,
  valor_atual NUMERIC NOT NULL DEFAULT 0,
  rentabilidade_tipo TEXT,
  rentabilidade_percentual TEXT,
  data_inicio DATE,
  data_vencimento DATE,
  liquidez TEXT,
  observacao TEXT,
  origem TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.investimentos_ativos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inv_ativos_select_own" ON public.investimentos_ativos FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "inv_ativos_insert_own" ON public.investimentos_ativos FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "inv_ativos_update_own" ON public.investimentos_ativos FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "inv_ativos_delete_own" ON public.investimentos_ativos FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_inv_ativos_user ON public.investimentos_ativos(user_id);
CREATE TRIGGER trg_inv_ativos_updated BEFORE UPDATE ON public.investimentos_ativos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Movimentações
CREATE TABLE public.investimentos_movimentacoes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  ativo_id UUID,
  tipo TEXT NOT NULL,
  data DATE NOT NULL,
  quantidade NUMERIC,
  valor_unitario NUMERIC,
  valor_total NUMERIC NOT NULL DEFAULT 0,
  instituicao TEXT,
  observacao TEXT,
  origem TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.investimentos_movimentacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inv_mov_select_own" ON public.investimentos_movimentacoes FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "inv_mov_insert_own" ON public.investimentos_movimentacoes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "inv_mov_update_own" ON public.investimentos_movimentacoes FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "inv_mov_delete_own" ON public.investimentos_movimentacoes FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_inv_mov_user ON public.investimentos_movimentacoes(user_id);
CREATE INDEX idx_inv_mov_ativo ON public.investimentos_movimentacoes(ativo_id);

-- Rendimentos
CREATE TABLE public.investimentos_rendimentos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  ativo_id UUID,
  tipo TEXT NOT NULL DEFAULT 'dividendo',
  data_pagamento DATE NOT NULL,
  valor NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'recebido',
  observacao TEXT,
  origem TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.investimentos_rendimentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inv_rend_select_own" ON public.investimentos_rendimentos FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "inv_rend_insert_own" ON public.investimentos_rendimentos FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "inv_rend_update_own" ON public.investimentos_rendimentos FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "inv_rend_delete_own" ON public.investimentos_rendimentos FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_inv_rend_user ON public.investimentos_rendimentos(user_id);
CREATE INDEX idx_inv_rend_ativo ON public.investimentos_rendimentos(ativo_id);

-- Importações
CREATE TABLE public.investimentos_importacoes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  tipo TEXT NOT NULL,
  arquivo_nome TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  dados_extraidos JSONB,
  erros TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.investimentos_importacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inv_imp_select_own" ON public.investimentos_importacoes FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "inv_imp_insert_own" ON public.investimentos_importacoes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "inv_imp_update_own" ON public.investimentos_importacoes FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "inv_imp_delete_own" ON public.investimentos_importacoes FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_inv_imp_user ON public.investimentos_importacoes(user_id);