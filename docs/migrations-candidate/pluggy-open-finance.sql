-- CANDIDATA — Pluggy Open Finance (Fase 2, Sandbox). NÃO APLICADA.
-- Destino: banco do Lovable Cloud (o mesmo atende preview e site publicado).
-- Somente CRIA tabelas novas e isoladas; não altera gastos, receitas, cartões,
-- imported_transactions nem nenhuma tabela existente.

CREATE OR REPLACE FUNCTION public.pluggy_is_allowed(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IN ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid, '47df50ce-df1e-4c54-8fae-0ffb5105478d'::uuid)
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'owner');
$$;
REVOKE ALL ON FUNCTION public.pluggy_is_allowed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pluggy_is_allowed(uuid) TO authenticated, service_role;

CREATE TABLE public.pluggy_settings (
  user_id uuid PRIMARY KEY,
  auto_import boolean NOT NULL DEFAULT false,
  auto_categorize boolean NOT NULL DEFAULT true,
  history_days integer NOT NULL DEFAULT 90 CHECK (history_days IN (30, 90, 180, 365)),
  access_state text NOT NULL DEFAULT 'ok' CHECK (access_state IN ('ok', 'pausado_acesso', 'pausado_erro')),
  paused_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.pluggy_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  item_id text NOT NULL UNIQUE,
  connector_id integer,
  connector_name text,
  is_sandbox boolean NOT NULL,
  status text,
  execution_status text,
  last_error text,
  consent_expires_at timestamptz,
  last_synced_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pluggy_items_user_idx ON public.pluggy_items (user_id);

CREATE TABLE public.pluggy_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  item_id text NOT NULL,
  account_id text NOT NULL,
  type text NOT NULL,
  subtype text,
  name text,
  number_last4 text,
  balance numeric(14,2),
  currency text NOT NULL DEFAULT 'BRL',
  credit_limit numeric(14,2),
  available_credit numeric(14,2),
  balance_due_date date,
  is_sandbox boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, account_id)
);

CREATE TABLE public.pluggy_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  item_id text NOT NULL,
  account_id text NOT NULL,
  transaction_id text NOT NULL,
  dedupe_key text NOT NULL,
  description text,
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'BRL',
  date date NOT NULL,
  status text NOT NULL,
  type text NOT NULL,
  pluggy_category text,
  operation_type text,
  installment_number integer,
  total_installments integer,
  classification text NOT NULL CHECK (classification IN ('gasto', 'receita', 'ignorado', 'revisao')),
  classification_reason text NOT NULL,
  categoria_sugerida text,
  categoria_manual text,
  review_status text CHECK (review_status IN ('aprovado', 'rejeitado')),
  mp_match_ids uuid[],
  is_sandbox boolean NOT NULL,
  imported_gasto_id uuid,
  imported_receita_id uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, transaction_id),
  UNIQUE (dedupe_key)
);
CREATE INDEX pluggy_tx_user_date_idx ON public.pluggy_transactions (user_id, date DESC);

CREATE TABLE public.pluggy_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event text NOT NULL,
  item_id text,
  status text NOT NULL,
  error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- Grants: leitura só para authenticated (filtrada por RLS); escrita só servidor.
GRANT SELECT ON public.pluggy_settings, public.pluggy_items, public.pluggy_accounts, public.pluggy_transactions TO authenticated;
GRANT ALL ON public.pluggy_settings, public.pluggy_items, public.pluggy_accounts, public.pluggy_transactions, public.pluggy_webhook_events TO service_role;

ALTER TABLE public.pluggy_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_webhook_events ENABLE ROW LEVEL SECURITY; -- sem políticas: só service_role

CREATE POLICY "pluggy_settings_own_select" ON public.pluggy_settings FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.pluggy_is_allowed(auth.uid()));
CREATE POLICY "pluggy_items_own_select" ON public.pluggy_items FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.pluggy_is_allowed(auth.uid()));
CREATE POLICY "pluggy_accounts_own_select" ON public.pluggy_accounts FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.pluggy_is_allowed(auth.uid()));
CREATE POLICY "pluggy_tx_own_select" ON public.pluggy_transactions FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.pluggy_is_allowed(auth.uid()));

CREATE TRIGGER pluggy_settings_touch BEFORE UPDATE ON public.pluggy_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER pluggy_items_touch BEFORE UPDATE ON public.pluggy_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER pluggy_accounts_touch BEFORE UPDATE ON public.pluggy_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER pluggy_tx_touch BEFORE UPDATE ON public.pluggy_transactions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
