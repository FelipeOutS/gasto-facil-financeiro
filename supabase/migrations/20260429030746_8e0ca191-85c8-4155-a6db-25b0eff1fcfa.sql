-- Tabela de transferências internas (movimentações entre contas que não são receita nem despesa)
CREATE TABLE IF NOT EXISTS public.transferencias_internas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  valor NUMERIC NOT NULL DEFAULT 0,
  data DATE NOT NULL,
  horario TEXT,
  origem TEXT,
  destino TEXT,
  observacao TEXT,
  origem_importacao TEXT,
  ano INTEGER NOT NULL,
  mes SMALLINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.transferencias_internas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transferencias_internas_select_own"
  ON public.transferencias_internas FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "transferencias_internas_insert_own"
  ON public.transferencias_internas FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "transferencias_internas_update_own"
  ON public.transferencias_internas FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "transferencias_internas_delete_own"
  ON public.transferencias_internas FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER set_updated_at_transferencias_internas
  BEFORE UPDATE ON public.transferencias_internas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_transferencias_internas_user_data
  ON public.transferencias_internas(user_id, data DESC);

-- Adicionar campo origem em receitas para rastrear importações (se ainda não existir)
ALTER TABLE public.receitas
  ADD COLUMN IF NOT EXISTS origem TEXT;

ALTER TABLE public.receitas
  ADD COLUMN IF NOT EXISTS horario TEXT;
