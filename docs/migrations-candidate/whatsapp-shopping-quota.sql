-- CANDIDATO — NÃO APLICADO EM NENHUM BANCO REAL. Cota persistente do Assistente de Compras.
-- Regras: 10 PESQUISAS/usuário/mês e 200 CHAMADAS SerpApi reais/mês (global), mês em
-- America/Sao_Paulo. Reserva 2 chamadas antes da API; finish desconta só as efetivas;
-- 0 chamadas libera. Idempotente por (user_id, external_id). Limites FIXOS na função:
-- o chamador não escolhe limites, tentativas máximas nem mês.
-- Tabela nova e isolada: whatsapp_research_requests conta MENSAGENS (linhas) e tem
-- semântica/CHECKs da pesquisa Wikimedia; reaproveitá-la misturaria as cotas.
-- Tradeoff de crash: reserva pendente há >15 min é encerrada como 'expired' contando
-- as 2 chamadas e 1 pesquisa (conservador: nunca subconta, pode sobrecontar).

CREATE TABLE IF NOT EXISTS public.whatsapp_shopping_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 200),
  month_key text NOT NULL CHECK (month_key ~ '^[0-9]{4}-[0-9]{2}$'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','done','released','expired')),
  reserved_calls integer NOT NULL DEFAULT 2 CHECK (reserved_calls BETWEEN 0 AND 2),
  api_calls integer NOT NULL DEFAULT 0 CHECK (api_calls BETWEEN 0 AND 2),
  reply text CHECK (reply IS NULL OR length(reply) <= 3500),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (user_id, external_id)
);
CREATE INDEX IF NOT EXISTS whatsapp_shopping_searches_month_idx
  ON public.whatsapp_shopping_searches (month_key, user_id);

-- Sem escrita direta para NENHUM papel de API (nem service_role): só as RPCs abaixo.
REVOKE ALL ON public.whatsapp_shopping_searches FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.whatsapp_shopping_searches TO service_role;
ALTER TABLE public.whatsapp_shopping_searches ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.whatsapp_shopping_month_key_at(p_ts timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$ SELECT to_char(p_ts AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') $$;
CREATE OR REPLACE FUNCTION public.whatsapp_shopping_month_key()
RETURNS text LANGUAGE sql STABLE SET search_path = public
AS $$ SELECT public.whatsapp_shopping_month_key_at(now()) $$;

CREATE OR REPLACE FUNCTION public.whatsapp_shopping_reserve(p_user_id uuid, p_external_id text)
RETURNS TABLE (claim_state text, previous_reply text, user_remaining integer, global_remaining integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  c_user_limit constant integer := 10;
  c_global_limit constant integer := 200;
  c_max_calls constant integer := 2;
  v_month text := public.whatsapp_shopping_month_key();
  v_ex public.whatsapp_shopping_searches%ROWTYPE;
  v_user integer; v_global integer;
BEGIN
  IF p_user_id IS NULL OR p_external_id IS NULL OR length(p_external_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid shopping reserve';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gi_whatsapp_shopping_quota')::bigint);
  UPDATE public.whatsapp_shopping_searches s
     SET state = 'expired', api_calls = s.reserved_calls, finished_at = now()
   WHERE s.state = 'pending' AND s.created_at < now() - interval '15 minutes';

  SELECT * INTO v_ex FROM public.whatsapp_shopping_searches s
   WHERE s.user_id = p_user_id AND s.external_id = p_external_id;
  SELECT coalesce(sum(CASE WHEN s.state = 'pending' THEN s.reserved_calls ELSE s.api_calls END), 0)::int
    INTO v_global FROM public.whatsapp_shopping_searches s WHERE s.month_key = v_month;
  SELECT count(*)::int INTO v_user FROM public.whatsapp_shopping_searches s
   WHERE s.month_key = v_month AND s.user_id = p_user_id AND (s.state = 'pending' OR s.api_calls > 0);

  IF v_ex.id IS NOT NULL THEN
    RETURN QUERY SELECT 'duplicate'::text, v_ex.reply, greatest(c_user_limit - v_user, 0), greatest(c_global_limit - v_global, 0);
    RETURN;
  END IF;
  IF v_global + c_max_calls > c_global_limit THEN
    RETURN QUERY SELECT 'global_quota'::text, NULL::text, greatest(c_user_limit - v_user, 0), greatest(c_global_limit - v_global, 0);
    RETURN;
  END IF;
  IF v_user >= c_user_limit THEN
    RETURN QUERY SELECT 'user_quota'::text, NULL::text, 0, greatest(c_global_limit - v_global, 0);
    RETURN;
  END IF;
  INSERT INTO public.whatsapp_shopping_searches (user_id, external_id, month_key, reserved_calls)
  VALUES (p_user_id, p_external_id, v_month, c_max_calls);
  RETURN QUERY SELECT 'reserved'::text, NULL::text, c_user_limit - v_user - 1, c_global_limit - v_global - c_max_calls;
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_shopping_finish(
  p_user_id uuid, p_external_id text, p_api_calls integer, p_reply text
) RETURNS TABLE (finished boolean, user_remaining integer, global_remaining integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  c_user_limit constant integer := 10;
  c_global_limit constant integer := 200;
  v_row public.whatsapp_shopping_searches%ROWTYPE;
  v_done boolean := false; v_user integer; v_global integer;
BEGIN
  IF p_user_id IS NULL OR p_external_id IS NULL OR p_api_calls IS NULL OR p_api_calls NOT BETWEEN 0 AND 2
     OR (p_reply IS NOT NULL AND length(p_reply) > 3500) THEN
    RAISE EXCEPTION 'invalid shopping finish';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gi_whatsapp_shopping_quota')::bigint);
  UPDATE public.whatsapp_shopping_searches s
     SET state = CASE WHEN p_api_calls = 0 THEN 'released' ELSE 'done' END,
         api_calls = least(p_api_calls, s.reserved_calls), reply = p_reply, finished_at = now()
   WHERE s.user_id = p_user_id AND s.external_id = p_external_id AND s.state = 'pending'
  RETURNING * INTO v_row;
  v_done := FOUND;
  IF NOT v_done THEN
    SELECT * INTO v_row FROM public.whatsapp_shopping_searches s
     WHERE s.user_id = p_user_id AND s.external_id = p_external_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'shopping reservation not found'; END IF;
  END IF;
  SELECT coalesce(sum(CASE WHEN s.state = 'pending' THEN s.reserved_calls ELSE s.api_calls END), 0)::int
    INTO v_global FROM public.whatsapp_shopping_searches s WHERE s.month_key = v_row.month_key;
  SELECT count(*)::int INTO v_user FROM public.whatsapp_shopping_searches s
   WHERE s.month_key = v_row.month_key AND s.user_id = p_user_id AND (s.state = 'pending' OR s.api_calls > 0);
  RETURN QUERY SELECT v_done, greatest(c_user_limit - v_user, 0), greatest(c_global_limit - v_global, 0);
END $$;

REVOKE ALL ON FUNCTION public.whatsapp_shopping_reserve(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_shopping_finish(uuid, text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_shopping_month_key() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_shopping_reserve(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_shopping_finish(uuid, text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_shopping_month_key() TO service_role;
REVOKE ALL ON FUNCTION public.whatsapp_shopping_month_key_at(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_shopping_month_key_at(timestamptz) TO service_role;

-- ===== Contexto de continuação (namespace compras), TTL 20 min =====
-- Guarda SOMENTE a busca normalizada e ofertas públicas (título, loja, preço, URL)
-- com horário da coleta. Nunca dados financeiros. Chave: user_id + phone_hash.
CREATE TABLE IF NOT EXISTS public.whatsapp_shopping_contexts (
  user_id uuid NOT NULL,
  phone_hash text NOT NULL CHECK (phone_hash ~ '^[0-9a-f]{64}$'),
  query text NOT NULL CHECK (length(query) BETWEEN 1 AND 120),
  offers jsonb NOT NULL CHECK (jsonb_typeof(offers) = 'array' AND jsonb_array_length(offers) <= 3 AND pg_column_size(offers) <= 4096),
  collected_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, phone_hash)
);
REVOKE ALL ON public.whatsapp_shopping_contexts FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.whatsapp_shopping_contexts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.whatsapp_shopping_context_save(
  p_user_id uuid, p_phone_hash text, p_query text, p_offers jsonb, p_collected_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_collected_at IS NULL OR p_collected_at > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'invalid shopping context';
  END IF;
  INSERT INTO public.whatsapp_shopping_contexts AS c (user_id, phone_hash, query, offers, collected_at, expires_at, updated_at)
  VALUES (p_user_id, p_phone_hash, p_query, p_offers, p_collected_at, now() + interval '20 minutes', now())
  ON CONFLICT (user_id, phone_hash) DO UPDATE
    SET query = EXCLUDED.query, offers = EXCLUDED.offers, collected_at = EXCLUDED.collected_at,
        expires_at = EXCLUDED.expires_at, updated_at = now();
  DELETE FROM public.whatsapp_shopping_contexts c WHERE c.expires_at < now() - interval '1 day';
END $$;

DROP FUNCTION IF EXISTS public.whatsapp_shopping_context_get(uuid, text);
CREATE OR REPLACE FUNCTION public.whatsapp_shopping_context_get(p_user_id uuid, p_phone_hash text)
RETURNS TABLE (query text, offers jsonb, collected_at timestamptz, expired boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  -- Expirado (até 1 dia) volta só como marcador, SEM ofertas, para pedir nova pesquisa.
  SELECT c.query, CASE WHEN c.expires_at > now() THEN c.offers ELSE NULL END, c.collected_at, c.expires_at <= now()
    FROM public.whatsapp_shopping_contexts c
   WHERE c.user_id = p_user_id AND c.phone_hash = p_phone_hash AND c.expires_at > now() - interval '1 day'
$$;

REVOKE ALL ON FUNCTION public.whatsapp_shopping_context_save(uuid, text, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_shopping_context_get(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_shopping_context_save(uuid, text, text, jsonb, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_shopping_context_get(uuid, text) TO service_role;
