CREATE TABLE public.mercado_listas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL DEFAULT 'outros',
  observation TEXT,
  estimate NUMERIC,
  status TEXT NOT NULL DEFAULT 'planning',
  progress INTEGER NOT NULL DEFAULT 0,
  items_count INTEGER NOT NULL DEFAULT 0,
  entries JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX mercado_listas_user_id_idx ON public.mercado_listas (user_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mercado_listas TO authenticated;
GRANT ALL ON public.mercado_listas TO service_role;

ALTER TABLE public.mercado_listas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own mercado_listas"
  ON public.mercado_listas FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own mercado_listas"
  ON public.mercado_listas FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own mercado_listas"
  ON public.mercado_listas FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own mercado_listas"
  ON public.mercado_listas FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER mercado_listas_set_updated_at
  BEFORE UPDATE ON public.mercado_listas
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();