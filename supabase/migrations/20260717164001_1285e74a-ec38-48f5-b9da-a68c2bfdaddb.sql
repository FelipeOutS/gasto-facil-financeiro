-- WA-C9.2 Fase E.4C — Guarda atômica anti-retry para attempts ambiguous.
--
-- Reescreve whatsapp_notification_recover_with_attempt_atomic para que
-- attempts com attempt_status='ambiguous' NUNCA sejam requalificadas para
-- retry, requeue nem alteradas de estado pelo recovery. A notification
-- permanece `processing` com lease expirado, e nenhuma UPDATE é emitida
-- sobre a linha nesse ramo.
--
-- Preserva:
--   * assinatura pública (uuid, timestamptz, interval) → TABLE(outcome text);
--   * SECURITY DEFINER;
--   * SET search_path = public;
--   * owner e grants (service_role apenas);
--   * casos 1, 2, 3, 5, 6, 7 idênticos ao contrato D.2A.
--
-- Altera apenas o Caso 4 (attempt ambiguous): retorna 'ambiguous_skipped'
-- sem UPDATE. A guarda é atômica porque ocorre dentro do mesmo bloco
-- transacional que faz SELECT ... FOR UPDATE da notification e da attempt,
-- e substitui o UPDATE anterior por um RETURN puro.
--
-- Não executa recovery em produção. Não altera notification/attempt reais.
-- Não amplia grants. Não cria tabelas, triggers, cron, tipos ou colunas.

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

  -- E.4C GUARDA ATÔMICA:
  -- Se existir QUALQUER attempt ambiguous não reconciliada vinculada a esta
  -- notification (independente do claim_token atual), o recovery é curto-
  -- circuitado ANTES de qualquer UPDATE. A notification permanece
  -- `processing` com lease expirado; nenhuma linha é alterada; nenhum
  -- claim é limpo; nenhum next_attempt_at é definido; nenhuma segunda
  -- attempt será criada em ciclos futuros por este caminho.
  --
  -- Uma attempt ambiguous é considerada "reconciliada" apenas se um
  -- callback posterior a promoveu para 'accepted' ou 'rejected' (nesse
  -- caso já não estará em 'ambiguous'). Portanto basta bloquear enquanto
  -- QUALQUER ambiguous persistir para a notification.
  IF EXISTS (
    SELECT 1
      FROM public.whatsapp_notification_attempts a
     WHERE a.notification_id = v_notif.id
       AND a.attempt_status = 'ambiguous'
  ) THEN
    RETURN QUERY SELECT 'ambiguous_skipped'::text; RETURN;
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

  -- Caso 4 (E.4C): attempt ambiguous já foi tratada pelo curto-circuito
  -- acima. Este ramo só seria acionado se o EXISTS falhasse, o que é
  -- inconsistente; mantemos como skipped defensivo, sem UPDATE.
  IF v_att.attempt_status = 'ambiguous' THEN
    RETURN QUERY SELECT 'ambiguous_skipped'::text; RETURN;
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

-- Grants inalterados (idempotente por segurança)
REVOKE EXECUTE ON FUNCTION public.whatsapp_notification_recover_with_attempt_atomic(uuid,timestamptz,interval) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.whatsapp_notification_recover_with_attempt_atomic(uuid,timestamptz,interval) FROM anon;
REVOKE EXECUTE ON FUNCTION public.whatsapp_notification_recover_with_attempt_atomic(uuid,timestamptz,interval) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_notification_recover_with_attempt_atomic(uuid,timestamptz,interval) TO service_role;