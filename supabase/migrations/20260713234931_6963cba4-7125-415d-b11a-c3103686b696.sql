
-- WA-C9.2 Fase D.2A — Estado atômico, callbacks e recovery consciente de attempts
-- Migration incremental e aditiva. Sem backfill. Sem alteração de dados.

-- =========================================================================
-- 1) Coluna client_reference em status_events (opcional, nullable)
-- =========================================================================
ALTER TABLE public.whatsapp_notification_status_events
  ADD COLUMN IF NOT EXISTS client_reference text NULL;

CREATE INDEX IF NOT EXISTS idx_wa_notif_status_events_client_reference
  ON public.whatsapp_notification_status_events (client_reference)
  WHERE client_reference IS NOT NULL;

-- =========================================================================
-- 2) UNIQUE parcial de provider_message_id nas attempts
-- =========================================================================
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_notification_attempts_provider_message_id_uniq
  ON public.whatsapp_notification_attempts (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- =========================================================================
-- 3) RPC: finalize accepted
-- =========================================================================
CREATE OR REPLACE FUNCTION public.whatsapp_attempt_finalize_accepted_atomic(
  p_attempt_id uuid,
  p_attempt_token uuid,
  p_provider_message_id text,
  p_http_status integer,
  p_finished_at timestamptz DEFAULT now()
) RETURNS TABLE(outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_att public.whatsapp_notification_attempts%ROWTYPE;
  v_notif public.whatsapp_notifications%ROWTYPE;
  v_pmid text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_attempt_id IS NULL OR p_attempt_token IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  IF p_http_status IS NULL OR p_http_status < 200 OR p_http_status > 299 THEN
    RAISE EXCEPTION 'invalid_http_status' USING ERRCODE = '22023';
  END IF;
  v_pmid := nullif(btrim(p_provider_message_id), '');
  IF v_pmid IS NULL OR length(v_pmid) > 256 OR v_pmid ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'invalid_provider_message_id' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_att
    FROM public.whatsapp_notification_attempts
   WHERE id = p_attempt_id AND attempt_token = p_attempt_token
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text; RETURN;
  END IF;

  -- Idempotência: já accepted com mesmo PMID
  IF v_att.attempt_status = 'accepted' AND v_att.provider_message_id = v_pmid THEN
    RETURN QUERY SELECT 'accepted_idempotent'::text; RETURN;
  END IF;
  IF v_att.attempt_status = 'accepted' AND v_att.provider_message_id IS DISTINCT FROM v_pmid THEN
    RETURN QUERY SELECT 'conflict_pmid'::text; RETURN;
  END IF;

  IF v_att.attempt_status <> 'sending' THEN
    RETURN QUERY SELECT 'state_changed'::text; RETURN;
  END IF;

  SELECT * INTO v_notif
    FROM public.whatsapp_notifications
   WHERE id = v_att.notification_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'notification_missing'::text; RETURN;
  END IF;

  IF v_notif.status = 'sent' AND v_notif.provider_message_id IS DISTINCT FROM v_pmid THEN
    RETURN QUERY SELECT 'conflict_pmid'::text; RETURN;
  END IF;
  IF v_notif.status IN ('cancelled','skipped') THEN
    RETURN QUERY SELECT 'conflict_state'::text; RETURN;
  END IF;

  -- Verifica conflito global de PMID (unique index cobre, mas retornamos discriminado)
  IF EXISTS (
    SELECT 1 FROM public.whatsapp_notification_attempts
     WHERE provider_message_id = v_pmid AND id <> v_att.id
  ) THEN
    RETURN QUERY SELECT 'conflict_pmid'::text; RETURN;
  END IF;

  UPDATE public.whatsapp_notification_attempts
     SET attempt_status = 'accepted',
         provider_message_id = v_pmid,
         http_status = p_http_status,
         finished_at = p_finished_at,
         error_code = NULL,
         error_category = NULL,
         retryable = NULL,
         updated_at = now()
   WHERE id = p_attempt_id AND attempt_status = 'sending';
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'state_changed'::text; RETURN;
  END IF;

  UPDATE public.whatsapp_notifications
     SET status = 'sent',
         provider_message_id = v_pmid,
         sent_at = LEAST(coalesce(sent_at, p_finished_at), p_finished_at),
         claim_token = NULL,
         claimed_at = NULL,
         lease_expires_at = NULL,
         updated_at = now()
   WHERE id = v_notif.id
     AND status IN ('processing','sent');

  RETURN QUERY SELECT 'accepted'::text;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.whatsapp_attempt_finalize_accepted_atomic(uuid,uuid,text,integer,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.whatsapp_attempt_finalize_accepted_atomic(uuid,uuid,text,integer,timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.whatsapp_attempt_finalize_accepted_atomic(uuid,uuid,text,integer,timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_attempt_finalize_accepted_atomic(uuid,uuid,text,integer,timestamptz) TO service_role;

-- =========================================================================
-- 4) RPC: finalize rejected
-- =========================================================================
CREATE OR REPLACE FUNCTION public.whatsapp_attempt_finalize_rejected_atomic(
  p_attempt_id uuid,
  p_attempt_token uuid,
  p_http_status integer,
  p_error_code text,
  p_error_category text,
  p_retryable boolean,
  p_finished_at timestamptz DEFAULT now()
) RETURNS TABLE(outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_att public.whatsapp_notification_attempts%ROWTYPE;
  v_code text;
  v_cat text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_attempt_id IS NULL OR p_attempt_token IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;

  v_code := left(regexp_replace(coalesce(p_error_code,''), '[[:cntrl:]]', '', 'g'), 128);
  v_cat  := left(regexp_replace(coalesce(p_error_category,'rejected'), '[[:cntrl:]]', '', 'g'), 64);
  IF v_cat IS NULL OR v_cat = '' THEN v_cat := 'rejected'; END IF;

  SELECT * INTO v_att
    FROM public.whatsapp_notification_attempts
   WHERE id = p_attempt_id AND attempt_token = p_attempt_token
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text; RETURN;
  END IF;

  IF v_att.attempt_status = 'rejected' THEN
    RETURN QUERY SELECT 'rejected_idempotent'::text; RETURN;
  END IF;
  IF v_att.attempt_status <> 'sending' THEN
    RETURN QUERY SELECT 'state_changed'::text; RETURN;
  END IF;

  UPDATE public.whatsapp_notification_attempts
     SET attempt_status = 'rejected',
         finished_at    = p_finished_at,
         http_status    = p_http_status,
         error_code     = nullif(v_code, ''),
         error_category = v_cat,
         retryable      = p_retryable,
         updated_at     = now()
   WHERE id = p_attempt_id AND attempt_status = 'sending';
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'state_changed'::text; RETURN;
  END IF;

  UPDATE public.whatsapp_notifications
     SET status           = 'failed',
         failed_at        = p_finished_at,
         last_error_code  = nullif(v_code, ''),
         claim_token      = NULL,
         claimed_at       = NULL,
         lease_expires_at = NULL,
         next_attempt_at  = NULL,
         updated_at       = now()
   WHERE id = v_att.notification_id
     AND status = 'processing';

  RETURN QUERY SELECT 'rejected'::text;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.whatsapp_attempt_finalize_rejected_atomic(uuid,uuid,integer,text,text,boolean,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.whatsapp_attempt_finalize_rejected_atomic(uuid,uuid,integer,text,text,boolean,timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.whatsapp_attempt_finalize_rejected_atomic(uuid,uuid,integer,text,text,boolean,timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_attempt_finalize_rejected_atomic(uuid,uuid,integer,text,text,boolean,timestamptz) TO service_role;

-- =========================================================================
-- 5) RPC: finalize ambiguous
-- =========================================================================
CREATE OR REPLACE FUNCTION public.whatsapp_attempt_finalize_ambiguous_atomic(
  p_attempt_id uuid,
  p_attempt_token uuid,
  p_error_code text,
  p_http_status integer,
  p_finished_at timestamptz DEFAULT now()
) RETURNS TABLE(outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_att public.whatsapp_notification_attempts%ROWTYPE;
  v_code text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_attempt_id IS NULL OR p_attempt_token IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;

  v_code := left(regexp_replace(coalesce(p_error_code,'send_ambiguous'), '[[:cntrl:]]', '', 'g'), 128);
  IF v_code IS NULL OR v_code = '' THEN v_code := 'send_ambiguous'; END IF;

  SELECT * INTO v_att
    FROM public.whatsapp_notification_attempts
   WHERE id = p_attempt_id AND attempt_token = p_attempt_token
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text; RETURN;
  END IF;

  IF v_att.attempt_status = 'ambiguous' THEN
    RETURN QUERY SELECT 'ambiguous_idempotent'::text; RETURN;
  END IF;
  IF v_att.attempt_status <> 'sending' THEN
    RETURN QUERY SELECT 'state_changed'::text; RETURN;
  END IF;

  UPDATE public.whatsapp_notification_attempts
     SET attempt_status = 'ambiguous',
         finished_at    = p_finished_at,
         http_status    = p_http_status,
         error_code     = v_code,
         error_category = 'ambiguous',
         retryable      = NULL,
         updated_at     = now()
   WHERE id = p_attempt_id AND attempt_status = 'sending';
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'state_changed'::text; RETURN;
  END IF;

  UPDATE public.whatsapp_notifications
     SET status           = 'failed',
         failed_at        = p_finished_at,
         last_error_code  = 'send_ambiguous',
         claim_token      = NULL,
         claimed_at       = NULL,
         lease_expires_at = NULL,
         next_attempt_at  = NULL,
         updated_at       = now()
   WHERE id = v_att.notification_id
     AND status = 'processing';

  RETURN QUERY SELECT 'ambiguous'::text;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.whatsapp_attempt_finalize_ambiguous_atomic(uuid,uuid,text,integer,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.whatsapp_attempt_finalize_ambiguous_atomic(uuid,uuid,text,integer,timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.whatsapp_attempt_finalize_ambiguous_atomic(uuid,uuid,text,integer,timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_attempt_finalize_ambiguous_atomic(uuid,uuid,text,integer,timestamptz) TO service_role;

-- =========================================================================
-- 6) RPC: reconcile callback  -> correlaciona PMID / client_reference com attempt
-- =========================================================================
CREATE OR REPLACE FUNCTION public.whatsapp_attempt_reconcile_callback_atomic(
  p_client_reference text,
  p_provider_message_id text,
  p_event_status text,
  p_event_at timestamptz DEFAULT now()
) RETURNS TABLE(outcome text, attempt_id uuid, notification_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_pmid text;
  v_cref text;
  v_att public.whatsapp_notification_attempts%ROWTYPE;
  v_notif public.whatsapp_notifications%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_pmid := nullif(btrim(coalesce(p_provider_message_id,'')), '');
  IF v_pmid IS NULL OR length(v_pmid) > 256 OR v_pmid ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'invalid_provider_message_id' USING ERRCODE = '22023';
  END IF;
  IF p_event_status IS NULL OR p_event_status NOT IN ('sent','delivered','read','failed') THEN
    RAISE EXCEPTION 'invalid_event_status' USING ERRCODE = '22023';
  END IF;

  v_cref := nullif(btrim(coalesce(p_client_reference,'')), '');
  IF v_cref IS NOT NULL AND (length(v_cref) > 256 OR v_cref ~ '[[:cntrl:]]') THEN
    v_cref := NULL;  -- ignora client_reference inválido; usa PMID
  END IF;

  -- Correlação: PMID primeiro, depois client_reference
  SELECT * INTO v_att
    FROM public.whatsapp_notification_attempts
   WHERE provider_message_id = v_pmid
   FOR UPDATE;

  IF NOT FOUND AND v_cref IS NOT NULL THEN
    SELECT * INTO v_att
      FROM public.whatsapp_notification_attempts
     WHERE client_reference = v_cref
     FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unmatched'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;

  SELECT * INTO v_notif
    FROM public.whatsapp_notifications
   WHERE id = v_att.notification_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'notification_missing'::text, v_att.id, NULL::uuid; RETURN;
  END IF;

  -- Conflito de PMID: attempt já tinha outro
  IF v_att.provider_message_id IS NOT NULL AND v_att.provider_message_id IS DISTINCT FROM v_pmid THEN
    RETURN QUERY SELECT 'conflict_pmid'::text, v_att.id, v_notif.id; RETURN;
  END IF;

  -- Rejected/cancelled: não converter silenciosamente
  IF v_att.attempt_status IN ('rejected','cancelled') THEN
    RETURN QUERY SELECT 'conflict_state'::text, v_att.id, v_notif.id; RETURN;
  END IF;

  -- sending/ambiguous → accepted quando o callback prova reconhecimento pela Meta
  IF v_att.attempt_status IN ('sending','ambiguous') THEN
    UPDATE public.whatsapp_notification_attempts
       SET attempt_status = 'accepted',
           provider_message_id = v_pmid,
           finished_at = coalesce(finished_at, p_event_at),
           retryable = NULL,
           updated_at = now()
     WHERE id = v_att.id;
  ELSIF v_att.attempt_status = 'planned' THEN
    -- planned não deveria receber callback; associa PMID mas mantém estado para recovery decidir
    UPDATE public.whatsapp_notification_attempts
       SET provider_message_id = v_pmid, updated_at = now()
     WHERE id = v_att.id AND provider_message_id IS NULL;
  END IF;

  RETURN QUERY SELECT 'reconciled'::text, v_att.id, v_notif.id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.whatsapp_attempt_reconcile_callback_atomic(text,text,text,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.whatsapp_attempt_reconcile_callback_atomic(text,text,text,timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.whatsapp_attempt_reconcile_callback_atomic(text,text,text,timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_attempt_reconcile_callback_atomic(text,text,text,timestamptz) TO service_role;

-- =========================================================================
-- 7) RPC: recovery consciente de attempts
-- =========================================================================
CREATE OR REPLACE FUNCTION public.whatsapp_notification_recover_with_attempt_atomic(
  p_notification_id uuid,
  p_now timestamptz DEFAULT now(),
  p_backoff interval DEFAULT interval '5 minutes'
) RETURNS TABLE(outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_notif public.whatsapp_notifications%ROWTYPE;
  v_att public.whatsapp_notification_attempts%ROWTYPE;
  v_next timestamptz;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_notification_id IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;

  v_next := p_now + p_backoff;

  SELECT * INTO v_notif
    FROM public.whatsapp_notifications
   WHERE id = p_notification_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text; RETURN;
  END IF;

  -- Recovery só age em processing com lease vencido
  IF v_notif.status <> 'processing' THEN
    RETURN QUERY SELECT 'noop'::text; RETURN;
  END IF;
  IF v_notif.lease_expires_at IS NOT NULL AND v_notif.lease_expires_at > p_now THEN
    RETURN QUERY SELECT 'lease_valid'::text; RETURN;
  END IF;

  -- Attempt ativa associada (via claim_token da notif)
  SELECT * INTO v_att
    FROM public.whatsapp_notification_attempts
   WHERE notification_id = v_notif.id
     AND claim_token IS NOT DISTINCT FROM v_notif.claim_token
     AND attempt_status IN ('planned','sending','ambiguous','accepted','rejected','cancelled')
   ORDER BY started_at DESC
   LIMIT 1
   FOR UPDATE;

  -- Caso 1: sem attempt vinculada
  IF NOT FOUND THEN
    UPDATE public.whatsapp_notifications
       SET status = 'pending',
           next_attempt_at = v_next,
           last_error_code = 'processing_timeout',
           claim_token = NULL,
           claimed_at = NULL,
           lease_expires_at = NULL,
           updated_at = now()
     WHERE id = v_notif.id AND status = 'processing';
    RETURN QUERY SELECT 'recovered_without_attempt'::text; RETURN;
  END IF;

  -- Caso 2: planned (nenhum request iniciado)
  IF v_att.attempt_status = 'planned' THEN
    UPDATE public.whatsapp_notification_attempts
       SET attempt_status = 'cancelled',
           finished_at = p_now,
           error_code = 'ownership_or_lease_expired_before_send',
           error_category = 'cancelled',
           retryable = NULL,
           updated_at = now()
     WHERE id = v_att.id AND attempt_status = 'planned';
    UPDATE public.whatsapp_notifications
       SET status = 'pending',
           next_attempt_at = v_next,
           claim_token = NULL,
           claimed_at = NULL,
           lease_expires_at = NULL,
           updated_at = now()
     WHERE id = v_notif.id AND status = 'processing';
    RETURN QUERY SELECT 'planned_cancelled'::text; RETURN;
  END IF;

  -- Caso 3: sending → ambiguous / failed (send_ambiguous)
  IF v_att.attempt_status = 'sending' THEN
    UPDATE public.whatsapp_notification_attempts
       SET attempt_status = 'ambiguous',
           finished_at = p_now,
           error_code = 'send_ambiguous',
           error_category = 'ambiguous',
           retryable = NULL,
           updated_at = now()
     WHERE id = v_att.id AND attempt_status = 'sending';
    UPDATE public.whatsapp_notifications
       SET status = 'failed',
           failed_at = p_now,
           last_error_code = 'send_ambiguous',
           next_attempt_at = NULL,
           claim_token = NULL,
           claimed_at = NULL,
           lease_expires_at = NULL,
           updated_at = now()
     WHERE id = v_notif.id AND status = 'processing';
    RETURN QUERY SELECT 'sending_ambiguous'::text; RETURN;
  END IF;

  -- Caso 4: ambiguous — quarentena
  IF v_att.attempt_status = 'ambiguous' THEN
    UPDATE public.whatsapp_notifications
       SET status = 'failed',
           failed_at = coalesce(failed_at, p_now),
           last_error_code = 'send_ambiguous',
           next_attempt_at = NULL,
           claim_token = NULL,
           claimed_at = NULL,
           lease_expires_at = NULL,
           updated_at = now()
     WHERE id = v_notif.id AND status = 'processing';
    RETURN QUERY SELECT 'ambiguous_quarantined'::text; RETURN;
  END IF;

  -- Caso 5: accepted — repara notification
  IF v_att.attempt_status = 'accepted' THEN
    UPDATE public.whatsapp_notifications
       SET status = 'sent',
           provider_message_id = coalesce(v_notif.provider_message_id, v_att.provider_message_id),
           sent_at = LEAST(coalesce(sent_at, p_now), p_now),
           claim_token = NULL,
           claimed_at = NULL,
           lease_expires_at = NULL,
           updated_at = now()
     WHERE id = v_notif.id AND status = 'processing';
    RETURN QUERY SELECT 'accepted_repaired'::text; RETURN;
  END IF;

  -- Caso 6: rejected — preserva falha
  IF v_att.attempt_status = 'rejected' THEN
    UPDATE public.whatsapp_notifications
       SET status = 'failed',
           failed_at = coalesce(failed_at, p_now),
           last_error_code = coalesce(last_error_code, v_att.error_code),
           next_attempt_at = NULL,
           claim_token = NULL,
           claimed_at = NULL,
           lease_expires_at = NULL,
           updated_at = now()
     WHERE id = v_notif.id AND status = 'processing';
    RETURN QUERY SELECT 'rejected_preserved'::text; RETURN;
  END IF;

  -- Caso 7: cancelled sem evidência de request iniciado — volta para pending
  IF v_att.attempt_status = 'cancelled' THEN
    UPDATE public.whatsapp_notifications
       SET status = 'pending',
           next_attempt_at = v_next,
           claim_token = NULL,
           claimed_at = NULL,
           lease_expires_at = NULL,
           updated_at = now()
     WHERE id = v_notif.id AND status = 'processing';
    RETURN QUERY SELECT 'cancelled_repending'::text; RETURN;
  END IF;

  RETURN QUERY SELECT 'noop'::text;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.whatsapp_notification_recover_with_attempt_atomic(uuid,timestamptz,interval) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.whatsapp_notification_recover_with_attempt_atomic(uuid,timestamptz,interval) FROM anon;
REVOKE EXECUTE ON FUNCTION public.whatsapp_notification_recover_with_attempt_atomic(uuid,timestamptz,interval) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_notification_recover_with_attempt_atomic(uuid,timestamptz,interval) TO service_role;
