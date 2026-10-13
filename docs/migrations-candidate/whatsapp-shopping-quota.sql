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

CREATE OR REPLACE FUNCTION public.whatsapp_shopping_month_key()
RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog
AS $$ SELECT to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') $$;

CREATE OR REPLACE FUNCTION public.whatsapp_shopping_reserve(p_user_id uuid, p_external_id text)
RETURNS TABLE (claim_state text, previous_reply text, user_remaining integer, global_remaining integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
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

  IF FOUND AND v_ex.id IS NOT NULL THEN
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
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
