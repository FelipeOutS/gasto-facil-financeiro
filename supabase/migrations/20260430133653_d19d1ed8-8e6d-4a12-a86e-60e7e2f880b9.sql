-- Faturas mensais de cartões (status pago/aberto/fechado/vencido por mês/ano)
CREATE TABLE public.faturas_cartao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  cartao_id uuid NOT NULL,
  mes smallint NOT NULL,
  ano integer NOT NULL,
  status text NOT NULL DEFAULT 'aberta',
  data_pagamento date,
  valor_pago numeric NOT NULL DEFAULT 0,
  observacao text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT faturas_cartao_unique UNIQUE (user_id, cartao_id, mes, ano)
);

CREATE INDEX faturas_cartao_user_cartao_idx ON public.faturas_cartao (user_id, cartao_id, ano, mes);

ALTER TABLE public.faturas_cartao ENABLE ROW LEVEL SECURITY;

CREATE POLICY faturas_cartao_select_own ON public.faturas_cartao
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY faturas_cartao_insert_own ON public.faturas_cartao
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY faturas_cartao_update_own ON public.faturas_cartao
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY faturas_cartao_delete_own ON public.faturas_cartao
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER faturas_cartao_set_updated_at
  BEFORE UPDATE ON public.faturas_cartao
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();