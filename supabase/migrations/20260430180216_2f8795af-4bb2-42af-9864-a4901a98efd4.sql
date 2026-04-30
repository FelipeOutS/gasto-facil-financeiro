-- Tabela de recorrências (assinaturas e gastos recorrentes)
CREATE TABLE public.recorrencias (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  nome TEXT NOT NULL,
  valor NUMERIC NOT NULL DEFAULT 0,
  categoria_id UUID,
  frequencia TEXT NOT NULL DEFAULT 'mensal',
  proxima_cobranca DATE,
  forma_pagamento TEXT,
  cartao_id UUID,
  status TEXT NOT NULL DEFAULT 'ativa',
  origem TEXT NOT NULL DEFAULT 'manual',
  observacao TEXT,
  ultimo_valor NUMERIC,
  detection_key TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.recorrencias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recorrencias_select_own" ON public.recorrencias
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "recorrencias_insert_own" ON public.recorrencias
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "recorrencias_update_own" ON public.recorrencias
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "recorrencias_delete_own" ON public.recorrencias
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_recorrencias_updated_at
  BEFORE UPDATE ON public.recorrencias
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_recorrencias_user ON public.recorrencias(user_id);
CREATE INDEX idx_recorrencias_status ON public.recorrencias(user_id, status);
CREATE UNIQUE INDEX idx_recorrencias_detection_key ON public.recorrencias(user_id, detection_key) WHERE detection_key IS NOT NULL;