
-- E26 — Sincronização de Histórico de Compras e Histórico Local de Preços

-- ============================================================
-- Tabela: mercado_historico_compras
-- ============================================================
CREATE TABLE public.mercado_historico_compras (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lista_id text,
  nome text NOT NULL,
  tipo text NOT NULL,
  mercado_nome text,
  total_estimado numeric NOT NULL DEFAULT 0,
  total_comprado_estimado numeric NOT NULL DEFAULT 0,
  total_itens integer NOT NULL DEFAULT 0,
  itens_comprados integer NOT NULL DEFAULT 0,
  itens_pendentes integer NOT NULL DEFAULT 0,
  percentual_concluido integer NOT NULL DEFAULT 0,
  economia_ou_estouro numeric,
  budget numeric,
  itens_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  concluida_em timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mercado_historico_compras_user_concluida
  ON public.mercado_historico_compras(user_id, concluida_em DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mercado_historico_compras TO authenticated;
GRANT ALL ON public.mercado_historico_compras TO service_role;

ALTER TABLE public.mercado_historico_compras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own historico compras"
  ON public.mercado_historico_compras FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own historico compras"
  ON public.mercado_historico_compras FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own historico compras"
  ON public.mercado_historico_compras FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own historico compras"
  ON public.mercado_historico_compras FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_mercado_historico_compras_updated_at
  BEFORE UPDATE ON public.mercado_historico_compras
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Tabela: mercado_precos_usuario
-- ============================================================
CREATE TABLE public.mercado_precos_usuario (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  historico_id text NOT NULL,
  produto_key text NOT NULL,
  codigo_barras text,
  nome_produto text NOT NULL,
  marca text,
  categoria text,
  unidade text,
  quantidade numeric NOT NULL DEFAULT 1,
  preco_unitario numeric NOT NULL,
  preco_total numeric NOT NULL DEFAULT 0,
  from_paid_price boolean NOT NULL DEFAULT false,
  origem text NOT NULL DEFAULT 'manual',
  estabelecimento text,
  cidade text,
  uf text,
  item_id text,
  lista_id text,
  comprado_em timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mercado_precos_usuario_user_produto
  ON public.mercado_precos_usuario(user_id, produto_key);
CREATE INDEX idx_mercado_precos_usuario_user_historico
  ON public.mercado_precos_usuario(user_id, historico_id);
CREATE INDEX idx_mercado_precos_usuario_user_comprado
  ON public.mercado_precos_usuario(user_id, comprado_em DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mercado_precos_usuario TO authenticated;
GRANT ALL ON public.mercado_precos_usuario TO service_role;

ALTER TABLE public.mercado_precos_usuario ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own precos usuario"
  ON public.mercado_precos_usuario FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own precos usuario"
  ON public.mercado_precos_usuario FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own precos usuario"
  ON public.mercado_precos_usuario FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own precos usuario"
  ON public.mercado_precos_usuario FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_mercado_precos_usuario_updated_at
  BEFORE UPDATE ON public.mercado_precos_usuario
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
