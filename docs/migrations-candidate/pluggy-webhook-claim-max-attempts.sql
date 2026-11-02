-- CANDIDATA — NÃO APLICADA. Corrige: evento cujo processamento trava e cuja
-- reserva expira não pode ultrapassar max_attempts. Antes de reservar, eventos
-- 'processando' com lease vencido e attempts >= max_attempts viram 'esgotado'.
CREATE OR REPLACE FUNCTION public.pluggy_webhook_claim(p_limit integer, p_lease_seconds integer)
RETURNS TABLE (id uuid, event text, item_id text, transaction_ids text[], attempts integer, max_attempts integer, claim_token uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_token uuid := gen_random_uuid();
BEGIN
  UPDATE public.pluggy_webhook_events e
     SET status = 'esgotado', error = 'reserva_expirada_limite', locked_until = NULL, claim_token = NULL
   WHERE e.status = 'processando' AND e.locked_until < now() AND e.attempts >= e.max_attempts;

  RETURN QUERY
  WITH due AS (
    SELECT e.id FROM public.pluggy_webhook_events e
    WHERE ((e.status IN ('pendente', 'falhou') AND e.next_attempt_at <= now())
        OR (e.status = 'processando' AND e.locked_until < now()))
      AND e.attempts < e.max_attempts
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
REVOKE ALL ON FUNCTION public.pluggy_webhook_claim(integer, integer) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.pluggy_webhook_claim(integer, integer) FROM sandbox_exec';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.pluggy_webhook_claim(integer, integer) TO service_role;
