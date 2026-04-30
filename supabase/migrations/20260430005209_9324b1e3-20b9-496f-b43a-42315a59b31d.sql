-- 1) Estender enum plan_tier com novos tiers comerciais
ALTER TYPE public.plan_tier ADD VALUE IF NOT EXISTS 'pessoal_manual';
ALTER TYPE public.plan_tier ADD VALUE IF NOT EXISTS 'pessoal_premium';
ALTER TYPE public.plan_tier ADD VALUE IF NOT EXISTS 'mei_essencial';
ALTER TYPE public.plan_tier ADD VALUE IF NOT EXISTS 'mei_inteligente';
ALTER TYPE public.plan_tier ADD VALUE IF NOT EXISTS 'sem_assinatura';

-- 2) Estender enum subscription_status
ALTER TYPE public.subscription_status ADD VALUE IF NOT EXISTS 'sem_assinatura';
ALTER TYPE public.subscription_status ADD VALUE IF NOT EXISTS 'aguardando_pagamento';

-- 3) Tabela de pagamentos / tentativas de assinatura
CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plano public.plan_tier NOT NULL,
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'BRL',
  method text NOT NULL DEFAULT 'pix',           -- 'pix' | 'card' | outro
  provider text NOT NULL DEFAULT 'mercadopago',
  provider_payment_id text,                      -- id retornado pelo gateway
  status text NOT NULL DEFAULT 'pending',        -- pending | approved | rejected | cancelled | refunded
  qr_code text,
  qr_code_base64 text,
  ticket_url text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);

CREATE INDEX IF NOT EXISTS subscription_payments_user_idx
  ON public.subscription_payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS subscription_payments_provider_idx
  ON public.subscription_payments(provider, provider_payment_id);

ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

-- Usuário lê os próprios; owner (admin master) lê todos
DROP POLICY IF EXISTS subpay_select_own_or_owner ON public.subscription_payments;
CREATE POLICY subpay_select_own_or_owner
  ON public.subscription_payments
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'owner'::app_role));

-- Apenas owner pode inserir/atualizar/deletar via cliente autenticado
-- (a criação real virá do servidor com service role, que ignora RLS)
DROP POLICY IF EXISTS subpay_insert_owner ON public.subscription_payments;
CREATE POLICY subpay_insert_owner
  ON public.subscription_payments
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'owner'::app_role));

DROP POLICY IF EXISTS subpay_update_owner ON public.subscription_payments;
CREATE POLICY subpay_update_owner
  ON public.subscription_payments
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'owner'::app_role));

DROP POLICY IF EXISTS subpay_delete_owner ON public.subscription_payments;
CREATE POLICY subpay_delete_owner
  ON public.subscription_payments
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'owner'::app_role));

-- updated_at trigger
DROP TRIGGER IF EXISTS subscription_payments_set_updated_at ON public.subscription_payments;
CREATE TRIGGER subscription_payments_set_updated_at
  BEFORE UPDATE ON public.subscription_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();