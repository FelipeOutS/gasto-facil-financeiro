-- WhatsApp 2.0: idempotent research reservations and short, private context.
-- This migration is intentionally not applied by the application.
CREATE TABLE IF NOT EXISTS public.whatsapp_research_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_hash text NOT NULL CHECK (phone_hash ~ '^[0-9a-f]{64}$'),
  external_id text NOT NULL,
  intent text NOT NULL CHECK (intent IN ('product', 'compare', 'general', 'followup')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'completed', 'failed')),
  response_text text,
  context jsonb,
  context_expires_at timestamptz,
  provider_request_id text,
  search_calls integer NOT NULL DEFAULT 0 CHECK (search_calls >= 0),
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (user_id, external_id),
  CHECK (length(external_id) BETWEEN 1 AND 200),
  CHECK (response_text IS NULL OR length(response_text) <= 3500),
  CHECK (context IS NULL OR pg_column_size(context) <= 8192)
);

CREATE INDEX whatsapp_research_recent_user_idx
  ON public.whatsapp_research_requests (user_id, phone_hash, created_at DESC);

ALTER TABLE public.whatsapp_research_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_research_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.whatsapp_research_requests TO service_role;

-- Serializes each user's monthly budget and external-id claim. The caller
-- supplies a server-side plan quota; end users cannot invoke the function.
CREATE OR REPLACE FUNCTION public.whatsapp_claim_research(
  p_user_id uuid, p_phone_hash text, p_external_id text, p_intent text,
  p_monthly_limit integer, p_global_monthly_limit integer
) RETURNS TABLE (claim_state text, request_id uuid, previous_response text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_existing public.whatsapp_research_requests%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_phone_hash IS NULL OR p_phone_hash !~ '^[0-9a-f]{64}$'
     OR p_external_id IS NULL
     OR length(p_external_id) NOT BETWEEN 1 AND 200
     OR p_intent NOT IN ('product', 'compare', 'general', 'followup')
     OR p_monthly_limit IS NULL OR p_monthly_limit < 1
     OR p_global_monthly_limit IS NULL OR p_global_monthly_limit < 1 THEN
    RAISE EXCEPTION 'invalid research claim';
  END IF;

  -- One global lock serializes both global and per-user reservation counts.
  PERFORM pg_advisory_xact_lock(91041::bigint);
  SELECT * INTO v_existing FROM public.whatsapp_research_requests r
    WHERE r.user_id = p_user_id AND r.external_id = p_external_id;
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.state, v_existing.id, v_existing.response_text;
    RETURN;
  END IF;

  IF (SELECT count(*) FROM public.whatsapp_research_requests r
      WHERE r.created_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')
      >= p_global_monthly_limit THEN
    RETURN QUERY SELECT 'global_quota'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF (SELECT count(*) FROM public.whatsapp_research_requests r
      WHERE r.user_id = p_user_id
        AND r.created_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')
      >= p_monthly_limit THEN
    RETURN QUERY SELECT 'quota'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  INSERT INTO public.whatsapp_research_requests (user_id, phone_hash, external_id, intent)
    VALUES (p_user_id, p_phone_hash, p_external_id, p_intent) RETURNING id INTO request_id;
  claim_state := 'claimed';
  previous_response := NULL;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_claim_research(uuid, text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_claim_research(uuid, text, text, text, integer, integer) TO service_role;
