-- E35 / Parte 3 — Mercados salvos do Mercado Inteligente
CREATE TABLE public.mercado_mercados_salvos (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome text NOT NULL,
  endereco text,
  bairro text,
  cidade text,
  uf text,
  cep text,
  observacao text,
  favorito boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Grants: somente authenticated + service_role (sem anon — todas as policies usam auth.uid()).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mercado_mercados_salvos TO authenticated;
GRANT ALL ON public.mercado_mercados_salvos TO service_role;

ALTER TABLE public.mercado_mercados_salvos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mercados_salvos_select_own"
  ON public.mercado_mercados_salvos
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "mercados_salvos_insert_own"
  ON public.mercado_mercados_salvos
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "mercados_salvos_update_own"
  ON public.mercado_mercados_salvos
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "mercados_salvos_delete_own"
  ON public.mercado_mercados_salvos
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX mercado_mercados_salvos_user_updated_idx
  ON public.mercado_mercados_salvos (user_id, updated_at DESC);

-- Trigger reaproveita função já existente public.set_updated_at().
CREATE TRIGGER mercado_mercados_salvos_set_updated_at
  BEFORE UPDATE ON public.mercado_mercados_salvos
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();