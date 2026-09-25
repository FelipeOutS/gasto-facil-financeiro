CREATE OR REPLACE FUNCTION public.whatsapp_consume_inbound_quota_atomic(
  p_user_id uuid,
  p_inbound_message_id text,
  p_plan_code text,
  p_cycle_start timestamptz,
  p_cycle_end timestamptz,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(
  allowed boolean,
  reason text,
  "limit" integer,
  used integer,
  remaining integer,
  cycle_start timestamptz,
  cycle_end timestamptz,
  duplicate boolean,
  state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_q public.whatsapp_plan_quotas%ROWTYPE;
  v_c public.whatsapp_usage_counters%ROWTYPE;
  v_today date := (p_now AT TIME ZONE 'America/Sao_Paulo')::date;
  v_idem text := 'inbound:' || p_inbound_message_id;
  v_existing_state text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_inbound_message_id IS NULL OR p_plan_code IS NULL THEN
    RETURN QUERY SELECT false, 'invalid_params'::text, 0, 0, 0, p_cycle_start, p_cycle_end, false, NULL::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('wa_usage:' || p_user_id::text, 0));

  SELECT wue.state INTO v_existing_state
  FROM public.whatsapp_usage_events AS wue
  WHERE wue.idempotency_key = v_idem;

  IF FOUND THEN
    SELECT wuc.* INTO v_c
    FROM public.whatsapp_usage_counters AS wuc
    WHERE wuc.user_id = p_user_id
      AND wuc.cycle_start = p_cycle_start;

    SELECT wpq.* INTO v_q
    FROM public.whatsapp_plan_quotas AS wpq
    WHERE wpq.plan_code = p_plan_code
      AND wpq.enabled
    ORDER BY wpq.updated_at DESC
    LIMIT 1;

    RETURN QUERY SELECT true, 'allowed'::text,
      COALESCE(v_q.inbound_monthly_limit, 0), COALESCE(v_c.inbound_used, 0),
      GREATEST(COALESCE(v_q.inbound_monthly_limit, 0) - COALESCE(v_c.inbound_used, 0), 0),
      p_cycle_start, p_cycle_end, true, v_existing_state;
    RETURN;
  END IF;

  SELECT wpq.* INTO v_q
  FROM public.whatsapp_plan_quotas AS wpq
  WHERE wpq.plan_code = p_plan_code
    AND wpq.enabled
  ORDER BY wpq.updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'quota_not_configured'::text, 0, 0, 0, p_cycle_start, p_cycle_end, false, NULL::text;
    RETURN;
  END IF;

  IF v_q.inbound_monthly_limit = 0 THEN
    RETURN QUERY SELECT false, 'plan_not_eligible'::text, 0, 0, 0, p_cycle_start, p_cycle_end, false, NULL::text;
    RETURN;
  END IF;

  INSERT INTO public.whatsapp_usage_counters(
    user_id, plan_code, cycle_start, cycle_end, daily_bucket
  ) VALUES (p_user_id, p_plan_code, p_cycle_start, p_cycle_end, v_today)
  ON CONFLICT (user_id, cycle_start) DO NOTHING;

  SELECT wuc.* INTO v_c
  FROM public.whatsapp_usage_counters AS wuc
  WHERE wuc.user_id = p_user_id
    AND wuc.cycle_start = p_cycle_start
  FOR UPDATE;

  IF v_c.daily_bucket <> v_today THEN
    UPDATE public.whatsapp_usage_counters AS wuc
       SET daily_bucket = v_today,
           daily_inbound_used = 0,
           daily_outbound_used = 0
     WHERE wuc.id = v_c.id
     RETURNING wuc.* INTO v_c;
  END IF;

  IF v_c.inbound_used >= v_q.inbound_monthly_limit THEN
    RETURN QUERY SELECT false, 'monthly_limit_reached'::text,
      v_q.inbound_monthly_limit, v_c.inbound_used, 0,
      p_cycle_start, p_cycle_end, false, NULL::text;
    RETURN;
  END IF;

  IF v_q.daily_inbound_limit > 0 AND v_c.daily_inbound_used >= v_q.daily_inbound_limit THEN
    RETURN QUERY SELECT false, 'daily_limit_reached'::text,
      v_q.daily_inbound_limit, v_c.daily_inbound_used, 0,
      p_cycle_start, p_cycle_end, false, NULL::text;
    RETURN;
  END IF;

  UPDATE public.whatsapp_usage_counters AS wuc
     SET inbound_used = wuc.inbound_used + 1,
         daily_inbound_used = wuc.daily_inbound_used + 1
   WHERE wuc.id = v_c.id
   RETURNING wuc.* INTO v_c;

  INSERT INTO public.whatsapp_usage_events(
    user_id, usage_type, units, idempotency_key,
    inbound_message_id, state, cycle_start, committed_at
  ) VALUES (
    p_user_id, 'inbound', 1, v_idem, p_inbound_message_id,
    'consumed', p_cycle_start, p_now
  );

  RETURN QUERY SELECT true, 'allowed'::text,
    v_q.inbound_monthly_limit, v_c.inbound_used,
    GREATEST(v_q.inbound_monthly_limit - v_c.inbound_used, 0),
    p_cycle_start, p_cycle_end, false, 'consumed'::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.whatsapp_consume_inbound_quota_atomic(uuid, text, text, timestamptz, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_consume_inbound_quota_atomic(uuid, text, text, timestamptz, timestamptz, timestamptz) TO service_role;