
-- ============= CATEGORIAS =============
CREATE TABLE public.categorias (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  icon_name TEXT NOT NULL,
  color_var TEXT NOT NULL,
  criada_pelo_usuario BOOLEAN NOT NULL DEFAULT false,
  legacy_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_categorias_user ON public.categorias(user_id);
ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "categorias_select_own" ON public.categorias
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "categorias_insert_own" ON public.categorias
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "categorias_update_own" ON public.categorias
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "categorias_delete_own" ON public.categorias
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_categorias_updated_at
  BEFORE UPDATE ON public.categorias
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============= GASTOS =============
CREATE TABLE public.gastos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  categoria_id UUID REFERENCES public.categorias(id) ON DELETE SET NULL,
  descricao TEXT NOT NULL,
  valor NUMERIC(14,2) NOT NULL,
  data DATE NOT NULL,
  estabelecimento TEXT NOT NULL DEFAULT '',
  forma_pagamento TEXT NOT NULL,
  observacao TEXT,
  imagem_url TEXT,
  mes SMALLINT NOT NULL,
  ano INTEGER NOT NULL,
  confirmado BOOLEAN NOT NULL DEFAULT true,
  tipo_gasto TEXT NOT NULL DEFAULT 'unico',
  parcela_atual SMALLINT,
  total_parcelas SMALLINT,
  grupo_parcelamento_id UUID,
  recorrencia_id UUID,
  essencial BOOLEAN,
  gasto_fixo BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_gastos_user ON public.gastos(user_id);
CREATE INDEX idx_gastos_user_periodo ON public.gastos(user_id, ano, mes);
CREATE INDEX idx_gastos_user_categoria ON public.gastos(user_id, categoria_id);
ALTER TABLE public.gastos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gastos_select_own" ON public.gastos
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "gastos_insert_own" ON public.gastos
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "gastos_update_own" ON public.gastos
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "gastos_delete_own" ON public.gastos
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_gastos_updated_at
  BEFORE UPDATE ON public.gastos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============= RECEITAS =============
CREATE TABLE public.receitas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  descricao TEXT NOT NULL,
  valor NUMERIC(14,2) NOT NULL,
  data DATE NOT NULL,
  tipo TEXT NOT NULL,
  recorrente BOOLEAN NOT NULL DEFAULT false,
  recorrencia_id UUID,
  mes SMALLINT NOT NULL,
  ano INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_receitas_user ON public.receitas(user_id);
CREATE INDEX idx_receitas_user_periodo ON public.receitas(user_id, ano, mes);
ALTER TABLE public.receitas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receitas_select_own" ON public.receitas
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "receitas_insert_own" ON public.receitas
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "receitas_update_own" ON public.receitas
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "receitas_delete_own" ON public.receitas
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_receitas_updated_at
  BEFORE UPDATE ON public.receitas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============= LIMITES =============
CREATE TABLE public.limites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  valor NUMERIC(14,2) NOT NULL,
  mes SMALLINT NOT NULL,
  ano INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, tipo, mes, ano)
);
CREATE INDEX idx_limites_user ON public.limites(user_id);
ALTER TABLE public.limites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "limites_select_own" ON public.limites
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "limites_insert_own" ON public.limites
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "limites_update_own" ON public.limites
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "limites_delete_own" ON public.limites
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_limites_updated_at
  BEFORE UPDATE ON public.limites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============= APRENDIZADO CATEGORIA =============
CREATE TABLE public.aprendizado_categoria (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  estabelecimento TEXT NOT NULL,
  categoria_id UUID NOT NULL REFERENCES public.categorias(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, estabelecimento)
);
CREATE INDEX idx_aprendizado_user ON public.aprendizado_categoria(user_id);
ALTER TABLE public.aprendizado_categoria ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aprendizado_select_own" ON public.aprendizado_categoria
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "aprendizado_insert_own" ON public.aprendizado_categoria
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "aprendizado_update_own" ON public.aprendizado_categoria
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "aprendizado_delete_own" ON public.aprendizado_categoria
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_aprendizado_updated_at
  BEFORE UPDATE ON public.aprendizado_categoria
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
