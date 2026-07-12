
-- 1) UNIQUE (notification_id, claim_token) — no máximo 1 tentativa por claim
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_notification_attempts_notification_claim_uniq
  ON public.whatsapp_notification_attempts (notification_id, claim_token);

-- 2) RPC atômica: valida ownership e insere tentativa numa única query
CREATE OR REPLACE FUNCTION public.whatsapp_attempt_prepare_atomic(
  p_notification_id uuid,
  p_claim_token uuid,
  p_attempt_token uuid,
  p_request_hash text,
  p_template_key text,
  p_template_name text,
  p_template_language text,
  p_client_reference text,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  outcome text,        -- 'prepared' | 'state_changed' | 'active_attempt_exists' | 'quarantined'
  attempt_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists_status text;
  v_new_id uuid;
BEGIN
  -- Bloqueio explícito para evitar corrida entre workers concorrentes com o mesmo claim.
  PERFORM 1
    FROM public.whatsapp_notifications
   WHERE id = p_notification_id
     AND status = 'processing'
     AND claim_token = p_claim_token
     AND lease_expires_at > p_now
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'state_changed'::text, NULL::uuid;
    RETURN;
  END IF;

  -- Existe tentativa ativa (planned/sending) ou em quarentena (ambiguous)?
  SELECT attempt_status INTO v_exists_status
    FROM public.whatsapp_notification_attempts
   WHERE notification_id = p_notification_id
     AND attempt_status IN ('planned','sending','ambiguous')
   LIMIT 1;

  IF v_exists_status = 'ambiguous' THEN
    RETURN QUERY SELECT 'quarantined'::text, NULL::uuid;
    RETURN;
  ELSIF v_exists_status IS NOT NULL THEN
    RETURN QUERY SELECT 'active_attempt_exists'::text, NULL::uuid;
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.whatsapp_notification_attempts (
      notification_id, attempt_token, claim_token, request_hash,
      template_key, template_name, template_language,
      attempt_status, started_at, client_reference
    ) VALUES (
      p_notification_id, p_attempt_token, p_claim_token, p_request_hash,
      p_template_key, p_template_name, p_template_language,
      'planned', p_now, p_client_reference
    )
    RETURNING id INTO v_new_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- Colisão em (notification_id, claim_token) OU no índice parcial de ativos.
      RETURN QUERY SELECT 'active_attempt_exists'::text, NULL::uuid;
      RETURN;
  END;

  RETURN QUERY SELECT 'prepared'::text, v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_attempt_prepare_atomic(uuid, uuid, uuid, text, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_attempt_prepare_atomic(uuid, uuid, uuid, text, text, text, text, text, timestamptz) TO service_role;
