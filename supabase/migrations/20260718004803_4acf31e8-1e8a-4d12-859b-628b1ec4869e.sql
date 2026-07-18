
-- WA-C11 Fase 3B.2.E — Ambiguous transition + callback reconciliation

CREATE OR REPLACE FUNCTION public.whatsapp_mark_reservation_ambiguous_atomic(
  p_user_id uuid,
  p_notification_id uuid,
  p_reason text,
  p_now timestamptz DEFAULT now()
) RETURNS TABLE(outcome text, state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_idem text := 'outbound:' || p_notification_id::text;
  v_ev public.whatsapp_usage_events%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wa_usage:'||p_user_id::text, 0));

  SELECT * INTO v_ev FROM public.whatsapp_usage_events
   WHERE idempotency_key = v_idem FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text; RETURN;
  END IF;
  IF v_ev.state = 'ambiguous' THEN
    RETURN QUERY SELECT 'noop'::text, 'ambiguous'::text; RETURN;
  END IF;
  IF v_ev.state <> 'reserved' THEN
    -- committed ou released: não regride.
    RETURN QUERY SELECT 'invalid_state'::text, v_ev.state; RETURN;
  END IF;

  UPDATE public.whatsapp_usage_events
     SET state = 'ambiguous',
         reason = coalesce(p_reason, 'transport_ambiguous')
   WHERE id = v_ev.id;

  -- Counters permanecem (reserved segue contando como consumo; ambiguous
  -- não devolve). Apenas mantemos consistência do state.
  RETURN QUERY SELECT 'ambiguous'::text, 'ambiguous'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_mark_reservation_ambiguous_atomic(uuid,uuid,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_mark_reservation_ambiguous_atomic(uuid,uuid,text,timestamptz) TO service_role;


CREATE OR REPLACE FUNCTION public.whatsapp_reconcile_reservation_from_callback_atomic(
  p_user_id uuid,
  p_notification_id uuid,
  p_provider_message_id text,
  p_now timestamptz DEFAULT now()
) RETURNS TABLE(outcome text, state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_idem text := 'outbound:' || p_notification_id::text;
  v_ev public.whatsapp_usage_events%ROWTYPE;
  v_pmid text;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;
  v_pmid := nullif(btrim(p_provider_message_id), '');
  IF v_pmid IS NULL OR length(v_pmid) > 256 OR v_pmid ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'invalid_provider_message_id' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('wa_usage:'||p_user_id::text, 0));

  SELECT * INTO v_ev FROM public.whatsapp_usage_events
   WHERE idempotency_key = v_idem FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text; RETURN;
  END IF;

  IF v_ev.state = 'committed' THEN
    IF v_ev.provider_message_id IS NULL THEN
      UPDATE public.whatsapp_usage_events SET provider_message_id = v_pmid WHERE id = v_ev.id;
    ELSIF v_ev.provider_message_id <> v_pmid THEN
      RETURN QUERY SELECT 'conflict_pmid'::text, 'committed'::text; RETURN;
    END IF;
    RETURN QUERY SELECT 'noop'::text, 'committed'::text; RETURN;
  END IF;

  IF v_ev.state NOT IN ('reserved','ambiguous') THEN
    -- released: não pode voltar. Callback pós-release é vestigial.
    RETURN QUERY SELECT 'invalid_state'::text, v_ev.state; RETURN;
  END IF;

  UPDATE public.whatsapp_usage_events
     SET state = 'committed',
         committed_at = p_now,
         provider_message_id = v_pmid,
         reason = 'reconciled_from_callback'
   WHERE id = v_ev.id;

  UPDATE public.whatsapp_usage_counters
     SET outbound_reserved = GREATEST(outbound_reserved - 1, 0),
         outbound_committed = outbound_committed + 1
   WHERE user_id = p_user_id AND cycle_start = v_ev.cycle_start;

  RETURN QUERY SELECT 'reconciled'::text, 'committed'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_reconcile_reservation_from_callback_atomic(uuid,uuid,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_reconcile_reservation_from_callback_atomic(uuid,uuid,text,timestamptz) TO service_role;
