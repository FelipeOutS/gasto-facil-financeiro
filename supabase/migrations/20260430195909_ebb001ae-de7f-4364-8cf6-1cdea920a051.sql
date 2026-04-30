
-- 1) Campos de trial em user_plans
ALTER TABLE public.user_plans
  ADD COLUMN IF NOT EXISTS trial_plan_type text,
  ADD COLUMN IF NOT EXISTS trial_started_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS trial_used boolean NOT NULL DEFAULT false;

-- 2) Tabela contas_a_receber
CREATE TABLE IF NOT EXISTS public.contas_a_receber (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  titulo text NOT NULL,
  pagador_nome text,
  tipo_recebimento text NOT NULL DEFAULT 'cliente',
  valor_total numeric NOT NULL DEFAULT 0,
  valor_recebido numeric NOT NULL DEFAULT 0,
  valor_restante numeric NOT NULL DEFAULT 0,
  data_prevista date NOT NULL,
  data_recebimento date,
  status text NOT NULL DEFAULT 'pendente',
  categoria text,
  forma_recebimento text,
  observacao text,
  origem text DEFAULT 'manual',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.contas_a_receber ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contas_receber_select_own" ON public.contas_a_receber
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "contas_receber_insert_own" ON public.contas_a_receber
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "contas_receber_update_own" ON public.contas_a_receber
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "contas_receber_delete_own" ON public.contas_a_receber
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Trigger updated_at
DROP TRIGGER IF EXISTS contas_a_receber_set_updated_at ON public.contas_a_receber;
CREATE TRIGGER contas_a_receber_set_updated_at
  BEFORE UPDATE ON public.contas_a_receber
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_contas_a_receber_user_data ON public.contas_a_receber(user_id, data_prevista);
CREATE INDEX IF NOT EXISTS idx_contas_a_receber_status ON public.contas_a_receber(user_id, status);
