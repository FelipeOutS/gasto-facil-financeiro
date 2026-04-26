-- Tabela de cartões de crédito
CREATE TABLE IF NOT EXISTS public.cartoes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  nome TEXT NOT NULL,
  banco TEXT NOT NULL DEFAULT '',
  limite_total NUMERIC NOT NULL DEFAULT 0,
  dia_fechamento SMALLINT NOT NULL DEFAULT 1,
  dia_vencimento SMALLINT NOT NULL DEFAULT 10,
  cor TEXT NOT NULL DEFAULT '#8b5cf6',
  observacao TEXT,
  legacy_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cartoes_dia_fechamento_check CHECK (dia_fechamento BETWEEN 1 AND 31),
  CONSTRAINT cartoes_dia_vencimento_check CHECK (dia_vencimento BETWEEN 1 AND 31)
);

ALTER TABLE public.cartoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY cartoes_select_own ON public.cartoes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY cartoes_insert_own ON public.cartoes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY cartoes_update_own ON public.cartoes
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY cartoes_delete_own ON public.cartoes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER cartoes_set_updated_at
  BEFORE UPDATE ON public.cartoes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS cartoes_user_id_idx ON public.cartoes(user_id);

-- Vínculo opcional de cartão em gastos
ALTER TABLE public.gastos ADD COLUMN IF NOT EXISTS cartao_id UUID;
CREATE INDEX IF NOT EXISTS gastos_cartao_id_idx ON public.gastos(cartao_id);