-- ============================================================
-- BENS & FINANCIAMENTOS — V1
-- Integridade de conta via FK COMPOSTA (user_id, id).
-- ============================================================

-- Pré-requisito para FK composta a partir das tabelas filhas.
ALTER TABLE public.gastos ADD CONSTRAINT gastos_user_id_id_key UNIQUE (user_id, id);
ALTER TABLE public.recorrencias ADD CONSTRAINT recorrencias_user_id_id_key UNIQUE (user_id, id);

-- ------------------------------------------------------------
-- 1) bens
-- ------------------------------------------------------------
CREATE TABLE public.bens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('imovel', 'veiculo')),
  nome TEXT NOT NULL,
  descricao TEXT,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'arquivado', 'vendido')),
  data_aquisicao DATE,
  valor_aquisicao NUMERIC(14,2),
  valor_mercado NUMERIC(14,2),
  -- Entrada: fonte única de verdade. NUNCA replicada em bens_custos_aquisicao.
  entrada_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  entrada_recursos_proprios NUMERIC(14,2) NOT NULL DEFAULT 0,
  entrada_fgts NUMERIC(14,2) NOT NULL DEFAULT 0,
  entrada_outros NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Imóvel
  endereco TEXT,
  area_m2 NUMERIC(10,2),
  matricula TEXT,
  -- Veículo
  marca TEXT,
  modelo TEXT,
  ano_modelo INTEGER,
  placa TEXT,
  observacao TEXT,
  arquivado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bens_user_id_id_key UNIQUE (user_id, id)
);
COMMENT ON COLUMN public.bens.entrada_total IS 'Entrada paga na aquisicao. Fonte unica; nao deve ser lancada tambem em bens_custos_aquisicao (evita dupla contabilizacao).';

CREATE INDEX idx_bens_user ON public.bens(user_id);
CREATE INDEX idx_bens_user_status ON public.bens(user_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bens TO authenticated;
GRANT ALL ON public.bens TO service_role;
ALTER TABLE public.bens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bens_select_own" ON public.bens FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "bens_insert_own" ON public.bens FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bens_update_own" ON public.bens FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bens_delete_own" ON public.bens FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_bens_updated_at BEFORE UPDATE ON public.bens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 2) bens_financiamentos (histórico: N por bem, no máximo 1 ativo)
-- ------------------------------------------------------------
CREATE TABLE public.bens_financiamentos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bem_id UUID NOT NULL,
  instituicao TEXT,
  modalidade TEXT,
  sistema_amortizacao TEXT CHECK (sistema_amortizacao IN ('sac', 'price', 'outro')),
  valor_financiado NUMERIC(14,2) NOT NULL DEFAULT 0,
  taxa_juros_anual NUMERIC(8,4),
  prazo_meses INTEGER,
  primeiro_vencimento DATE,
  dia_vencimento SMALLINT CHECK (dia_vencimento IS NULL OR (dia_vencimento BETWEEN 1 AND 31)),
  saldo_devedor_informado NUMERIC(14,2),
  saldo_devedor_data DATE,
  status TEXT NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo', 'liquidado', 'portado', 'refinanciado', 'cancelado')),
  motivo_encerramento TEXT,
  encerrado_em DATE,
  substituido_por_id UUID REFERENCES public.bens_financiamentos(id) ON DELETE SET NULL,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bens_financiamentos_user_id_id_key UNIQUE (user_id, id),
  CONSTRAINT bens_financiamentos_bem_fk FOREIGN KEY (user_id, bem_id)
    REFERENCES public.bens(user_id, id) ON DELETE CASCADE
);

-- V1: apenas um financiamento ativo por bem; histórico livre para refinanciamento/portabilidade.
CREATE UNIQUE INDEX uniq_bens_financiamento_ativo
  ON public.bens_financiamentos(bem_id) WHERE status = 'ativo';
CREATE INDEX idx_bens_financiamentos_user ON public.bens_financiamentos(user_id);
CREATE INDEX idx_bens_financiamentos_bem ON public.bens_financiamentos(bem_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bens_financiamentos TO authenticated;
GRANT ALL ON public.bens_financiamentos TO service_role;
ALTER TABLE public.bens_financiamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bens_financiamentos_select_own" ON public.bens_financiamentos FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "bens_financiamentos_insert_own" ON public.bens_financiamentos FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bens_financiamentos_update_own" ON public.bens_financiamentos FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bens_financiamentos_delete_own" ON public.bens_financiamentos FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_bens_financiamentos_updated_at BEFORE UPDATE ON public.bens_financiamentos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 3) bens_pagamentos (parcelas pagas)
-- ------------------------------------------------------------
CREATE TABLE public.bens_pagamentos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bem_id UUID NOT NULL,
  financiamento_id UUID,
  numero_parcela INTEGER,
  competencia TEXT,
  data_pagamento DATE NOT NULL,
  -- Snapshot do evento. Quando gasto_id existe, o desembsolso é contado UMA vez (via gasto).
  valor_pago NUMERIC(14,2) NOT NULL,
  valor_juros NUMERIC(14,2),
  valor_amortizacao NUMERIC(14,2),
  valor_seguro NUMERIC(14,2),
  valor_taxas NUMERIC(14,2),
  gasto_id UUID,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bens_pagamentos_bem_fk FOREIGN KEY (user_id, bem_id)
    REFERENCES public.bens(user_id, id) ON DELETE CASCADE,
  CONSTRAINT bens_pagamentos_financiamento_fk FOREIGN KEY (user_id, financiamento_id)
    REFERENCES public.bens_financiamentos(user_id, id) ON DELETE SET NULL,
  CONSTRAINT bens_pagamentos_gasto_fk FOREIGN KEY (user_id, gasto_id)
    REFERENCES public.gastos(user_id, id) ON DELETE SET NULL,
  CONSTRAINT bens_pagamentos_gasto_unico UNIQUE (gasto_id)
);
COMMENT ON COLUMN public.bens_pagamentos.valor_pago IS 'Snapshot do valor no momento do registro. Se gasto_id NOT NULL, o desembolso financeiro vem do gasto (contagem unica); valor_pago serve como historico/composicao.';

CREATE INDEX idx_bens_pagamentos_user ON public.bens_pagamentos(user_id);
CREATE INDEX idx_bens_pagamentos_bem ON public.bens_pagamentos(bem_id, data_pagamento);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bens_pagamentos TO authenticated;
GRANT ALL ON public.bens_pagamentos TO service_role;
ALTER TABLE public.bens_pagamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bens_pagamentos_select_own" ON public.bens_pagamentos FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "bens_pagamentos_insert_own" ON public.bens_pagamentos FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bens_pagamentos_update_own" ON public.bens_pagamentos FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bens_pagamentos_delete_own" ON public.bens_pagamentos FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_bens_pagamentos_updated_at BEFORE UPDATE ON public.bens_pagamentos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 4) bens_amortizacoes
-- ------------------------------------------------------------
CREATE TABLE public.bens_amortizacoes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bem_id UUID NOT NULL,
  financiamento_id UUID,
  data DATE NOT NULL,
  valor NUMERIC(14,2) NOT NULL,
  origem_recurso TEXT CHECK (origem_recurso IN ('proprio', 'fgts', 'terceiros', 'outros')),
  efeito TEXT CHECK (efeito IN ('reduz_prazo', 'reduz_parcela')),
  gasto_id UUID,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bens_amortizacoes_bem_fk FOREIGN KEY (user_id, bem_id)
    REFERENCES public.bens(user_id, id) ON DELETE CASCADE,
  CONSTRAINT bens_amortizacoes_financiamento_fk FOREIGN KEY (user_id, financiamento_id)
    REFERENCES public.bens_financiamentos(user_id, id) ON DELETE SET NULL,
  CONSTRAINT bens_amortizacoes_gasto_fk FOREIGN KEY (user_id, gasto_id)
    REFERENCES public.gastos(user_id, id) ON DELETE SET NULL,
  CONSTRAINT bens_amortizacoes_gasto_unico UNIQUE (gasto_id)
);
COMMENT ON COLUMN public.bens_amortizacoes.valor IS 'Snapshot. Se gasto_id NOT NULL, o desembolso e contado uma unica vez (via gasto).';

CREATE INDEX idx_bens_amortizacoes_user ON public.bens_amortizacoes(user_id);
CREATE INDEX idx_bens_amortizacoes_bem ON public.bens_amortizacoes(bem_id, data);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bens_amortizacoes TO authenticated;
GRANT ALL ON public.bens_amortizacoes TO service_role;
ALTER TABLE public.bens_amortizacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bens_amortizacoes_select_own" ON public.bens_amortizacoes FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "bens_amortizacoes_insert_own" ON public.bens_amortizacoes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bens_amortizacoes_update_own" ON public.bens_amortizacoes FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bens_amortizacoes_delete_own" ON public.bens_amortizacoes FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_bens_amortizacoes_updated_at BEFORE UPDATE ON public.bens_amortizacoes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 5) bens_custos_aquisicao (SOMENTE custos adicionais; nunca a entrada)
-- ------------------------------------------------------------
CREATE TABLE public.bens_custos_aquisicao (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bem_id UUID NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('itbi', 'registro', 'escritura', 'avaliacao', 'corretagem', 'documentacao', 'vistoria', 'transferencia', 'outros')),
  descricao TEXT,
  valor NUMERIC(14,2) NOT NULL,
  data DATE,
  gasto_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bens_custos_aquisicao_bem_fk FOREIGN KEY (user_id, bem_id)
    REFERENCES public.bens(user_id, id) ON DELETE CASCADE,
  CONSTRAINT bens_custos_aquisicao_gasto_fk FOREIGN KEY (user_id, gasto_id)
    REFERENCES public.gastos(user_id, id) ON DELETE SET NULL,
  CONSTRAINT bens_custos_aquisicao_gasto_unico UNIQUE (gasto_id)
);
COMMENT ON TABLE public.bens_custos_aquisicao IS 'Custos ADICIONAIS da aquisicao (ITBI, registro, escritura, avaliacao, corretagem, documentacao). A entrada NAO entra aqui: ela vive em bens.entrada_total (anti dupla contabilizacao).';

CREATE INDEX idx_bens_custos_user ON public.bens_custos_aquisicao(user_id);
CREATE INDEX idx_bens_custos_bem ON public.bens_custos_aquisicao(bem_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bens_custos_aquisicao TO authenticated;
GRANT ALL ON public.bens_custos_aquisicao TO service_role;
ALTER TABLE public.bens_custos_aquisicao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bens_custos_select_own" ON public.bens_custos_aquisicao FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "bens_custos_insert_own" ON public.bens_custos_aquisicao FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bens_custos_update_own" ON public.bens_custos_aquisicao FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bens_custos_delete_own" ON public.bens_custos_aquisicao FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_bens_custos_updated_at BEFORE UPDATE ON public.bens_custos_aquisicao
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 6) Vínculos em gastos / recorrencias (FK composta = mesma conta)
-- ------------------------------------------------------------
ALTER TABLE public.gastos ADD COLUMN bem_id UUID;
ALTER TABLE public.gastos ADD CONSTRAINT gastos_bem_fk FOREIGN KEY (user_id, bem_id)
  REFERENCES public.bens(user_id, id) ON DELETE SET NULL;
CREATE INDEX idx_gastos_bem ON public.gastos(user_id, bem_id) WHERE bem_id IS NOT NULL;

ALTER TABLE public.recorrencias ADD COLUMN bem_id UUID;
ALTER TABLE public.recorrencias ADD CONSTRAINT recorrencias_bem_fk FOREIGN KEY (user_id, bem_id)
  REFERENCES public.bens(user_id, id) ON DELETE SET NULL;
CREATE INDEX idx_recorrencias_bem ON public.recorrencias(user_id, bem_id) WHERE bem_id IS NOT NULL;

-- ------------------------------------------------------------
-- 7) Arquivar em vez de excluir: bloqueia DELETE destrutivo de bem com histórico
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bens_prevent_destructive_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  n INTEGER;
BEGIN
  SELECT
    (SELECT count(*) FROM public.bens_pagamentos WHERE bem_id = OLD.id)
    + (SELECT count(*) FROM public.bens_amortizacoes WHERE bem_id = OLD.id)
    + (SELECT count(*) FROM public.bens_custos_aquisicao WHERE bem_id = OLD.id)
    + (SELECT count(*) FROM public.gastos WHERE bem_id = OLD.id)
    + (SELECT count(*) FROM public.recorrencias WHERE bem_id = OLD.id)
  INTO n;

  IF n > 0 THEN
    RAISE EXCEPTION 'bem_com_historico: arquive o bem em vez de excluir (% vinculos)', n
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_bens_prevent_destructive_delete
  BEFORE DELETE ON public.bens
  FOR EACH ROW EXECUTE FUNCTION public.bens_prevent_destructive_delete();