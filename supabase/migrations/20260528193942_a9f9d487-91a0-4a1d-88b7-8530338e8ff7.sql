CREATE TABLE public.mercado_orcamentos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mes_referencia TEXT NOT NULL,
  valor_mensal NUMERIC NOT NULL DEFAULT 0,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mercado_orcamentos_mes_referencia_format CHECK (mes_referencia ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT mercado_orcamentos_valor_mensal_nonneg CHECK (valor_mensal >= 0),
  CONSTRAINT mercado_orcamentos_user_mes_unique UNIQUE (user_id, mes_referencia)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mercado_orcamentos TO authenticated;
GRANT ALL ON public.mercado_orcamentos TO service_role;

ALTER TABLE public.mercado_orcamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own mercado_orcamentos"
ON public.mercado_orcamentos FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own mercado_orcamentos"
ON public.mercado_orcamentos FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own mercado_orcamentos"
ON public.mercado_orcamentos FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own mercado_orcamentos"
ON public.mercado_orcamentos FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX idx_mercado_orcamentos_user_id ON public.mercado_orcamentos(user_id);
CREATE INDEX idx_mercado_orcamentos_user_mes ON public.mercado_orcamentos(user_id, mes_referencia DESC);

CREATE TRIGGER set_mercado_orcamentos_updated_at
BEFORE UPDATE ON public.mercado_orcamentos
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();