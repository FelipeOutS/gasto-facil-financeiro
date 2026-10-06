-- WhatsApp 1.1: possession-verified links and atomic recurring-income dedupe.
-- Existing links keep their current access; only new links/number changes need proof.
-- Acquire the table's DDL lock before checking legacy ownership, so a
-- concurrent old-client insert cannot slip between preflight and cutover.
-- Supabase's normal per-file migration transaction rolls this ADD COLUMN
-- back too if the preflight fails.
ALTER TABLE public.whatsapp_links
  ADD COLUMN verification_state text NOT NULL DEFAULT 'verified',
  ADD COLUMN verified_at timestamptz;

-- Stop atomically if legacy spellings of one Brazilian number belong to
-- different accounts. Resolving ownership requires human review.
DO $$
BEGIN
  IF EXISTS (
    WITH digits AS (
      SELECT user_id, ltrim(regexp_replace(telefone, '[^0-9]', '', 'g'), '0') AS phone
      FROM public.whatsapp_links
    ), normalized AS (
      SELECT user_id,
        CASE
          WHEN phone ~ '^55[1-9][0-9]9[0-9]{8}$' THEN phone
          WHEN phone ~ '^[1-9][0-9]9[0-9]{8}$' THEN '55' || phone
          WHEN phone ~ '^55[1-9][0-9][0-9]{8}$'
            THEN substr(phone, 1, 4) || '9' || substr(phone, 5)
          WHEN phone ~ '^[1-9][0-9][0-9]{8}$'
            THEN '55' || substr(phone, 1, 2) || '9' || substr(phone, 3)
          ELSE NULL
        END AS canonical
      FROM digits
    )
    SELECT 1 FROM normalized WHERE canonical IS NOT NULL
    GROUP BY canonical HAVING count(DISTINCT user_id) > 1
  ) THEN
    RAISE EXCEPTION 'legacy whatsapp phone ownership conflict; resolve before migration';
  END IF;
END;
$$;

ALTER TABLE public.whatsapp_links
  ADD CONSTRAINT whatsapp_links_verification_state_check
  CHECK (verification_state IN ('pending', 'verified', 'revoked'));

UPDATE public.whatsapp_links
SET verified_at = opt_in_em
WHERE ativo = true AND revogado_em IS NULL AND opt_in_em IS NOT NULL;

UPDATE public.whatsapp_links
-- A legacy row may have been soft-revoked without ativo being cleared.
-- It was already blocked by the webhook; make the stored state consistent
-- before validating the active/verified constraint.
SET ativo = false, verification_state = 'revoked'
WHERE ativo = false OR revogado_em IS NOT NULL;

ALTER TABLE public.whatsapp_links
  ADD CONSTRAINT whatsapp_links_pending_inactive_check
  CHECK (verification_state <> 'pending' OR (ativo = false AND opt_in_em IS NULL));
ALTER TABLE public.whatsapp_links
  ADD CONSTRAINT whatsapp_links_active_verified_check
  CHECK (ativo = false OR verification_state = 'verified');

CREATE TABLE public.whatsapp_link_challenges (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  link_id uuid NOT NULL REFERENCES public.whatsapp_links(id) ON DELETE CASCADE,
  telefone text NOT NULL,
  token_hash text,
  consent_version text NOT NULL,
  consent_user_agent text,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_link_challenges_phone_idx ON public.whatsapp_link_challenges (telefone);
ALTER TABLE public.whatsapp_link_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_link_challenges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_link_challenges TO service_role;

-- Old published code revokes through an authenticated UPDATE. Keep only that
-- operation available during migration-first rollout and rollback; activation,
-- consent refresh, phone change and verifier fields remain server-only.
CREATE FUNCTION public.whatsapp_links_authenticated_revoke_only()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'authenticated' THEN
    IF NEW.ativo IS DISTINCT FROM false OR NEW.revogado_em IS NULL
       OR (to_jsonb(NEW) - 'ativo' - 'revogado_em' - 'updated_at')
          IS DISTINCT FROM
          (to_jsonb(OLD) - 'ativo' - 'revogado_em' - 'updated_at') THEN
      RAISE EXCEPTION 'only revocation is permitted' USING ERRCODE = '42501';
    END IF;
    NEW.verification_state := 'revoked';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_whatsapp_links_authenticated_revoke_only
  BEFORE UPDATE ON public.whatsapp_links
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_links_authenticated_revoke_only();
REVOKE ALL ON FUNCTION public.whatsapp_links_authenticated_revoke_only()
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT, DELETE ON public.whatsapp_links FROM PUBLIC, anon, authenticated;
REVOKE UPDATE ON public.whatsapp_links FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON public.whatsapp_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_links TO service_role;

CREATE FUNCTION public.whatsapp_begin_link_verification(
  p_user_id uuid, p_phone text, p_token_hash text,
  p_consent_version text, p_user_agent text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE
  v_link public.whatsapp_links%ROWTYPE;
  v_expiry timestamptz := now() + interval '20 minutes';
BEGIN
  IF p_user_id IS NULL OR p_phone !~ '^55[1-9][0-9]9[0-9]{8}$'
     OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR nullif(p_consent_version, '') IS NULL THEN
    RAISE EXCEPTION 'invalid verification request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wa-link:' || p_user_id::text, 0));
  -- The old site stored digits supplied by the caller. A physical BR number
  -- may exist with/without DDI and with/without the ninth digit. The exact
  -- text UNIQUE constraint alone cannot prevent a second owner via an alias.
  IF EXISTS (
    SELECT 1 FROM public.whatsapp_links
    WHERE ltrim(regexp_replace(telefone, '[^0-9]', '', 'g'), '0') IN (
      p_phone, substr(p_phone, 3), substr(p_phone, 1, 4) || substr(p_phone, 6),
      substr(p_phone, 3, 2) || substr(p_phone, 6)
    ) AND user_id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'link unavailable' USING ERRCODE = '23505';
  END IF;
  SELECT * INTO v_link FROM public.whatsapp_links
  WHERE user_id = p_user_id AND ltrim(regexp_replace(telefone, '[^0-9]', '', 'g'), '0') IN (
    p_phone, substr(p_phone, 3), substr(p_phone, 1, 4) || substr(p_phone, 6),
    substr(p_phone, 3, 2) || substr(p_phone, 6)
  )
  ORDER BY ativo DESC, (telefone = p_phone) DESC, created_at DESC
  LIMIT 1 FOR UPDATE;
  IF FOUND AND v_link.ativo AND v_link.revogado_em IS NULL
     AND v_link.verification_state = 'verified'
     AND v_link.opt_in_em IS NOT NULL
     AND v_link.telefone IN (p_phone, substr(p_phone, 3)) THEN
    RETURN jsonb_build_object('status', 'already_active', 'link_id', v_link.id);
  END IF;

  -- Old 10/12-digit or formatted spellings are not reachable from the
  -- canonical Meta sender in the existing lookup. Keep that legacy link
  -- untouched while opening a canonical pending link for proof of possession.
  IF v_link.id IS NOT NULL AND v_link.ativo AND v_link.revogado_em IS NULL
     AND v_link.verification_state = 'verified'
     AND v_link.telefone NOT IN (p_phone, substr(p_phone, 3)) THEN
    SELECT * INTO v_link FROM public.whatsapp_links
    WHERE user_id = p_user_id AND telefone = p_phone FOR UPDATE;
  END IF;

  UPDATE public.whatsapp_links
  SET verification_state = 'revoked', revogado_em = now()
  WHERE user_id = p_user_id AND verification_state = 'pending'
    AND telefone <> p_phone;

  IF v_link.id IS NULL THEN
    INSERT INTO public.whatsapp_links
      (user_id, telefone, ativo, opt_in_em, verification_state, verified_at)
    VALUES (p_user_id, p_phone, false, NULL, 'pending', NULL)
    RETURNING * INTO v_link;
  ELSE
    UPDATE public.whatsapp_links
    SET telefone = p_phone, ativo = false, opt_in_em = NULL, revogado_em = NULL,
        verification_state = 'pending', verified_at = NULL
    WHERE id = v_link.id RETURNING * INTO v_link;
  END IF;

  INSERT INTO public.whatsapp_link_challenges
    (user_id, link_id, telefone, token_hash, consent_version,
     consent_user_agent, expires_at, attempts, consumed_at, created_at)
  VALUES (p_user_id, v_link.id, p_phone, p_token_hash, p_consent_version,
          left(p_user_agent, 400), v_expiry, 0, NULL, now())
  ON CONFLICT (user_id) DO UPDATE SET
    link_id = excluded.link_id, telefone = excluded.telefone,
    token_hash = excluded.token_hash, consent_version = excluded.consent_version,
    consent_user_agent = excluded.consent_user_agent,
    expires_at = excluded.expires_at, attempts = 0,
    consumed_at = NULL, created_at = now();
  RETURN jsonb_build_object('status', 'pending', 'link_id', v_link.id, 'expires_at', v_expiry);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'link unavailable' USING ERRCODE = '23505';
END;
$$;
REVOKE ALL ON FUNCTION public.whatsapp_begin_link_verification(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_begin_link_verification(uuid, text, text, text, text)
  TO service_role;

CREATE FUNCTION public.whatsapp_complete_link_verification(
  p_phone text, p_token_hash text, p_external_id text
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE
  v_challenge public.whatsapp_link_challenges%ROWTYPE;
  v_link public.whatsapp_links%ROWTYPE;
  v_owner uuid;
BEGIN
  IF p_phone !~ '^55[1-9][0-9]9[0-9]{8}$'
     OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR nullif(p_external_id, '') IS NULL THEN
    RETURN 'invalid';
  END IF;
  -- Same lock order as begin(): user advisory lock, then challenge row.
  SELECT user_id INTO v_owner FROM public.whatsapp_link_challenges
  WHERE telefone = p_phone;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wa-link:' || v_owner::text, 0));
  SELECT * INTO v_challenge FROM public.whatsapp_link_challenges
  WHERE user_id = v_owner AND telefone = p_phone FOR UPDATE;
  IF NOT FOUND OR v_challenge.consumed_at IS NOT NULL
     OR v_challenge.expires_at <= now() OR v_challenge.attempts >= 5 THEN
    RETURN 'invalid';
  END IF;
  IF v_challenge.token_hash IS DISTINCT FROM p_token_hash THEN
    UPDATE public.whatsapp_link_challenges SET attempts = attempts + 1
    WHERE user_id = v_challenge.user_id;
    RETURN 'invalid';
  END IF;
  SELECT * INTO v_link FROM public.whatsapp_links
  WHERE id = v_challenge.link_id FOR UPDATE;
  IF NOT FOUND OR v_link.user_id <> v_challenge.user_id
     OR v_link.telefone <> p_phone OR v_link.verification_state <> 'pending'
     OR v_link.ativo THEN
    RETURN 'invalid';
  END IF;
  UPDATE public.whatsapp_links
  SET ativo = false, revogado_em = now(), verification_state = 'revoked'
  WHERE user_id = v_challenge.user_id AND id <> v_link.id AND ativo = true;
  UPDATE public.whatsapp_links
  SET ativo = true, revogado_em = NULL, verification_state = 'verified',
      verified_at = now(), opt_in_em = now(),
      opt_in_version = v_challenge.consent_version,
      opt_in_user_agent = v_challenge.consent_user_agent
  WHERE id = v_link.id;
  UPDATE public.whatsapp_link_challenges
  SET consumed_at = now(), token_hash = NULL
  WHERE user_id = v_challenge.user_id;
  RETURN 'verified';
END;
$$;
REVOKE ALL ON FUNCTION public.whatsapp_complete_link_verification(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_complete_link_verification(text, text, text)
  TO service_role;

-- Uses the same owner lock as begin/complete. An opt-out cannot race with a
-- confirmation and leave a pending token able to reactivate the channel.
CREATE FUNCTION public.whatsapp_revoke_links(
  p_user_id uuid, p_link_id uuid DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid revocation request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wa-link:' || p_user_id::text, 0));
  UPDATE public.whatsapp_links
  SET ativo = false, revogado_em = now(), verification_state = 'revoked'
  WHERE user_id = p_user_id AND (p_link_id IS NULL OR id = p_link_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  DELETE FROM public.whatsapp_link_challenges
  WHERE user_id = p_user_id AND (p_link_id IS NULL OR link_id = p_link_id);
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.whatsapp_revoke_links(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_revoke_links(uuid, uuid) TO service_role;

CREATE TABLE public.whatsapp_financial_actions (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  action_kind text NOT NULL CHECK (action_kind = 'income_recurring'),
  financial_id uuid NOT NULL,
  recurrence_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, external_id, action_kind)
);
ALTER TABLE public.whatsapp_financial_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_financial_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.whatsapp_financial_actions TO service_role;

-- The existing recurring-income RPC and the idempotency marker commit in
-- ONE database transaction. A failed call rolls back both; a lost HTTP
-- response finds the marker and returns the same financial IDs.
CREATE FUNCTION public.whatsapp_create_recurring_income_once(
  p_user_id uuid, p_external_id text, p_descricao text, p_valor numeric,
  p_data date, p_tipo text, p_frequencia text,
  p_dia_mes integer DEFAULT NULL, p_dia_semana integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE
  v_action public.whatsapp_financial_actions%ROWTYPE;
  v_income record;
BEGIN
  IF p_user_id IS NULL OR nullif(p_external_id, '') IS NULL
     OR length(p_external_id) > 250 THEN
    RAISE EXCEPTION 'invalid financial request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'wa-income:' || p_user_id::text || ':' || p_external_id, 0));
  SELECT * INTO v_action FROM public.whatsapp_financial_actions
  WHERE user_id = p_user_id AND external_id = p_external_id
    AND action_kind = 'income_recurring';
  IF FOUND THEN
    RETURN jsonb_build_object('receita_id', v_action.financial_id,
      'recorrencia_id', v_action.recurrence_id, 'duplicate', true);
  END IF;
  SELECT * INTO v_income FROM public.create_recurring_income(
    p_user_id, p_descricao, p_valor, p_data, p_tipo, p_frequencia,
    p_dia_mes, p_dia_semana, NULL, 'whatsapp');
  IF v_income.receita_id IS NULL OR v_income.recorrencia_id IS NULL THEN
    RAISE EXCEPTION 'recurring income not persisted';
  END IF;
  INSERT INTO public.whatsapp_financial_actions
    (user_id, external_id, action_kind, financial_id, recurrence_id)
  VALUES (p_user_id, p_external_id, 'income_recurring',
          v_income.receita_id, v_income.recorrencia_id);
  RETURN jsonb_build_object('receita_id', v_income.receita_id,
    'recorrencia_id', v_income.recorrencia_id, 'duplicate', false);
END;
$$;
REVOKE ALL ON FUNCTION public.whatsapp_create_recurring_income_once(
  uuid, text, text, numeric, date, text, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_create_recurring_income_once(
  uuid, text, text, numeric, date, text, text, integer, integer)
  TO service_role;

-- Advance a card conversation under one per-conversation transaction lock.
-- A stale webhook cannot fork two active card sessions. The previous session
-- remains usable if the insert fails or the RPC is rolled back.
CREATE FUNCTION public.whatsapp_advance_card_session(
  p_user_id uuid, p_phone text, p_expected_id uuid, p_previous_id uuid,
  p_external_id text, p_text text, p_received_at timestamptz,
  p_status text, p_parsed jsonb, p_response text
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE
  v_active_id uuid;
  v_new_id uuid;
BEGIN
  IF p_user_id IS NULL OR nullif(p_phone, '') IS NULL
     OR p_parsed->>'kind' IS DISTINCT FROM 'cartao_cadastro'
     OR p_status NOT IN (
       'cartao_cad_coleta', 'cartao_cad_confirmacao', 'cartao_cad_duplicado',
       'cartao_cad_pos', 'cartao_cad_pos_gasto', 'cartao_cad_concluido', 'cancelada'
     ) THEN
    RAISE EXCEPTION 'invalid card transition' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'wa-card:' || p_user_id::text || ':' || p_phone, 0));
  IF p_external_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.whatsapp_messages
    WHERE external_id = p_external_id AND user_id = p_user_id
      AND telefone = p_phone AND parsed->>'kind' = 'cartao_cadastro'
  ) THEN
    RETURN 'replay';
  END IF;
  SELECT id INTO v_active_id FROM public.whatsapp_messages
  WHERE user_id = p_user_id AND telefone = p_phone
    AND parsed->>'kind' = 'cartao_cadastro'
    AND status IN (
      'cartao_cad_coleta', 'cartao_cad_confirmacao', 'cartao_cad_duplicado',
      'cartao_cad_pos', 'cartao_cad_pos_gasto'
    )
    AND recebida_em >= now() - interval '2 hours'
  ORDER BY recebida_em DESC, created_at DESC, id DESC
  LIMIT 1 FOR UPDATE;
  IF v_active_id IS DISTINCT FROM p_expected_id THEN
    RETURN 'stale';
  END IF;
  INSERT INTO public.whatsapp_messages
    (user_id, external_id, telefone, texto, recebida_em, status, parsed, resposta_sugerida)
  VALUES
    (p_user_id, p_external_id, p_phone, left(coalesce(p_text, ''), 500),
     coalesce(p_received_at, now()), p_status, p_parsed, p_response)
  RETURNING id INTO v_new_id;
  UPDATE public.whatsapp_messages SET status = 'expirada'
  WHERE user_id = p_user_id AND telefone = p_phone AND id <> v_new_id
    AND parsed->>'kind' = 'cartao_cadastro'
    AND status IN (
      'cartao_cad_coleta', 'cartao_cad_confirmacao', 'cartao_cad_duplicado',
      'cartao_cad_pos', 'cartao_cad_pos_gasto'
    );
  IF p_previous_id IS NOT NULL THEN
    UPDATE public.whatsapp_messages SET status = 'expirada'
    WHERE id = p_previous_id AND user_id = p_user_id AND telefone = p_phone;
  END IF;
  RETURN 'advanced';
END;
$$;
REVOKE ALL ON FUNCTION public.whatsapp_advance_card_session(
  uuid, text, uuid, uuid, text, text, timestamptz, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_advance_card_session(
  uuid, text, uuid, uuid, text, text, timestamptz, text, jsonb, text)
  TO service_role;

CREATE FUNCTION public.whatsapp_close_card_sessions(
  p_user_id uuid, p_phone text, p_status text DEFAULT 'cancelada'
) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_user_id IS NULL OR nullif(p_phone, '') IS NULL
     OR p_status NOT IN ('cancelada', 'cartao_cad_concluido') THEN
    RAISE EXCEPTION 'invalid card closure' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'wa-card:' || p_user_id::text || ':' || p_phone, 0));
  UPDATE public.whatsapp_messages SET status = p_status
  WHERE user_id = p_user_id AND telefone = p_phone
    AND parsed->>'kind' = 'cartao_cadastro'
    AND status IN (
      'cartao_cad_coleta', 'cartao_cad_confirmacao', 'cartao_cad_duplicado',
      'cartao_cad_pos', 'cartao_cad_pos_gasto'
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.whatsapp_close_card_sessions(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_close_card_sessions(uuid, text, text)
  TO service_role;
