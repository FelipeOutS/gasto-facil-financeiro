-- CANDIDATA — Pluggy Open Finance (Fase 2, Sandbox). NÃO APLICADA.
-- Revisão 2 (2026-10-19): função de autorização sem parâmetro (só auth.uid()),
-- SECURITY INVOKER; deduplicação escopada por dono+conta; FKs compostas entre
-- tabelas Pluggy; fila durável de webhooks com estados, tentativas e lease.
-- Destino: banco do Lovable Cloud (o mesmo atende preview e site publicado).
-- Somente CRIA objetos novos e isolados; não altera gastos, receitas, cartões,
-- imported_transactions nem nenhuma tabela, função ou dado existente.

-- ---------------------------------------------------------------------------
-- 1. Autorização: o chamador só pode consultar a si mesmo.
--    SECURITY INVOKER: lê user_roles pela política existente
--    "user_roles_select_own_or_owner" (auth.uid() = user_id); sem privilégio extra.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.pluggy_is_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
     AND auth.uid() IN ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid, '47df50ce-df1e-4c54-8fae-0ffb5105478d'::uuid)
     AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'owner');
$$;
REVOKE ALL ON FUNCTION public.pluggy_is_allowed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pluggy_is_allowed() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Tabelas
-- ---------------------------------------------------------------------------
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
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_id)
);

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
  UNIQUE (user_id, account_id),
  FOREIGN KEY (user_id, item_id) REFERENCES public.pluggy_items (user_id, item_id) ON DELETE CASCADE
);
CREATE INDEX pluggy_accounts_item_idx ON public.pluggy_accounts (user_id, item_id);

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
  UNIQUE (user_id, account_id, transaction_id),
  UNIQUE (user_id, dedupe_key),
  FOREIGN KEY (user_id, account_id) REFERENCES public.pluggy_accounts (user_id, account_id) ON DELETE CASCADE
);
CREATE INDEX pluggy_tx_user_date_idx ON public.pluggy_transactions (user_id, date DESC);

-- Fila durável de webhooks. Guarda só identificadores (nada de valores ou descrições).
CREATE TABLE public.pluggy_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event text NOT NULL,
  item_id text,
  transaction_ids text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'processando', 'concluido', 'falhou', 'esgotado')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  claim_token uuid,
  error text CHECK (error IS NULL OR length(error) <= 120),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX pluggy_webhook_events_due_idx ON public.pluggy_webhook_events (status, next_attempt_at);

-- ---------------------------------------------------------------------------
-- 3. Grants: leitura só para authenticated (filtrada por RLS); escrita só servidor.
--    anon não recebe nada.
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.pluggy_settings, public.pluggy_items, public.pluggy_accounts, public.pluggy_transactions TO authenticated;
GRANT ALL ON public.pluggy_settings, public.pluggy_items, public.pluggy_accounts, public.pluggy_transactions, public.pluggy_webhook_events TO service_role;

ALTER TABLE public.pluggy_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_webhook_events ENABLE ROW LEVEL SECURITY; -- sem políticas: só service_role

CREATE POLICY "pluggy_settings_own_select" ON public.pluggy_settings FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.pluggy_is_allowed());
CREATE POLICY "pluggy_items_own_select" ON public.pluggy_items FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.pluggy_is_allowed());
CREATE POLICY "pluggy_accounts_own_select" ON public.pluggy_accounts FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.pluggy_is_allowed());
CREATE POLICY "pluggy_tx_own_select" ON public.pluggy_transactions FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.pluggy_is_allowed());

CREATE TRIGGER pluggy_settings_touch BEFORE UPDATE ON public.pluggy_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER pluggy_items_touch BEFORE UPDATE ON public.pluggy_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER pluggy_accounts_touch BEFORE UPDATE ON public.pluggy_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER pluggy_tx_touch BEFORE UPDATE ON public.pluggy_transactions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Fila de webhooks (somente service_role). Cada mudança de estado é atômica.
-- ---------------------------------------------------------------------------

-- Registra a entrega de forma durável. Reentrega de evento 'falhou' volta a
-- 'pendente'; 'concluido', 'processando' e 'esgotado' não mudam.
CREATE FUNCTION public.pluggy_webhook_enqueue(p_event_id text, p_event text, p_item_id text, p_transaction_ids text[])
RETURNS TABLE (status text, is_new boolean)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  INSERT INTO public.pluggy_webhook_events AS e (event_id, event, item_id, transaction_ids)
  VALUES (p_event_id, p_event, p_item_id, COALESCE(p_transaction_ids, '{}'))
  ON CONFLICT (event_id) DO UPDATE
    SET status = CASE WHEN e.status = 'falhou' THEN 'pendente' ELSE e.status END,
        next_attempt_at = CASE WHEN e.status = 'falhou' THEN now() ELSE e.next_attempt_at END
  RETURNING e.status, (xmax = 0);
END $$;

-- Reserva até p_limit eventos devidos (pendente, falhou vencido, ou processando
-- com lease expirado). SKIP LOCKED: duas execuções nunca pegam o mesmo evento.
CREATE FUNCTION public.pluggy_webhook_claim(p_limit integer, p_lease_seconds integer)
RETURNS TABLE (id uuid, event text, item_id text, transaction_ids text[], attempts integer, max_attempts integer, claim_token uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_token uuid := gen_random_uuid();
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT e.id FROM public.pluggy_webhook_events e
    WHERE (e.status IN ('pendente', 'falhou') AND e.next_attempt_at <= now())
       OR (e.status = 'processando' AND e.locked_until < now())
    ORDER BY e.next_attempt_at
    LIMIT LEAST(GREATEST(p_limit, 1), 50)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.pluggy_webhook_events e
     SET status = 'processando', attempts = e.attempts + 1, claim_token = v_token,
         locked_until = now() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 30), 900))
    FROM due WHERE e.id = due.id
  RETURNING e.id, e.event, e.item_id, e.transaction_ids, e.attempts, e.max_attempts, e.claim_token;
END $$;

-- Finaliza somente se o chamador ainda detém a reserva (claim_token).
-- Sucesso -> concluido. Falha -> falhou com backoff, ou esgotado no limite.
CREATE FUNCTION public.pluggy_webhook_finish(p_id uuid, p_claim_token uuid, p_ok boolean, p_error text)
RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  UPDATE public.pluggy_webhook_events e
     SET status = CASE WHEN p_ok THEN 'concluido'
                       WHEN e.attempts >= e.max_attempts THEN 'esgotado'
                       ELSE 'falhou' END,
         error = CASE WHEN p_ok THEN NULL ELSE left(COALESCE(p_error, 'erro'), 120) END,
         next_attempt_at = CASE WHEN p_ok THEN e.next_attempt_at
                                ELSE now() + make_interval(secs => LEAST(60 * power(2, e.attempts)::int, 21600)) END,
         processed_at = CASE WHEN p_ok THEN now() ELSE e.processed_at END,
         locked_until = NULL, claim_token = NULL
   WHERE e.id = p_id AND e.claim_token = p_claim_token AND e.status = 'processando'
  RETURNING e.status INTO v_status;
  RETURN COALESCE(v_status, 'reserva_perdida');
END $$;

REVOKE ALL ON FUNCTION public.pluggy_webhook_enqueue(text, text, text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pluggy_webhook_claim(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pluggy_webhook_finish(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pluggy_webhook_enqueue(text, text, text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.pluggy_webhook_claim(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pluggy_webhook_finish(uuid, uuid, boolean, text) TO service_role;
