-- WA-C11 FASE 2.1A — Billing atomic apply + entitlement-driven WhatsApp notification invalidation
-- Schema-only. Zero DML em usuários. Grants restritos a service_role.

-- ============================================================================
-- 1. payment_events: timestamp autoritativo do provider + índice de ordem
-- ============================================================================
ALTER TABLE public.payment_events
  ADD COLUMN IF NOT EXISTS provider_updated_at timestamptz;

COMMENT ON COLUMN public.payment_events.provider_updated_at IS
  'WA-C11 F2: timestamp autoritativo do recurso no provider (não é o horário de chegada do webhook). Usado para detectar eventos fora de ordem (stale) na RPC billing_apply_mercadopago_event_atomic.';

CREATE INDEX IF NOT EXISTS idx_payment_events_order
  ON public.payment_events (provider, user_id, provider_updated_at DESC NULLS LAST, external_payment_id DESC);

-- ============================================================================
-- 2. RPC atômica única de aplicação de evento de billing do Mercado Pago
--
-- Contrato:
--   - APENAS service_role (defesa em profundidade além dos GRANTs)
--   - Advisory lock por user_id: serializa eventos concorrentes do MESMO usuário
--   - Idempotência L1: unique index em payment_events (provider, external_payment_id, event_type)
--   - Idempotência L2 / anti-out-of-order: compara provider_updated_at contra
--     o último evento aplicado do mesmo usuário/provider. Desempate determinístico
--     por external_payment_id quando o timestamp é igual.
--   - Invalidação de notifications: SOMENTE quando entitlement transiciona de
--     permitido → bloqueado. Restrição: pending + claim_token IS NULL + NOT EXISTS
--     em whatsapp_notification_attempts. Canary v1 é naturalmente preservada
--     porque está em 'processing' com attempt registrada (não em pending).
--   - Cancelamento agendado (p_immediate=false) preserva acesso até current_period_end.
--   - Cancelamento imediato / refund / chargeback bloqueia entitlement na hora.
--
-- Retorno: JSONB com outcome ∈ {
--   'event_applied', 'stale_event_skipped', 'duplicate_event',
--   'event_noop', 'unknown_status', 'mapping_missing', 'user_not_found'
-- }
-- ============================================================================
CREATE OR REPLACE FUNCTION public.billing_apply_mercadopago_event_atomic(
  p_user_id uuid,
  p_provider text,
  p_external_payment_id text,
  p_event_type text,
  p_provider_updated_at timestamptz,
  p_canonical_status text,     -- 'approved' | 'cancelled_immediate' | 'cancelled_scheduled' | 'refunded' | 'chargeback' | 'expired' | 'pending' | 'rejected'
  p_plano public.plan_tier,    -- plano validado server-side; pode ser NULL para eventos não-provisionadores
  p_periodicidade text,
  p_months smallint,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_raw_status text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_last_ts timestamptz;
  v_last_ext text;
  v_event_id uuid;
  v_existing_event_id uuid;
  v_plan_before public.user_plans%ROWTYPE;
  v_had_wa_before boolean := false;
  v_has_wa_after boolean := false;
  v_invalidated_count integer := 0;
  v_plan_rows integer := 0;
  v_new_status public.subscription_status;
  v_new_plano public.plan_tier;
  v_new_period_end timestamptz;
  v_new_access_until timestamptz;
  v_new_cancelled_at timestamptz;
BEGIN
  -- Defesa em profundidade: apenas service_role.
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'permission denied for function billing_apply_mercadopago_event_atomic'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_provider IS NULL OR p_external_payment_id IS NULL THEN
    RAISE EXCEPTION 'parametros obrigatorios ausentes (user_id, provider, external_payment_id)';
  END IF;

  -- Lock por usuário: eventos concorrentes do mesmo user serializam aqui.
  PERFORM pg_advisory_xact_lock(hashtextextended('billing:' || p_user_id::text, 0));

  -- L1: já processado exatamente esse (provider, external_payment_id, event_type)?
  SELECT id INTO v_existing_event_id
    FROM public.payment_events
   WHERE provider = p_provider
     AND external_payment_id = p_external_payment_id
     AND COALESCE(event_type, '') = COALESCE(p_event_type, '')
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'duplicate_event',
      'event_id', v_existing_event_id,
      'user_id', p_user_id
    );
  END IF;

  -- L2: anti out-of-order. Busca último evento aplicado deste usuário/provider.
  SELECT provider_updated_at, external_payment_id
    INTO v_last_ts, v_last_ext
    FROM public.payment_events
   WHERE provider = p_provider
     AND user_id = p_user_id
     AND provider_updated_at IS NOT NULL
   ORDER BY provider_updated_at DESC, external_payment_id DESC
   LIMIT 1;

  IF v_last_ts IS NOT NULL AND p_provider_updated_at IS NOT NULL THEN
    IF p_provider_updated_at < v_last_ts
       OR (p_provider_updated_at = v_last_ts
           AND p_external_payment_id <= COALESCE(v_last_ext, ''))
    THEN
      -- Registra o evento para trilha de auditoria, mas NÃO altera estado.
      INSERT INTO public.payment_events (
        provider, external_payment_id, event_type, status, raw_status,
        user_id, provider_updated_at, metadata, processed_at
      ) VALUES (
        p_provider, p_external_payment_id, p_event_type,
        'stale_event_skipped', p_raw_status,
        p_user_id, p_provider_updated_at,
        COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
          'wa_c11_f2_last_applied_ts', v_last_ts,
          'wa_c11_f2_last_applied_ext', v_last_ext
        ),
        v_now
      )
      RETURNING id INTO v_event_id;

      RETURN jsonb_build_object(
        'outcome', 'stale_event_skipped',
        'event_id', v_event_id,
        'user_id', p_user_id,
        'last_applied_at', v_last_ts
      );
    END IF;
  END IF;

  -- Snapshot do plano ANTES (para decidir invalidação de notifications).
  SELECT * INTO v_plan_before FROM public.user_plans WHERE user_id = p_user_id;
  IF FOUND THEN
    v_had_wa_before := public.has_feature_access(p_user_id, 'whatsapp');
  END IF;

  -- Mapeia canonical_status → transição.
  CASE p_canonical_status
    WHEN 'approved' THEN
      IF p_plano IS NULL THEN
        RETURN jsonb_build_object('outcome', 'mapping_missing', 'user_id', p_user_id, 'reason', 'plano_null_para_approved');
      END IF;
      v_new_status := 'ativo'::public.subscription_status;
      v_new_plano := p_plano;
      v_new_period_end := p_period_end;
      v_new_access_until := NULL;
      v_new_cancelled_at := NULL;

    WHEN 'cancelled_immediate', 'refunded', 'chargeback' THEN
      v_new_status := 'cancelado'::public.subscription_status;
      v_new_plano := COALESCE(v_plan_before.plano, 'sem_assinatura'::public.plan_tier);
      v_new_period_end := v_now;
      v_new_access_until := v_now;
      v_new_cancelled_at := v_now;

    WHEN 'cancelled_scheduled' THEN
      -- Preserva acesso até current_period_end.
      v_new_status := 'cancelado'::public.subscription_status;
      v_new_plano := COALESCE(v_plan_before.plano, 'sem_assinatura'::public.plan_tier);
      v_new_period_end := COALESCE(v_plan_before.current_period_end, v_now);
      v_new_access_until := COALESCE(v_plan_before.current_period_end, v_now);
      v_new_cancelled_at := v_now;

    WHEN 'expired' THEN
      v_new_status := 'expirado'::public.subscription_status;
      v_new_plano := COALESCE(v_plan_before.plano, 'sem_assinatura'::public.plan_tier);
      v_new_period_end := v_now;
      v_new_access_until := NULL;
      v_new_cancelled_at := COALESCE(v_plan_before.cancelled_at, v_now);

    WHEN 'pending', 'rejected' THEN
      -- Não substitui acesso vigente. Apenas registra o evento.
      INSERT INTO public.payment_events (
        provider, external_payment_id, event_type, status, raw_status,
        user_id, provider_updated_at, metadata, processed_at
      ) VALUES (
        p_provider, p_external_payment_id, p_event_type,
        p_canonical_status, p_raw_status,
        p_user_id, p_provider_updated_at,
        COALESCE(p_metadata, '{}'::jsonb), v_now
      )
      RETURNING id INTO v_event_id;

      RETURN jsonb_build_object(
        'outcome', 'event_noop',
        'event_id', v_event_id,
        'canonical_status', p_canonical_status,
        'user_id', p_user_id
      );

    ELSE
      -- Status desconhecido: fail-closed. Registra e retorna sem alterar plano.
      INSERT INTO public.payment_events (
        provider, external_payment_id, event_type, status, raw_status,
        user_id, provider_updated_at, metadata, processed_at
      ) VALUES (
        p_provider, p_external_payment_id, p_event_type,
        'unknown_status', p_raw_status,
        p_user_id, p_provider_updated_at,
        COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('wa_c11_f2_canonical', p_canonical_status),
        v_now
      )
      RETURNING id INTO v_event_id;

      RETURN jsonb_build_object(
        'outcome', 'unknown_status',
        'event_id', v_event_id,
        'canonical_status', p_canonical_status,
        'user_id', p_user_id
      );
  END CASE;

  -- Aplica novo estado em user_plans (upsert por user_id).
  INSERT INTO public.user_plans (
    user_id, plano, status, periodicidade, months,
    current_period_start, current_period_end,
    last_payment_id, cancelled_at, access_until
  ) VALUES (
    p_user_id, v_new_plano, v_new_status, p_periodicidade, COALESCE(p_months, 1),
    COALESCE(p_period_start, v_plan_before.current_period_start, v_now),
    v_new_period_end,
    p_external_payment_id,
    v_new_cancelled_at,
    v_new_access_until
  )
  ON CONFLICT (user_id) DO UPDATE
     SET plano = EXCLUDED.plano,
         status = EXCLUDED.status,
         periodicidade = COALESCE(EXCLUDED.periodicidade, public.user_plans.periodicidade),
         months = COALESCE(EXCLUDED.months, public.user_plans.months),
         current_period_start = COALESCE(EXCLUDED.current_period_start, public.user_plans.current_period_start),
         current_period_end = EXCLUDED.current_period_end,
         last_payment_id = EXCLUDED.last_payment_id,
         cancelled_at = EXCLUDED.cancelled_at,
         access_until = EXCLUDED.access_until,
         updated_at = now();

  GET DIAGNOSTICS v_plan_rows = ROW_COUNT;

  -- Registra evento aplicado.
  INSERT INTO public.payment_events (
    provider, external_payment_id, event_type, status, raw_status,
    user_id, provider_updated_at, metadata, processed_at
  ) VALUES (
    p_provider, p_external_payment_id, p_event_type,
    p_canonical_status, p_raw_status,
    p_user_id, p_provider_updated_at,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('wa_c11_f2_applied', true),
    v_now
  )
  RETURNING id INTO v_event_id;

  -- Reavalia entitlement APÓS aplicar o novo plano.
  v_has_wa_after := public.has_feature_access(p_user_id, 'whatsapp');

  -- Invalida notifications SOMENTE quando entitlement transiciona de true → false.
  IF v_had_wa_before AND NOT v_has_wa_after THEN
    WITH invalidated AS (
      UPDATE public.whatsapp_notifications n
         SET status = 'skipped',
             skipped_reason = 'entitlement_revoked',
             cancelled_at = v_now,
             updated_at = v_now
       WHERE n.user_id = p_user_id
         AND n.status = 'pending'
         AND n.claim_token IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.whatsapp_notification_attempts a
            WHERE a.notification_id = n.id
         )
       RETURNING n.id
    )
    SELECT count(*)::int INTO v_invalidated_count FROM invalidated;
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'event_applied',
    'event_id', v_event_id,
    'user_id', p_user_id,
    'plan_rows_affected', v_plan_rows,
    'canonical_status', p_canonical_status,
    'plano_after', v_new_plano,
    'status_after', v_new_status,
    'had_whatsapp_before', v_had_wa_before,
    'has_whatsapp_after', v_has_wa_after,
    'notifications_invalidated', v_invalidated_count
  );
END;
$$;

-- Grants restritos.
REVOKE ALL ON FUNCTION public.billing_apply_mercadopago_event_atomic(
  uuid, text, text, text, timestamptz, text, public.plan_tier, text, smallint, timestamptz, timestamptz, text, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.billing_apply_mercadopago_event_atomic(
  uuid, text, text, text, timestamptz, text, public.plan_tier, text, smallint, timestamptz, timestamptz, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.billing_apply_mercadopago_event_atomic(
  uuid, text, text, text, timestamptz, text, public.plan_tier, text, smallint, timestamptz, timestamptz, text, jsonb
) IS
  'WA-C11 F2: aplica atomicamente um evento de billing do Mercado Pago. Lock advisory por user_id, idempotência L1 (unique index) + L2 (provider_updated_at). Invalida whatsapp_notifications pending/sem-claim/sem-attempt somente quando entitlement de WhatsApp transiciona de permitido para bloqueado. Preserva canary v1 naturalmente (status=processing tem attempt registrada).';