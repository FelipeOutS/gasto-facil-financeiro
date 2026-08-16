-- 1) Histórico de Valor Estimado do Bem
CREATE TABLE public.bens_historico_valor (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bem_id UUID NOT NULL,
  valor_estimado NUMERIC(14,2) NOT NULL,
  data_referencia DATE NOT NULL DEFAULT CURRENT_DATE,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bens_historico_valor_bem_fk FOREIGN KEY (user_id, bem_id)
    REFERENCES public.bens(user_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_bens_hist_valor_bem ON public.bens_historico_valor(user_id, bem_id, data_referencia);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bens_historico_valor TO authenticated;
GRANT ALL ON public.bens_historico_valor TO service_role;
ALTER TABLE public.bens_historico_valor ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bens_hist_valor_select_own" ON public.bens_historico_valor FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "bens_hist_valor_insert_own" ON public.bens_historico_valor FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bens_hist_valor_delete_own" ON public.bens_historico_valor FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 2) Histórico de Saldo Devedor (Atualizações manuais)
CREATE TABLE public.bens_historico_saldo (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  financiamento_id UUID NOT NULL,
  saldo_devedor NUMERIC(14,2) NOT NULL,
  data_referencia DATE NOT NULL DEFAULT CURRENT_DATE,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bens_historico_saldo_fin_fk FOREIGN KEY (user_id, financiamento_id)
    REFERENCES public.bens_financiamentos(user_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_bens_hist_saldo_fin ON public.bens_historico_saldo(user_id, financiamento_id, data_referencia);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bens_historico_saldo TO authenticated;
GRANT ALL ON public.bens_historico_saldo TO service_role;
ALTER TABLE public.bens_historico_saldo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bens_hist_saldo_select_own" ON public.bens_historico_saldo FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "bens_hist_saldo_insert_own" ON public.bens_historico_saldo FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bens_hist_saldo_delete_own" ON public.bens_historico_saldo FOR DELETE TO authenticated USING (auth.uid() = user_id);