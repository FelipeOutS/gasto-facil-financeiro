
-- WA-C8.2 — Rate limit atômico
-- Advisory lock por chave serializa apenas a mesma chave (hash de 64 bits).
-- Não bloqueia outras chaves/usuários. Semântica de janela deslizante preservada.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  _key text,
  _route text,
  _limit integer,
  _window_seconds integer,
  _ip_address text DEFAULT NULL,
  _user_id uuid DEFAULT NULL,
  _user_agent text DEFAULT NULL,
  _method text DEFAULT NULL
) RETURNS TABLE(current_count integer, blocked boolean, reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz;
  v_count integer;
BEGIN
  IF _key IS NULL OR length(_key) = 0 OR length(_key) > 200 THEN
    RAISE EXCEPTION 'invalid rate limit key';
  END IF;
  IF _limit IS NULL OR _limit <= 0 OR _limit > 100000 THEN
    RAISE EXCEPTION 'invalid rate limit';
  END IF;
  IF _window_seconds IS NULL OR _window_seconds <= 0 OR _window_seconds > 604800 THEN
    RAISE EXCEPTION 'invalid window seconds';
  END IF;

  v_since := now() - make_interval(secs => _window_seconds);

  -- Serializa apenas a MESMA chave. Outras chaves seguem em paralelo.
  PERFORM pg_advisory_xact_lock(hashtextextended(_key, 0));

  SELECT count(*)::int INTO v_count
  FROM public.rate_limit_events
  WHERE key = _key AND created_at >= v_since;

  IF v_count >= _limit THEN
    INSERT INTO public.rate_limit_events(key, route, ip_address, user_id, user_agent, method, blocked)
    VALUES (_key,
            COALESCE(left(_route, 255), ''),
            left(_ip_address, 64),
            _user_id,
            left(_user_agent, 512),
            left(_method, 16),
            true);
    RETURN QUERY SELECT v_count, true, now() + make_interval(secs => _window_seconds);
  ELSE
    INSERT INTO public.rate_limit_events(key, route, ip_address, user_id, user_agent, method, blocked)
    VALUES (_key,
            COALESCE(left(_route, 255), ''),
            left(_ip_address, 64),
            _user_id,
            left(_user_agent, 512),
            left(_method, 16),
            false);
    RETURN QUERY SELECT (v_count + 1), false, now() + make_interval(secs => _window_seconds);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_hit(text, text, integer, integer, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rate_limit_hit(text, text, integer, integer, text, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.rate_limit_hit(text, text, integer, integer, text, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, text, integer, integer, text, uuid, text, text) TO service_role;
