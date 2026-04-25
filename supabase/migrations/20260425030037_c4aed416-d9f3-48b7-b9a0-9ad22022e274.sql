-- ============================================================
-- Phase 2: Bancos / Dinheiro guardado / Metas / Movimentações
-- ============================================================

-- ---------- BANCOS ----------
CREATE TABLE public.bancos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nome text NOT NULL,
  icone text,
  color_hex text NOT NULL DEFAULT '#3b82f6',
  criado_pelo_usuario boolean NOT NULL DEFAULT true,
  legacy_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bancos ENABLE ROW LEVEL SECURITY;

CREATE POLICY bancos_select_own ON public.bancos
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY bancos_insert_own ON public.bancos
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY bancos_update_own ON public.bancos
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY bancos_delete_own ON public.bancos
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX bancos_user_idx ON public.bancos(user_id);
CREATE UNIQUE INDEX bancos_user_legacy_uidx
  ON public.bancos(user_id, legacy_id) WHERE legacy_id IS NOT NULL;

CREATE TRIGGER bancos_set_updated_at
  BEFORE UPDATE ON public.bancos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ---------- DINHEIRO GUARDADO ----------
CREATE TABLE public.dinheiro_guardado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  banco_id uuid REFERENCES public.bancos(id) ON DELETE CASCADE,
  valor numeric(14,2) NOT NULL DEFAULT 0,
  tipo_reserva text NOT NULL DEFAULT 'outros',
  observacao text,
  data_atualizacao date NOT NULL DEFAULT (now()::date),
  legacy_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dinheiro_guardado ENABLE ROW LEVEL SECURITY;

CREATE POLICY guardado_select_own ON public.dinheiro_guardado
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY guardado_insert_own ON public.dinheiro_guardado
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY guardado_update_own ON public.dinheiro_guardado
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY guardado_delete_own ON public.dinheiro_guardado
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX guardado_user_idx ON public.dinheiro_guardado(user_id);
CREATE INDEX guardado_banco_idx ON public.dinheiro_guardado(banco_id);

CREATE TRIGGER guardado_set_updated_at
  BEFORE UPDATE ON public.dinheiro_guardado
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ---------- METAS FINANCEIRAS ----------
CREATE TABLE public.metas_financeiras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nome text NOT NULL,
  valor_objetivo numeric(14,2) NOT NULL DEFAULT 0,
  valor_atual numeric(14,2) NOT NULL DEFAULT 0,
  prazo date,
  descricao text,
  color_hex text NOT NULL DEFAULT '#10b981',
  banco_id uuid REFERENCES public.bancos(id) ON DELETE SET NULL,
  legacy_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.metas_financeiras ENABLE ROW LEVEL SECURITY;

CREATE POLICY metas_select_own ON public.metas_financeiras
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY metas_insert_own ON public.metas_financeiras
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY metas_update_own ON public.metas_financeiras
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY metas_delete_own ON public.metas_financeiras
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX metas_user_idx ON public.metas_financeiras(user_id);
CREATE INDEX metas_banco_idx ON public.metas_financeiras(banco_id);

CREATE TRIGGER metas_set_updated_at
  BEFORE UPDATE ON public.metas_financeiras
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ---------- MOVIMENTAÇÕES DE META ----------
CREATE TABLE public.movimentacoes_meta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  meta_id uuid NOT NULL REFERENCES public.metas_financeiras(id) ON DELETE CASCADE,
  valor numeric(14,2) NOT NULL DEFAULT 0,
  data date NOT NULL DEFAULT (now()::date),
  banco_id uuid REFERENCES public.bancos(id) ON DELETE SET NULL,
  observacao text,
  legacy_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.movimentacoes_meta ENABLE ROW LEVEL SECURITY;

CREATE POLICY mov_meta_select_own ON public.movimentacoes_meta
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY mov_meta_insert_own ON public.movimentacoes_meta
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY mov_meta_update_own ON public.movimentacoes_meta
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY mov_meta_delete_own ON public.movimentacoes_meta
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX mov_meta_user_idx ON public.movimentacoes_meta(user_id);
CREATE INDEX mov_meta_meta_idx ON public.movimentacoes_meta(meta_id);

CREATE TRIGGER mov_meta_set_updated_at
  BEFORE UPDATE ON public.movimentacoes_meta
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();