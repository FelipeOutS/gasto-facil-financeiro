
-- ────────────────────────────────────────────────────────────────
-- WA-C9.2 D.1 Preflight — guarda de role e mark_sending atômico
-- ────────────────────────────────────────────────────────────────

-- 1) prepare_atomic: adiciona guarda interna de role.
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
  outcome text,
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
  -- WA-SEC-RPC-01: defesa em profundidade além dos GRANTs.
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'permission denied for function whatsapp_attempt_prepare_atomic'
      USING ERRCODE = '42501';
  END IF;

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
      RETURN QUERY SELECT 'active_attempt_exists'::text, NULL::uuid;
      RETURN;
  END;

  RETURN QUERY SELECT 'prepared'::text, v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_attempt_prepare_atomic(uuid, uuid, uuid, text, text, text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_attempt_prepare_atomic(uuid, uuid, uuid, text, text, text, text, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_attempt_prepare_atomic(uuid, uuid, uuid, text, text, text, text, text, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_attempt_prepare_atomic(uuid, uuid, uuid, text, text, text, text, text, timestamptz) TO service_role;

-- 2) mark_sending atômico: revalida ownership antes de sending.
--
-- Contrato (única transação):
--   - lock da tentativa por (id, attempt_token);
--   - lock da notificação por notification_id;
--   - revalida status='processing', claim_token=att.claim_token, lease vigente;
--   - se ownership válida  → attempt planned → sending;
--   - se ownership perdida → attempt planned → cancelled (mesma TX);
--   - se attempt já não está planned → state_changed (sem tocar).
--
-- Impede: (a) callback movendo notif→sent entre prepare e sending,
-- (b) recovery limpando claim, (c) lease expirado, (d) claim rotacionado,
-- (e) notif cancelada.
CREATE OR REPLACE FUNCTION public.whatsapp_attempt_mark_sending_atomic(
  p_attempt_id uuid,
  p_attempt_token uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_att public.whatsapp_notification_attempts%ROWTYPE;
  v_notif public.whatsapp_notifications%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'permission denied for function whatsapp_attempt_mark_sending_atomic'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_att
    FROM public.whatsapp_notification_attempts
   WHERE id = p_attempt_id
     AND attempt_token = p_attempt_token
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text;
    RETURN;
  END IF;

  IF v_att.attempt_status <> 'planned' THEN
    RETURN QUERY SELECT 'state_changed'::text;
    RETURN;
  END IF;

  SELECT * INTO v_notif
    FROM public.whatsapp_notifications
   WHERE id = v_att.notification_id
   FOR UPDATE;

  IF NOT FOUND
     OR v_notif.status <> 'processing'
     OR v_notif.claim_token IS DISTINCT FROM v_att.claim_token
     OR v_notif.lease_expires_at IS NULL
     OR v_notif.lease_expires_at <= p_now
  THEN
    -- Ownership perdida: cancela a tentativa planned na mesma transação.
    UPDATE public.whatsapp_notification_attempts
       SET attempt_status = 'cancelled',
           error_code     = 'ownership_lost',
           error_category = 'cancelled',
           retryable      = NULL,
           finished_at    = p_now
     WHERE id = p_attempt_id
       AND attempt_status = 'planned';
    RETURN QUERY SELECT 'ownership_lost'::text;
    RETURN;
  END IF;

  UPDATE public.whatsapp_notification_attempts
     SET attempt_status = 'sending'
   WHERE id = p_attempt_id
     AND attempt_status = 'planned';

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'state_changed'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'sending'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_attempt_mark_sending_atomic(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_attempt_mark_sending_atomic(uuid, uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_attempt_mark_sending_atomic(uuid, uuid, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_attempt_mark_sending_atomic(uuid, uuid, timestamptz) TO service_role;
