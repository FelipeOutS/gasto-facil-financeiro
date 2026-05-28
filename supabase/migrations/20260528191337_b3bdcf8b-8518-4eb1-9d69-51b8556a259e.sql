CREATE TABLE public.mercado_cestas_padrao (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL DEFAULT 'outros',
  descricao TEXT,
  itens JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auth-only: todas as policies usam auth.uid() = user_id. Sem anon.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mercado_cestas_padrao TO authenticated;
GRANT ALL ON public.mercado_cestas_padrao TO service_role;

ALTER TABLE public.mercado_cestas_padrao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own cestas"
  ON public.mercado_cestas_padrao
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own cestas"
  ON public.mercado_cestas_padrao
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own cestas"
  ON public.mercado_cestas_padrao
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own cestas"
  ON public.mercado_cestas_padrao
  FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_mercado_cestas_padrao_user_updated
  ON public.mercado_cestas_padrao (user_id, updated_at DESC);

-- Reaproveita a função pública set_updated_at já existente no projeto.
CREATE TRIGGER mercado_cestas_padrao_set_updated_at
  BEFORE UPDATE ON public.mercado_cestas_padrao
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();