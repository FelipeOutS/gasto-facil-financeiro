-- WhatsApp 1.2: short-lived, server-only action references. No master data is
-- copied here; receipts always read the financial rows again.
CREATE TABLE public.whatsapp_recent_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  telefone text NOT NULL,
  source_external_id text NOT NULL,
  entity_kind text NOT NULL CHECK (entity_kind IN ('expense', 'installment', 'income', 'recurring_income')),
  entity_id uuid NOT NULL,
  related_id uuid,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'undone')),
  edit_state text NOT NULL DEFAULT 'idle' CHECK (edit_state IN ('idle', 'field', 'value', 'confirm')),
  edit_field text,
  pending_patch jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  undone_at timestamptz,
  UNIQUE (user_id, entity_kind, entity_id),
  UNIQUE (user_id, source_external_id, entity_kind)
);
CREATE INDEX whatsapp_recent_actions_active_phone_idx
  ON public.whatsapp_recent_actions(user_id, telefone, expires_at DESC)
  WHERE state = 'active';
CREATE INDEX whatsapp_recent_actions_source_idx
  ON public.whatsapp_recent_actions(source_external_id)
  WHERE state = 'undone';
ALTER TABLE public.whatsapp_recent_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_recent_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_recent_actions TO service_role;

-- One transaction and one row lock for the entire reversal. The caller's
-- user ID is resolved from the verified WhatsApp link; it is never accepted
-- from inbound message text. Only service_role may execute this invoker RPC.
CREATE FUNCTION public.whatsapp_undo_recent_action(
  p_user_id uuid, p_phone text, p_action_id uuid, p_scope text DEFAULT 'single'
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE
  v_action public.whatsapp_recent_actions%ROWTYPE;
  v_gasto public.gastos%ROWTYPE;
  v_receita public.receitas%ROWTYPE;
  v_recorrencia public.recorrencias%ROWTYPE;
  v_count integer;
BEGIN
  IF p_user_id IS NULL OR nullif(p_phone, '') IS NULL OR p_action_id IS NULL THEN
    RETURN 'unavailable';
  END IF;
  SELECT * INTO v_action FROM public.whatsapp_recent_actions
  WHERE id = p_action_id AND user_id = p_user_id AND telefone = p_phone
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unavailable'; END IF;
  IF v_action.state = 'undone' THEN RETURN 'already_undone'; END IF;
  IF v_action.expires_at <= now() THEN RETURN 'expired'; END IF;

  IF v_action.entity_kind IN ('expense', 'installment') THEN
    SELECT * INTO v_gasto FROM public.gastos
    WHERE id = v_action.entity_id AND user_id = p_user_id AND origem = 'whatsapp'
    FOR UPDATE;
    IF NOT FOUND THEN RETURN 'unavailable'; END IF;
    IF v_action.entity_kind = 'expense' THEN
      IF v_gasto.grupo_parcelamento_id IS NOT NULL OR v_gasto.recorrencia_id IS NOT NULL
         OR coalesce(v_gasto.total_parcelas, 1) > 1 THEN RETURN 'unavailable'; END IF;
      UPDATE public.contas_a_pagar SET status = 'pendente', data_pagamento = NULL, gasto_id = NULL
      WHERE user_id = p_user_id AND gasto_id = v_gasto.id;
      DELETE FROM public.gastos WHERE id = v_gasto.id AND user_id = p_user_id;
    ELSE
      IF v_action.related_id IS NULL OR v_gasto.grupo_parcelamento_id IS DISTINCT FROM v_action.related_id THEN
        RETURN 'unavailable';
      END IF;
      SELECT count(*) INTO v_count FROM public.gastos
      WHERE user_id = p_user_id AND grupo_parcelamento_id = v_action.related_id
        AND origem = 'whatsapp';
      IF v_count <> v_gasto.total_parcelas OR v_count < 2 THEN RETURN 'unavailable'; END IF;
      UPDATE public.contas_a_pagar SET status = 'pendente', data_pagamento = NULL, gasto_id = NULL
      WHERE user_id = p_user_id AND gasto_id IN (
        SELECT id FROM public.gastos WHERE user_id = p_user_id
          AND grupo_parcelamento_id = v_action.related_id);
      DELETE FROM public.gastos WHERE user_id = p_user_id
        AND grupo_parcelamento_id = v_action.related_id AND origem = 'whatsapp';
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count <> v_gasto.total_parcelas THEN
        RAISE EXCEPTION 'installment reversal mismatch';
      END IF;
    END IF;
  ELSE
    SELECT * INTO v_receita FROM public.receitas
    WHERE id = v_action.entity_id AND user_id = p_user_id AND origem = 'whatsapp'
      AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN 'unavailable'; END IF;
    IF v_action.entity_kind = 'income' THEN
      IF v_receita.recorrencia_id IS NOT NULL THEN RETURN 'unavailable'; END IF;
      DELETE FROM public.receitas WHERE id = v_receita.id AND user_id = p_user_id;
    ELSE
      IF v_action.related_id IS NULL OR v_receita.recorrencia_id IS DISTINCT FROM v_action.related_id THEN
        RETURN 'unavailable';
      END IF;
      IF p_scope NOT IN ('occurrence', 'series') THEN RETURN 'choose_scope'; END IF;
      SELECT * INTO v_recorrencia FROM public.recorrencias
      WHERE id = v_action.related_id AND user_id = p_user_id AND origem = 'whatsapp' FOR UPDATE;
      IF NOT FOUND THEN RETURN 'unavailable'; END IF;
      IF p_scope = 'series' THEN
        UPDATE public.recorrencias SET status = 'cancelada'
        WHERE id = v_recorrencia.id AND user_id = p_user_id AND status = 'ativa';
        IF NOT FOUND THEN RETURN 'unavailable'; END IF;
      END IF;
      -- Only the occurrence created by this WhatsApp operation is removed.
      -- Other historical occurrences are never erased implicitly.
      DELETE FROM public.receitas WHERE id = v_receita.id AND user_id = p_user_id;
    END IF;
  END IF;
  UPDATE public.whatsapp_recent_actions
  SET state = 'undone', undone_at = now(), edit_state = 'idle', pending_patch = NULL
  WHERE id = v_action.id;
  RETURN 'undone';
END;
$$;
REVOKE ALL ON FUNCTION public.whatsapp_undo_recent_action(uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_undo_recent_action(uuid, text, uuid, text)
  TO service_role;

-- Confirmed edit of one recent, non-recurring financial row. A row lock on
-- the action serializes it against Undo and a before-value check prevents a
-- stale confirmation from overwriting a change made in the site.
CREATE FUNCTION public.whatsapp_edit_recent_action(
  p_user_id uuid, p_phone text, p_action_id uuid, p_field text,
  p_value text, p_before text,
  p_card_id uuid DEFAULT NULL, p_competence text DEFAULT NULL,
  p_scope text DEFAULT 'single'
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE
  v_action public.whatsapp_recent_actions%ROWTYPE;
  v_gasto public.gastos%ROWTYPE;
  v_receita public.receitas%ROWTYPE;
BEGIN
  SELECT * INTO v_action FROM public.whatsapp_recent_actions
  WHERE id = p_action_id AND user_id = p_user_id AND telefone = p_phone FOR UPDATE;
  IF NOT FOUND OR v_action.state <> 'active' THEN RETURN 'unavailable'; END IF;
  IF v_action.expires_at <= now() THEN RETURN 'expired'; END IF;
  IF v_action.entity_kind = 'expense' THEN
    SELECT * INTO v_gasto FROM public.gastos
    WHERE id = v_action.entity_id AND user_id = p_user_id AND origem = 'whatsapp' FOR UPDATE;
    IF NOT FOUND OR v_gasto.grupo_parcelamento_id IS NOT NULL
       OR v_gasto.recorrencia_id IS NOT NULL OR coalesce(v_gasto.total_parcelas, 1) > 1 THEN
      RETURN 'unavailable';
    END IF;
    IF p_field = 'descricao' THEN
      IF v_gasto.descricao IS DISTINCT FROM p_before OR nullif(trim(p_value), '') IS NULL
         OR length(p_value) > 80 THEN RETURN 'changed'; END IF;
      UPDATE public.gastos SET descricao = trim(p_value)
      WHERE id = v_gasto.id AND user_id = p_user_id;
    ELSIF p_field = 'valor' THEN
      IF v_gasto.valor::text IS DISTINCT FROM p_before OR p_value::numeric <= 0
         OR p_value::numeric > 999999999.99 THEN RETURN 'changed'; END IF;
      UPDATE public.gastos SET valor = p_value::numeric
      WHERE id = v_gasto.id AND user_id = p_user_id;
    ELSIF p_field = 'categoria_id' THEN
      IF coalesce(v_gasto.categoria_id::text, '') IS DISTINCT FROM p_before OR NOT EXISTS (
        SELECT 1 FROM public.categorias WHERE id = p_value::uuid AND user_id = p_user_id
      ) THEN RETURN 'changed'; END IF;
      UPDATE public.gastos SET categoria_id = p_value::uuid
      WHERE id = v_gasto.id AND user_id = p_user_id;
    ELSIF p_field = 'data' THEN
      IF v_gasto.data::text IS DISTINCT FROM p_before THEN RETURN 'changed'; END IF;
      IF v_gasto.forma_pagamento = 'credito' AND v_gasto.cartao_id IS NULL THEN RETURN 'unavailable'; END IF;
      IF v_gasto.cartao_id IS NOT NULL AND (p_competence IS NULL OR p_competence !~ '^[0-9]{4}-(0[1-9]|1[0-2])$') THEN
        RETURN 'unavailable';
      END IF;
      UPDATE public.gastos SET data = p_value::date,
        mes = extract(month from p_value::date)::smallint,
        ano = extract(year from p_value::date)::integer,
        invoice_month = to_char(p_value::date, 'YYYY-MM'),
        fatura_competencia = CASE WHEN v_gasto.cartao_id IS NOT NULL THEN p_competence ELSE NULL END
      WHERE id = v_gasto.id AND user_id = p_user_id;
    ELSIF p_field = 'forma_pagamento' THEN
      IF v_gasto.forma_pagamento || ':' || coalesce(v_gasto.cartao_id::text, '') IS DISTINCT FROM p_before
         OR p_value NOT IN ('pix', 'dinheiro', 'debito', 'credito') THEN RETURN 'changed'; END IF;
      IF p_value = 'credito' AND (p_card_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.cartoes WHERE id = p_card_id AND user_id = p_user_id
      )) THEN RETURN 'unavailable'; END IF;
      IF p_value = 'credito' AND (p_competence IS NULL OR p_competence !~ '^[0-9]{4}-(0[1-9]|1[0-2])$') THEN
        RETURN 'unavailable';
      END IF;
      IF p_value <> 'credito' AND p_card_id IS NOT NULL THEN RETURN 'unavailable'; END IF;
      UPDATE public.gastos SET forma_pagamento = p_value,
        cartao_id = CASE WHEN p_value = 'credito' THEN p_card_id ELSE NULL END,
        fatura_competencia = CASE WHEN p_value = 'credito' THEN p_competence ELSE NULL END
      WHERE id = v_gasto.id AND user_id = p_user_id;
    ELSE RETURN 'unavailable'; END IF;
  ELSIF v_action.entity_kind IN ('income', 'recurring_income') THEN
    IF v_action.entity_kind = 'recurring_income' AND p_scope <> 'occurrence' THEN
      RETURN 'choose_scope';
    END IF;
    SELECT * INTO v_receita FROM public.receitas
    WHERE id = v_action.entity_id AND user_id = p_user_id AND origem = 'whatsapp'
      AND deleted_at IS NULL
      AND ((v_action.entity_kind = 'income' AND recorrencia_id IS NULL)
        OR (v_action.entity_kind = 'recurring_income' AND recorrencia_id = v_action.related_id))
    FOR UPDATE;
    IF NOT FOUND THEN RETURN 'unavailable'; END IF;
    IF p_field = 'descricao' THEN
      IF v_receita.descricao IS DISTINCT FROM p_before OR nullif(trim(p_value), '') IS NULL
         OR length(p_value) > 80 THEN RETURN 'changed'; END IF;
      UPDATE public.receitas SET descricao = trim(p_value) WHERE id = v_receita.id AND user_id = p_user_id;
    ELSIF p_field = 'valor' THEN
      IF v_receita.valor::text IS DISTINCT FROM p_before OR p_value::numeric <= 0
         OR p_value::numeric > 999999999.99 THEN RETURN 'changed'; END IF;
      UPDATE public.receitas SET valor = p_value::numeric WHERE id = v_receita.id AND user_id = p_user_id;
    ELSIF p_field = 'data' THEN
      IF v_receita.data::text IS DISTINCT FROM p_before THEN RETURN 'changed'; END IF;
      UPDATE public.receitas SET data = p_value::date,
        mes = extract(month from p_value::date)::smallint,
        ano = extract(year from p_value::date)::integer
      WHERE id = v_receita.id AND user_id = p_user_id;
    ELSE RETURN 'unavailable'; END IF;
  ELSE RETURN 'unavailable'; END IF;
  UPDATE public.whatsapp_recent_actions SET edit_state = 'idle', edit_field = NULL,
    pending_patch = NULL WHERE id = v_action.id;
  RETURN 'updated';
END;
$$;
REVOKE ALL ON FUNCTION public.whatsapp_edit_recent_action(
  uuid, text, uuid, text, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_edit_recent_action(
  uuid, text, uuid, text, text, text, uuid, text, text) TO service_role;
