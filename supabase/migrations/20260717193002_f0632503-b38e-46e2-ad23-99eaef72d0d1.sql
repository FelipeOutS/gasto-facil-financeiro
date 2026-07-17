-- ============================================================================
-- WA-C11 FASE 3 — Quotas por plano + Kill Switch + Rollout
-- Schema + RPCs atomicas + seeds iniciais (runtime OFF, gratuitos zerados)
-- Sem DML em usuarios reais. Sem envio. Sem Graph.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) whatsapp_plan_quotas — configuracao por plano (uma linha ativa por plano)
-- ---------------------------------------------------------------------------
CREATE TABLE public.whatsapp_plan_quotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code text NOT NULL,
  inbound_monthly_limit integer NOT NULL DEFAULT 0,
  outbound_monthly_limit integer NOT NULL DEFAULT 0,
  financial_actions_monthly_limit integer NOT NULL DEFAULT 0,
  daily_inbound_limit integer NOT NULL DEFAULT 0,
  daily_outbound_limit integer NOT NULL DEFAULT 0,
  per_minute_limit integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT wa_pq_nonneg CHECK (
    inbound_monthly_limit >= 0 AND outbound_monthly_limit >= 0
    AND financial_actions_monthly_limit >= 0
    AND daily_inbound_limit >= 0 AND daily_outbound_limit >= 0
    AND per_minute_limit >= 0
  )
);
CREATE UNIQUE INDEX wa_pq_plan_enabled_uniq
  ON public.whatsapp_plan_quotas(plan_code) WHERE enabled;

GRANT ALL ON public.whatsapp_plan_quotas TO service_role;
ALTER TABLE public.whatsapp_plan_quotas ENABLE ROW LEVEL SECURITY;
-- Nenhuma policy: acesso somente via service_role (bypass RLS) e via RPCs.

-- ---------------------------------------------------------------------------
-- 2) whatsapp_usage_counters — contadores por usuario/ciclo
-- ---------------------------------------------------------------------------
CREATE TABLE public.whatsapp_usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_code text NOT NULL,
  cycle_start timestamptz NOT NULL,
  cycle_end timestamptz NOT NULL,
  inbound_used integer NOT NULL DEFAULT 0,
  outbound_reserved integer NOT NULL DEFAULT 0,
  outbound_committed integer NOT NULL DEFAULT 0,
  financial_actions_used integer NOT NULL DEFAULT 0,
  daily_bucket date NOT NULL,
  daily_inbound_used integer NOT NULL DEFAULT 0,
  daily_outbound_used integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wa_uc_nonneg CHECK (
    inbound_used >= 0 AND outbound_reserved >= 0 AND outbound_committed >= 0
    AND financial_actions_used >= 0
    AND daily_inbound_used >= 0 AND daily_outbound_used >= 0
  ),
  CONSTRAINT wa_uc_cycle_valid CHECK (cycle_end > cycle_start)
);
CREATE UNIQUE INDEX wa_uc_user_cycle_uniq
  ON public.whatsapp_usage_counters(user_id, cycle_start);
CREATE INDEX wa_uc_user_daily_idx
  ON public.whatsapp_usage_counters(user_id, daily_bucket);

GRANT ALL ON public.whatsapp_usage_counters TO service_role;
ALTER TABLE public.whatsapp_usage_counters ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3) whatsapp_usage_events — ledger idempotente
-- ---------------------------------------------------------------------------
CREATE TABLE public.whatsapp_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  usage_type text NOT NULL,
  units integer NOT NULL DEFAULT 1,
  idempotency_key text NOT NULL,
  notification_id uuid,
  provider_message_id text,
  inbound_message_id text,
  state text NOT NULL,
  cycle_start timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  released_at timestamptz,
  reason text,
  CONSTRAINT wa_ue_state_valid CHECK (
    state IN ('consumed','reserved','committed','released','ambiguous')
  ),
  CONSTRAINT wa_ue_type_valid CHECK (
    usage_type IN ('inbound','outbound','financial_action')
  ),
  CONSTRAINT wa_ue_units_positive CHECK (units > 0)
);
CREATE UNIQUE INDEX wa_ue_idem_uniq ON public.whatsapp_usage_events(idempotency_key);
CREATE INDEX wa_ue_user_cycle_idx
  ON public.whatsapp_usage_events(user_id, cycle_start, usage_type);

GRANT ALL ON public.whatsapp_usage_events TO service_role;
ALTER TABLE public.whatsapp_usage_events ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4) whatsapp_runtime_config — singleton kill switch + rollout
-- ---------------------------------------------------------------------------
CREATE TABLE public.whatsapp_runtime_config (
  id smallint PRIMARY KEY DEFAULT 1,
  global_enabled boolean NOT NULL DEFAULT false,
  inbound_enabled boolean NOT NULL DEFAULT false,
  outbound_enabled boolean NOT NULL DEFAULT false,
  notification_creation_enabled boolean NOT NULL DEFAULT false,
  new_links_enabled boolean NOT NULL DEFAULT false,
  rollout_enabled boolean NOT NULL DEFAULT false,
  rollout_percentage integer NOT NULL DEFAULT 0,
  global_daily_outbound_limit integer NOT NULL DEFAULT 0,
  maintenance_message_enabled boolean NOT NULL DEFAULT false,
  reason text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wa_rc_singleton CHECK (id = 1),
  CONSTRAINT wa_rc_pct CHECK (rollout_percentage BETWEEN 0 AND 100),
  CONSTRAINT wa_rc_daily_nonneg CHECK (global_daily_outbound_limit >= 0)
);
GRANT ALL ON public.whatsapp_runtime_config TO service_role;
ALTER TABLE public.whatsapp_runtime_config ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5) whatsapp_runtime_config_audit — historico de mudancas
-- ---------------------------------------------------------------------------
CREATE TABLE public.whatsapp_runtime_config_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  fields_changed text[] NOT NULL DEFAULT '{}',
  previous_value jsonb NOT NULL,
  new_value jsonb NOT NULL,
  reason text,
  correlation_id text
);
CREATE INDEX wa_rca_time_idx ON public.whatsapp_runtime_config_audit(changed_at DESC);
GRANT ALL ON public.whatsapp_runtime_config_audit TO service_role;
ALTER TABLE public.whatsapp_runtime_config_audit ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 6) Trigger updated_at + auditoria automatica de runtime_config
-- ---------------------------------------------------------------------------
CREATE TRIGGER wa_pq_updated_at BEFORE UPDATE ON public.whatsapp_plan_quotas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER wa_uc_updated_at BEFORE UPDATE ON public.whatsapp_usage_counters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER wa_rc_updated_at BEFORE UPDATE ON public.whatsapp_runtime_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.tg_whatsapp_runtime_config_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_fields text[] := '{}';
BEGIN
  IF (OLD.global_enabled IS DISTINCT FROM NEW.global_enabled) THEN v_fields := array_append(v_fields, 'global_enabled'); END IF;
  IF (OLD.inbound_enabled IS DISTINCT FROM NEW.inbound_enabled) THEN v_fields := array_append(v_fields, 'inbound_enabled'); END IF;
  IF (OLD.outbound_enabled IS DISTINCT FROM NEW.outbound_enabled) THEN v_fields := array_append(v_fields, 'outbound_enabled'); END IF;
  IF (OLD.notification_creation_enabled IS DISTINCT FROM NEW.notification_creation_enabled) THEN v_fields := array_append(v_fields, 'notification_creation_enabled'); END IF;
  IF (OLD.new_links_enabled IS DISTINCT FROM NEW.new_links_enabled) THEN v_fields := array_append(v_fields, 'new_links_enabled'); END IF;
  IF (OLD.rollout_enabled IS DISTINCT FROM NEW.rollout_enabled) THEN v_fields := array_append(v_fields, 'rollout_enabled'); END IF;
  IF (OLD.rollout_percentage IS DISTINCT FROM NEW.rollout_percentage) THEN v_fields := array_append(v_fields, 'rollout_percentage'); END IF;
  IF (OLD.global_daily_outbound_limit IS DISTINCT FROM NEW.global_daily_outbound_limit) THEN v_fields := array_append(v_fields, 'global_daily_outbound_limit'); END IF;
  IF (OLD.maintenance_message_enabled IS DISTINCT FROM NEW.maintenance_message_enabled) THEN v_fields := array_append(v_fields, 'maintenance_message_enabled'); END IF;
  IF (OLD.reason IS DISTINCT FROM NEW.reason) THEN v_fields := array_append(v_fields, 'reason'); END IF;

  IF array_length(v_fields, 1) IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.whatsapp_runtime_config_audit(
    changed_by, fields_changed, previous_value, new_value, reason
  ) VALUES (
    NEW.updated_by, v_fields,
    to_jsonb(OLD.*) - 'updated_at',
    to_jsonb(NEW.*) - 'updated_at',
    NEW.reason
  );
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER wa_rc_audit AFTER UPDATE ON public.whatsapp_runtime_config
  FOR EACH ROW EXECUTE FUNCTION public.tg_whatsapp_runtime_config_audit();

-- ---------------------------------------------------------------------------
-- 7) Helper: rollout deterministico por hash do user_id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.whatsapp_user_in_rollout(_user_id uuid, _pct integer)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $fn$
  SELECT CASE
    WHEN _user_id IS NULL OR _pct IS NULL OR _pct <= 0 THEN false
    WHEN _pct >= 100 THEN true
    ELSE (abs(hashtextextended(_user_id::text, 42)) % 100) < _pct
  END;
$fn$;

-- ---------------------------------------------------------------------------
-- 8) RPC: consume inbound quota (idempotente por inbound_message_id)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.whatsapp_consume_inbound_quota_atomic(
  p_user_id uuid,
  p_inbound_message_id text,
  p_plan_code text,
  p_cycle_start timestamptz,
  p_cycle_end timestamptz,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(
  allowed boolean, reason text, "limit" integer, used integer, remaining integer,
  cycle_start timestamptz, cycle_end timestamptz, duplicate boolean, state text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_q public.whatsapp_plan_quotas%ROWTYPE;
  v_c public.whatsapp_usage_counters%ROWTYPE;
  v_today date := (p_now AT TIME ZONE 'America/Sao_Paulo')::date;
  v_idem text := 'inbound:' || p_inbound_message_id;
  v_existing_state text;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;
  IF p_user_id IS NULL OR p_inbound_message_id IS NULL OR p_plan_code IS NULL THEN
    RETURN QUERY SELECT false,'invalid_params'::text,0,0,0,p_cycle_start,p_cycle_end,false,NULL::text; RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('wa_usage:'||p_user_id::text, 0));

  -- idempotencia
  SELECT state INTO v_existing_state FROM public.whatsapp_usage_events
   WHERE idempotency_key = v_idem;
  IF FOUND THEN
    SELECT * INTO v_c FROM public.whatsapp_usage_counters
     WHERE user_id=p_user_id AND cycle_start=p_cycle_start;
    SELECT * INTO v_q FROM public.whatsapp_plan_quotas
     WHERE plan_code=p_plan_code AND enabled ORDER BY updated_at DESC LIMIT 1;
    RETURN QUERY SELECT true,'allowed'::text,
      COALESCE(v_q.inbound_monthly_limit,0), COALESCE(v_c.inbound_used,0),
      GREATEST(COALESCE(v_q.inbound_monthly_limit,0)-COALESCE(v_c.inbound_used,0),0),
      p_cycle_start,p_cycle_end,true,v_existing_state; RETURN;
  END IF;

  SELECT * INTO v_q FROM public.whatsapp_plan_quotas
   WHERE plan_code=p_plan_code AND enabled ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false,'quota_not_configured'::text,0,0,0,p_cycle_start,p_cycle_end,false,NULL::text; RETURN;
  END IF;
  IF v_q.inbound_monthly_limit = 0 THEN
    RETURN QUERY SELECT false,'plan_not_eligible'::text,0,0,0,p_cycle_start,p_cycle_end,false,NULL::text; RETURN;
  END IF;

  INSERT INTO public.whatsapp_usage_counters(
    user_id, plan_code, cycle_start, cycle_end, daily_bucket
  ) VALUES (p_user_id, p_plan_code, p_cycle_start, p_cycle_end, v_today)
  ON CONFLICT (user_id, cycle_start) DO NOTHING;

  SELECT * INTO v_c FROM public.whatsapp_usage_counters
   WHERE user_id=p_user_id AND cycle_start=p_cycle_start FOR UPDATE;

  -- reset daily bucket se rolou o dia
  IF v_c.daily_bucket <> v_today THEN
    UPDATE public.whatsapp_usage_counters
       SET daily_bucket=v_today, daily_inbound_used=0, daily_outbound_used=0
     WHERE id=v_c.id;
    v_c.daily_bucket := v_today; v_c.daily_inbound_used := 0; v_c.daily_outbound_used := 0;
  END IF;

  IF v_c.inbound_used >= v_q.inbound_monthly_limit THEN
    RETURN QUERY SELECT false,'monthly_limit_reached'::text,
      v_q.inbound_monthly_limit, v_c.inbound_used, 0,
      p_cycle_start,p_cycle_end,false,NULL::text; RETURN;
  END IF;
  IF v_q.daily_inbound_limit > 0 AND v_c.daily_inbound_used >= v_q.daily_inbound_limit THEN
    RETURN QUERY SELECT false,'daily_limit_reached'::text,
      v_q.daily_inbound_limit, v_c.daily_inbound_used, 0,
      p_cycle_start,p_cycle_end,false,NULL::text; RETURN;
  END IF;

  UPDATE public.whatsapp_usage_counters
     SET inbound_used = inbound_used + 1,
         daily_inbound_used = daily_inbound_used + 1
   WHERE id = v_c.id
   RETURNING * INTO v_c;

  INSERT INTO public.whatsapp_usage_events(
    user_id, usage_type, units, idempotency_key,
    inbound_message_id, state, cycle_start, committed_at
  ) VALUES (
    p_user_id, 'inbound', 1, v_idem, p_inbound_message_id,
    'consumed', p_cycle_start, p_now
  );

  RETURN QUERY SELECT true,'allowed'::text,
    v_q.inbound_monthly_limit, v_c.inbound_used,
    GREATEST(v_q.inbound_monthly_limit - v_c.inbound_used, 0),
    p_cycle_start, p_cycle_end, false, 'consumed'::text;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 9) RPC: consume financial action quota
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.whatsapp_consume_financial_action_quota_atomic(
  p_user_id uuid,
  p_idempotency_key text,
  p_plan_code text,
  p_cycle_start timestamptz,
  p_cycle_end timestamptz,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(
  allowed boolean, reason text, "limit" integer, used integer, remaining integer,
  cycle_start timestamptz, cycle_end timestamptz, duplicate boolean, state text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_q public.whatsapp_plan_quotas%ROWTYPE;
  v_c public.whatsapp_usage_counters%ROWTYPE;
  v_today date := (p_now AT TIME ZONE 'America/Sao_Paulo')::date;
  v_idem text := 'fin:' || p_idempotency_key;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wa_usage:'||p_user_id::text, 0));

  IF EXISTS(SELECT 1 FROM public.whatsapp_usage_events WHERE idempotency_key=v_idem) THEN
    SELECT * INTO v_q FROM public.whatsapp_plan_quotas WHERE plan_code=p_plan_code AND enabled ORDER BY updated_at DESC LIMIT 1;
    SELECT * INTO v_c FROM public.whatsapp_usage_counters WHERE user_id=p_user_id AND cycle_start=p_cycle_start;
    RETURN QUERY SELECT true,'allowed'::text,
      COALESCE(v_q.financial_actions_monthly_limit,0), COALESCE(v_c.financial_actions_used,0),
      GREATEST(COALESCE(v_q.financial_actions_monthly_limit,0)-COALESCE(v_c.financial_actions_used,0),0),
      p_cycle_start,p_cycle_end,true,'consumed'::text; RETURN;
  END IF;

  SELECT * INTO v_q FROM public.whatsapp_plan_quotas WHERE plan_code=p_plan_code AND enabled ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false,'quota_not_configured'::text,0,0,0,p_cycle_start,p_cycle_end,false,NULL::text; RETURN;
  END IF;
  IF v_q.financial_actions_monthly_limit = 0 THEN
    RETURN QUERY SELECT false,'plan_not_eligible'::text,0,0,0,p_cycle_start,p_cycle_end,false,NULL::text; RETURN;
  END IF;

  INSERT INTO public.whatsapp_usage_counters(user_id,plan_code,cycle_start,cycle_end,daily_bucket)
  VALUES (p_user_id,p_plan_code,p_cycle_start,p_cycle_end,v_today)
  ON CONFLICT (user_id,cycle_start) DO NOTHING;

  SELECT * INTO v_c FROM public.whatsapp_usage_counters
   WHERE user_id=p_user_id AND cycle_start=p_cycle_start FOR UPDATE;

  IF v_c.financial_actions_used >= v_q.financial_actions_monthly_limit THEN
    RETURN QUERY SELECT false,'monthly_limit_reached'::text,
      v_q.financial_actions_monthly_limit, v_c.financial_actions_used, 0,
      p_cycle_start,p_cycle_end,false,NULL::text; RETURN;
  END IF;

  UPDATE public.whatsapp_usage_counters
     SET financial_actions_used = financial_actions_used + 1
   WHERE id=v_c.id RETURNING * INTO v_c;

  INSERT INTO public.whatsapp_usage_events(
    user_id,usage_type,units,idempotency_key,state,cycle_start,committed_at
  ) VALUES (p_user_id,'financial_action',1,v_idem,'consumed',p_cycle_start,p_now);

  RETURN QUERY SELECT true,'allowed'::text,
    v_q.financial_actions_monthly_limit, v_c.financial_actions_used,
    GREATEST(v_q.financial_actions_monthly_limit - v_c.financial_actions_used, 0),
    p_cycle_start, p_cycle_end, false, 'consumed'::text;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 10) RPC: reserve outbound quota
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.whatsapp_reserve_outbound_quota_atomic(
  p_user_id uuid,
  p_notification_id uuid,
  p_plan_code text,
  p_cycle_start timestamptz,
  p_cycle_end timestamptz,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(
  allowed boolean, reason text, "limit" integer, used integer, remaining integer,
  cycle_start timestamptz, cycle_end timestamptz, reservation_id uuid, duplicate boolean, state text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_q public.whatsapp_plan_quotas%ROWTYPE;
  v_c public.whatsapp_usage_counters%ROWTYPE;
  v_today date := (p_now AT TIME ZONE 'America/Sao_Paulo')::date;
  v_idem text := 'outbound:' || p_notification_id::text;
  v_existing_id uuid; v_existing_state text;
  v_rid uuid;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wa_usage:'||p_user_id::text, 0));

  SELECT id,state INTO v_existing_id,v_existing_state FROM public.whatsapp_usage_events
   WHERE idempotency_key=v_idem;
  IF FOUND THEN
    SELECT * INTO v_q FROM public.whatsapp_plan_quotas WHERE plan_code=p_plan_code AND enabled ORDER BY updated_at DESC LIMIT 1;
    SELECT * INTO v_c FROM public.whatsapp_usage_counters WHERE user_id=p_user_id AND cycle_start=p_cycle_start;
    RETURN QUERY SELECT (v_existing_state IN ('reserved','committed','ambiguous')),
      'allowed'::text,
      COALESCE(v_q.outbound_monthly_limit,0),
      COALESCE(v_c.outbound_reserved,0)+COALESCE(v_c.outbound_committed,0),
      GREATEST(COALESCE(v_q.outbound_monthly_limit,0)-COALESCE(v_c.outbound_reserved,0)-COALESCE(v_c.outbound_committed,0),0),
      p_cycle_start,p_cycle_end,v_existing_id,true,v_existing_state; RETURN;
  END IF;

  SELECT * INTO v_q FROM public.whatsapp_plan_quotas WHERE plan_code=p_plan_code AND enabled ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false,'quota_not_configured'::text,0,0,0,p_cycle_start,p_cycle_end,NULL::uuid,false,NULL::text; RETURN;
  END IF;
  IF v_q.outbound_monthly_limit = 0 THEN
    RETURN QUERY SELECT false,'plan_not_eligible'::text,0,0,0,p_cycle_start,p_cycle_end,NULL::uuid,false,NULL::text; RETURN;
  END IF;

  INSERT INTO public.whatsapp_usage_counters(user_id,plan_code,cycle_start,cycle_end,daily_bucket)
  VALUES (p_user_id,p_plan_code,p_cycle_start,p_cycle_end,v_today)
  ON CONFLICT (user_id,cycle_start) DO NOTHING;

  SELECT * INTO v_c FROM public.whatsapp_usage_counters
   WHERE user_id=p_user_id AND cycle_start=p_cycle_start FOR UPDATE;

  IF v_c.daily_bucket <> v_today THEN
    UPDATE public.whatsapp_usage_counters
       SET daily_bucket=v_today, daily_inbound_used=0, daily_outbound_used=0
     WHERE id=v_c.id;
    v_c.daily_bucket:=v_today; v_c.daily_outbound_used:=0;
  END IF;

  IF (v_c.outbound_reserved + v_c.outbound_committed) >= v_q.outbound_monthly_limit THEN
    RETURN QUERY SELECT false,'monthly_limit_reached'::text,
      v_q.outbound_monthly_limit, v_c.outbound_reserved+v_c.outbound_committed, 0,
      p_cycle_start,p_cycle_end,NULL::uuid,false,NULL::text; RETURN;
  END IF;
  IF v_q.daily_outbound_limit > 0 AND v_c.daily_outbound_used >= v_q.daily_outbound_limit THEN
    RETURN QUERY SELECT false,'daily_limit_reached'::text,
      v_q.daily_outbound_limit, v_c.daily_outbound_used, 0,
      p_cycle_start,p_cycle_end,NULL::uuid,false,NULL::text; RETURN;
  END IF;

  UPDATE public.whatsapp_usage_counters
     SET outbound_reserved = outbound_reserved + 1,
         daily_outbound_used = daily_outbound_used + 1
   WHERE id=v_c.id RETURNING * INTO v_c;

  INSERT INTO public.whatsapp_usage_events(
    user_id,usage_type,units,idempotency_key,notification_id,state,cycle_start
  ) VALUES (p_user_id,'outbound',1,v_idem,p_notification_id,'reserved',p_cycle_start)
  RETURNING id INTO v_rid;

  RETURN QUERY SELECT true,'allowed'::text,
    v_q.outbound_monthly_limit,
    v_c.outbound_reserved + v_c.outbound_committed,
    GREATEST(v_q.outbound_monthly_limit - v_c.outbound_reserved - v_c.outbound_committed, 0),
    p_cycle_start, p_cycle_end, v_rid, false, 'reserved'::text;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 11) RPC: commit outbound (reserved -> committed)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.whatsapp_commit_outbound_quota_atomic(
  p_user_id uuid,
  p_notification_id uuid,
  p_provider_message_id text,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(outcome text, state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_idem text := 'outbound:' || p_notification_id::text;
  v_ev public.whatsapp_usage_events%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wa_usage:'||p_user_id::text, 0));

  SELECT * INTO v_ev FROM public.whatsapp_usage_events
   WHERE idempotency_key=v_idem FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text; RETURN;
  END IF;
  IF v_ev.state = 'committed' THEN
    RETURN QUERY SELECT 'noop'::text, 'committed'::text; RETURN;
  END IF;
  IF v_ev.state NOT IN ('reserved','ambiguous') THEN
    RETURN QUERY SELECT 'invalid_state'::text, v_ev.state; RETURN;
  END IF;

  UPDATE public.whatsapp_usage_events
     SET state='committed', committed_at=p_now, provider_message_id=p_provider_message_id
   WHERE id=v_ev.id;

  UPDATE public.whatsapp_usage_counters
     SET outbound_reserved = GREATEST(outbound_reserved - 1, 0),
         outbound_committed = outbound_committed + 1
   WHERE user_id=p_user_id AND cycle_start=v_ev.cycle_start;

  RETURN QUERY SELECT 'committed'::text, 'committed'::text;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 12) RPC: release outbound (reserved -> released) — apenas com prova de nao envio
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.whatsapp_release_outbound_quota_atomic(
  p_user_id uuid,
  p_notification_id uuid,
  p_reason text,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(outcome text, state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_idem text := 'outbound:' || p_notification_id::text;
  v_ev public.whatsapp_usage_events%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wa_usage:'||p_user_id::text, 0));

  SELECT * INTO v_ev FROM public.whatsapp_usage_events
   WHERE idempotency_key=v_idem FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text; RETURN;
  END IF;
  IF v_ev.state = 'released' THEN
    RETURN QUERY SELECT 'noop'::text, 'released'::text; RETURN;
  END IF;
  -- ambiguous NUNCA libera (regra da fase 3)
  IF v_ev.state <> 'reserved' THEN
    RETURN QUERY SELECT 'invalid_state'::text, v_ev.state; RETURN;
  END IF;

  UPDATE public.whatsapp_usage_events
     SET state='released', released_at=p_now, reason=coalesce(p_reason,'released')
   WHERE id=v_ev.id;

  UPDATE public.whatsapp_usage_counters
     SET outbound_reserved = GREATEST(outbound_reserved - 1, 0),
         daily_outbound_used = GREATEST(daily_outbound_used - 1, 0)
   WHERE user_id=p_user_id AND cycle_start=v_ev.cycle_start;

  RETURN QUERY SELECT 'released'::text, 'released'::text;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 13) RPC: usage snapshot
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.whatsapp_get_usage_snapshot(
  p_user_id uuid,
  p_plan_code text,
  p_cycle_start timestamptz,
  p_cycle_end timestamptz
)
RETURNS TABLE(
  plan_code text,
  inbound_limit integer, inbound_used integer,
  outbound_limit integer, outbound_reserved integer, outbound_committed integer,
  financial_limit integer, financial_used integer,
  daily_inbound_limit integer, daily_inbound_used integer,
  daily_outbound_limit integer, daily_outbound_used integer,
  cycle_start timestamptz, cycle_end timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_q public.whatsapp_plan_quotas%ROWTYPE;
  v_c public.whatsapp_usage_counters%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_q FROM public.whatsapp_plan_quotas
   WHERE plan_code=p_plan_code AND enabled ORDER BY updated_at DESC LIMIT 1;
  SELECT * INTO v_c FROM public.whatsapp_usage_counters
   WHERE user_id=p_user_id AND cycle_start=p_cycle_start;

  RETURN QUERY SELECT
    p_plan_code,
    COALESCE(v_q.inbound_monthly_limit,0),   COALESCE(v_c.inbound_used,0),
    COALESCE(v_q.outbound_monthly_limit,0),  COALESCE(v_c.outbound_reserved,0), COALESCE(v_c.outbound_committed,0),
    COALESCE(v_q.financial_actions_monthly_limit,0), COALESCE(v_c.financial_actions_used,0),
    COALESCE(v_q.daily_inbound_limit,0),     COALESCE(v_c.daily_inbound_used,0),
    COALESCE(v_q.daily_outbound_limit,0),    COALESCE(v_c.daily_outbound_used,0),
    p_cycle_start, p_cycle_end;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 14) Revogar EXECUTE de PUBLIC e conceder somente para service_role
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.whatsapp_consume_inbound_quota_atomic(uuid,text,text,timestamptz,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_consume_financial_action_quota_atomic(uuid,text,text,timestamptz,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_reserve_outbound_quota_atomic(uuid,uuid,text,timestamptz,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_commit_outbound_quota_atomic(uuid,uuid,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_release_outbound_quota_atomic(uuid,uuid,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_get_usage_snapshot(uuid,text,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_user_in_rollout(uuid,integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.whatsapp_consume_inbound_quota_atomic(uuid,text,text,timestamptz,timestamptz,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_consume_financial_action_quota_atomic(uuid,text,text,timestamptz,timestamptz,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_reserve_outbound_quota_atomic(uuid,uuid,text,timestamptz,timestamptz,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_commit_outbound_quota_atomic(uuid,uuid,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_release_outbound_quota_atomic(uuid,uuid,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_get_usage_snapshot(uuid,text,timestamptz,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_user_in_rollout(uuid,integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 15) Seeds: singleton runtime_config OFF + quotas iniciais (beta defaults)
-- ---------------------------------------------------------------------------
INSERT INTO public.whatsapp_runtime_config (id, reason) VALUES (1, 'phase3_bootstrap_off')
ON CONFLICT (id) DO NOTHING;

-- Gratuitos/nao-elegiveis: quota zero explicita.
INSERT INTO public.whatsapp_plan_quotas (plan_code, notes) VALUES
  ('free',            'phase3_beta_zero'),
  ('free_ads',        'phase3_beta_zero'),
  ('sem_assinatura',  'phase3_beta_zero'),
  ('pessoal_manual',  'phase3_beta_zero')
ON CONFLICT DO NOTHING;

-- Planos elegiveis: defaults conservadores do beta (Secao 3 do prompt)
INSERT INTO public.whatsapp_plan_quotas
  (plan_code, inbound_monthly_limit, outbound_monthly_limit, financial_actions_monthly_limit,
   daily_inbound_limit, daily_outbound_limit, per_minute_limit, notes)
VALUES
  ('pessoal_premium', 150,  75,  100,  30,  15, 10, 'phase3_beta_default'),
  ('mei_essencial',   400,  150, 250,  60,  30, 15, 'phase3_beta_default'),
  ('mei_inteligente', 900,  350, 600,  120, 60, 20, 'phase3_beta_default'),
  ('empresa',         2500, 1000,1800, 300, 150,30, 'phase3_beta_default')
ON CONFLICT DO NOTHING;