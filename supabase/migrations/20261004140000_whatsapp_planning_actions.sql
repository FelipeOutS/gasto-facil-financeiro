-- WhatsApp 1.3: proposals are private, short lived and applied once.
-- No previous migration is changed. Service role is the only API caller.
CREATE TABLE public.whatsapp_planning_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  telefone text NOT NULL,
  source_external_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'goal_create','goal_add','goal_withdraw','goal_edit','goal_cancel',
    'recurrence_create','recurrence_edit','recurrence_cancel','card_edit'
  )),
  target_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','ready','applied','cancelled')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  result_id uuid,
  UNIQUE (user_id, source_external_id)
);
CREATE INDEX whatsapp_planning_actions_recent_idx
  ON public.whatsapp_planning_actions (user_id, telefone, created_at DESC);
ALTER TABLE public.whatsapp_planning_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_planning_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_planning_actions_service ON public.whatsapp_planning_actions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.whatsapp_planning_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_planning_actions TO service_role;

-- Uses the product's feature gates and the same tables as the site. Locking
-- the proposal makes callback retries and concurrent workers idempotent.
CREATE FUNCTION public.whatsapp_apply_planning_action(
  p_id uuid, p_user_id uuid, p_telefone text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  a public.whatsapp_planning_actions%ROWTYPE;
  m public.metas_financeiras%ROWTYPE;
  r public.recorrencias%ROWTYPE;
  c public.cartoes%ROWTYPE;
  v numeric(14,2);
  v_name text;
  v_field text;
  v_before text;
  v_result uuid;
BEGIN
  SELECT * INTO a FROM public.whatsapp_planning_actions
   WHERE id = p_id AND user_id = p_user_id AND telefone = p_telefone FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','missing'); END IF;
  IF a.state = 'applied' THEN
    RETURN jsonb_build_object('status','already_applied','id',a.result_id);
  END IF;
  IF a.state <> 'ready' OR a.expires_at <= now() THEN
    RETURN jsonb_build_object('status','expired');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_links l WHERE l.user_id=p_user_id
      AND regexp_replace(l.telefone,'[^0-9]','','g') IN (
        regexp_replace(p_telefone,'[^0-9]','','g'),
        '55' || regexp_replace(p_telefone,'[^0-9]','','g'),
        CASE WHEN regexp_replace(p_telefone,'[^0-9]','','g') LIKE '55%'
          THEN substr(regexp_replace(p_telefone,'[^0-9]','','g'),3)
          ELSE regexp_replace(p_telefone,'[^0-9]','','g') END)
      AND l.ativo=true
      AND l.opt_in_em IS NOT NULL AND l.revogado_em IS NULL
  ) THEN RETURN jsonb_build_object('status','not_authorized'); END IF;
  IF NOT public.has_feature_access(p_user_id, 'whatsapp') THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;
  IF a.kind LIKE 'goal_%' AND NOT public.has_feature_access(p_user_id,'metas') THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;
  IF a.kind LIKE 'recurrence_%' AND NOT public.has_feature_access(p_user_id,'assinaturas_recorrencias') THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;
  IF a.kind = 'card_edit' AND NOT public.has_feature_access(p_user_id,'cartoes_basico') THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;

  IF a.kind = 'goal_create' THEN
    v_name := trim(a.payload->>'name');
    v := (a.payload->>'amount')::numeric;
    IF length(v_name) NOT BETWEEN 2 AND 80 OR v <= 0 OR v > 99999999 THEN
      RETURN jsonb_build_object('status','invalid');
    END IF;
    INSERT INTO public.metas_financeiras(user_id,nome,valor_objetivo,prazo,color_hex)
    VALUES(p_user_id,v_name,v,
      CASE WHEN a.payload ? 'date' THEN (a.payload->>'date')::date ELSE NULL END,
      '#10b981') RETURNING id INTO v_result;

  ELSIF a.kind IN ('goal_add','goal_withdraw','goal_edit','goal_cancel') THEN
    SELECT * INTO m FROM public.metas_financeiras
      WHERE id=a.target_id AND user_id=p_user_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
    IF a.kind IN ('goal_add','goal_withdraw') THEN
      v := (a.payload->>'amount')::numeric;
      IF v <= 0 OR v > 99999999 THEN RETURN jsonb_build_object('status','invalid'); END IF;
      -- The site's direct "valor atual" control edits this baseline. Linked
      -- money in dinheiro_guardado remains untouched and is never a bank transfer.
      IF a.kind='goal_withdraw' AND m.valor_atual < v THEN
        RETURN jsonb_build_object('status','insufficient_manual_amount');
      END IF;
      UPDATE public.metas_financeiras SET valor_atual = valor_atual +
        CASE WHEN a.kind='goal_add' THEN v ELSE -v END
        WHERE id=m.id AND user_id=p_user_id;
    ELSIF a.kind='goal_edit' THEN
      v_field := a.payload->>'field';
      v_before := a.payload->>'before';
      IF v_field='name' THEN
        v_name := trim(a.payload->>'value');
        IF m.nome IS DISTINCT FROM v_before OR length(v_name) NOT BETWEEN 2 AND 80 THEN
          RETURN jsonb_build_object('status','changed_or_invalid'); END IF;
        UPDATE public.metas_financeiras SET nome=v_name WHERE id=m.id;
      ELSIF v_field='target' THEN
        v := (a.payload->>'value')::numeric;
        IF m.valor_objetivo IS DISTINCT FROM v_before::numeric OR v <= 0 OR v > 99999999 THEN
          RETURN jsonb_build_object('status','changed_or_invalid'); END IF;
        UPDATE public.metas_financeiras SET valor_objetivo=v WHERE id=m.id;
      ELSIF v_field='date' THEN
        IF coalesce(m.prazo::text,'') IS DISTINCT FROM v_before THEN
          RETURN jsonb_build_object('status','changed_or_invalid'); END IF;
        UPDATE public.metas_financeiras SET prazo=(a.payload->>'value')::date WHERE id=m.id;
      ELSE RETURN jsonb_build_object('status','invalid'); END IF;
    ELSE
      -- The legacy FK would cascade-delete movement history. Refuse this
      -- operation when such history exists; the site can handle it separately.
      IF EXISTS (SELECT 1 FROM public.movimentacoes_meta
                 WHERE user_id=p_user_id AND meta_id=m.id) THEN
        RETURN jsonb_build_object('status','has_history');
      END IF;
      UPDATE public.dinheiro_guardado SET meta_id=NULL
        WHERE user_id=p_user_id AND meta_id=m.id;
      DELETE FROM public.metas_financeiras WHERE id=m.id AND user_id=p_user_id;
    END IF;
    v_result := m.id;

  ELSIF a.kind = 'recurrence_create' THEN
    v_name := trim(a.payload->>'name'); v := (a.payload->>'amount')::numeric;
    IF length(v_name) NOT BETWEEN 2 AND 80 OR v <= 0 OR v > 99999999
      OR (a.payload->>'frequency') NOT IN ('mensal','semanal','quinzenal','anual') THEN
      RETURN jsonb_build_object('status','invalid'); END IF;
    IF EXISTS (SELECT 1 FROM public.recorrencias WHERE user_id=p_user_id
      AND lower(nome)=lower(v_name) AND valor=v
      AND frequencia=a.payload->>'frequency' AND status NOT IN ('cancelada','excluida')) THEN
      RETURN jsonb_build_object('status','duplicate'); END IF;
    INSERT INTO public.recorrencias(user_id,nome,valor,frequencia,proxima_cobranca,
      status,tipo_recorrencia,origem,moeda)
    VALUES(p_user_id,v_name,v,a.payload->>'frequency',
      CASE WHEN a.payload ? 'date' THEN (a.payload->>'date')::date ELSE NULL END,
      'ativa',a.payload->>'type','manual','BRL') RETURNING id INTO v_result;

  ELSIF a.kind IN ('recurrence_edit','recurrence_cancel') THEN
    SELECT * INTO r FROM public.recorrencias
      WHERE id=a.target_id AND user_id=p_user_id AND status NOT IN ('cancelada','excluida') FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
    IF a.kind='recurrence_cancel' THEN
      UPDATE public.recorrencias SET status='cancelada' WHERE id=r.id;
    ELSE
      v_field := a.payload->>'field'; v_before := a.payload->>'before';
      IF v_field='amount' THEN
        v := (a.payload->>'value')::numeric;
        IF r.valor IS DISTINCT FROM v_before::numeric OR v<=0 OR v>99999999 THEN
          RETURN jsonb_build_object('status','changed_or_invalid'); END IF;
        UPDATE public.recorrencias SET valor=v, ultimo_valor=r.valor WHERE id=r.id;
      ELSIF v_field='date' THEN
        IF coalesce(r.proxima_cobranca::text,'') IS DISTINCT FROM v_before THEN
          RETURN jsonb_build_object('status','changed_or_invalid'); END IF;
        UPDATE public.recorrencias SET proxima_cobranca=(a.payload->>'value')::date WHERE id=r.id;
      ELSE RETURN jsonb_build_object('status','invalid'); END IF;
    END IF;
    v_result := r.id;

  ELSIF a.kind='card_edit' THEN
    SELECT * INTO c FROM public.cartoes WHERE id=a.target_id AND user_id=p_user_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
    v_field := a.payload->>'field'; v_before := a.payload->>'before';
    IF v_field='name' THEN
      v_name := trim(a.payload->>'value');
      IF c.nome IS DISTINCT FROM v_before OR length(v_name) NOT BETWEEN 1 AND 40 THEN
        RETURN jsonb_build_object('status','changed_or_invalid'); END IF;
      UPDATE public.cartoes SET nome=v_name WHERE id=c.id;
    ELSIF v_field='bank' THEN
      v_name := trim(a.payload->>'value');
      IF c.banco IS DISTINCT FROM v_before OR length(v_name) NOT BETWEEN 2 AND 60
        OR v_name ~ '[0-9]' THEN
        RETURN jsonb_build_object('status','changed_or_invalid'); END IF;
      UPDATE public.cartoes SET banco=v_name WHERE id=c.id;
    ELSIF v_field='limit' THEN
      v := (a.payload->>'value')::numeric;
      IF c.limite_total IS DISTINCT FROM v_before::numeric OR v<=0 OR v>99999999 THEN
        RETURN jsonb_build_object('status','changed_or_invalid'); END IF;
      UPDATE public.cartoes SET limite_total=v WHERE id=c.id;
    ELSIF v_field='closing' THEN
      v := (a.payload->>'value')::numeric;
      IF c.dia_fechamento::text IS DISTINCT FROM v_before OR v NOT BETWEEN 1 AND 31 THEN
        RETURN jsonb_build_object('status','changed_or_invalid'); END IF;
      UPDATE public.cartoes SET dia_fechamento=v WHERE id=c.id;
    ELSIF v_field='due' THEN
      v := (a.payload->>'value')::numeric;
      IF c.dia_vencimento::text IS DISTINCT FROM v_before OR v NOT BETWEEN 1 AND 31 THEN
        RETURN jsonb_build_object('status','changed_or_invalid'); END IF;
      UPDATE public.cartoes SET dia_vencimento=v WHERE id=c.id;
    ELSE RETURN jsonb_build_object('status','invalid'); END IF;
    v_result := c.id;
  ELSE RETURN jsonb_build_object('status','invalid'); END IF;

  UPDATE public.whatsapp_planning_actions SET state='applied',applied_at=now(),result_id=v_result
    WHERE id=a.id;
  RETURN jsonb_build_object('status','applied','id',v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.whatsapp_apply_planning_action(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_apply_planning_action(uuid,uuid,text) TO service_role;

-- Existing per-category preferences are reused. New proactive classes default
-- to OFF. No silent opt-in for an account that had older reminders enabled.
ALTER TABLE public.whatsapp_notification_preferences
  ADD COLUMN IF NOT EXISTS faturas boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS renovacao_assinatura boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resumo_semanal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resumo_mensal boolean NOT NULL DEFAULT false;

ALTER TABLE public.whatsapp_notification_templates
  DROP CONSTRAINT IF EXISTS whatsapp_notification_templates_category_check;
ALTER TABLE public.whatsapp_notification_templates
  ADD CONSTRAINT whatsapp_notification_templates_category_check CHECK (category IN (
    'contas_a_pagar','recorrencias','metas','orcamento','ia_insights','mercado',
    'avisos_sistema','agenda','faturas','renovacao_assinatura',
    'resumo_semanal','resumo_mensal'
  ));

-- Catalog placeholders only. No Meta template ID/name is assigned and no
-- sending is enabled. Operations must approve, map and activate each one.
INSERT INTO public.whatsapp_notification_templates
  (key,category,default_priority,requires_template_window,meta_template_name,payload_schema,active)
VALUES
  ('gi_orcamento_limiar','orcamento','media',true,NULL,'{"required":["limit_id","month","threshold"]}'::jsonb,false),
  ('gi_fatura_proxima','faturas','media',true,NULL,'{"required":["card_id","due_date"]}'::jsonb,false),
  ('gi_assinatura_renovacao','renovacao_assinatura','baixa',true,NULL,'{"required":["recurrence_id","due_date"]}'::jsonb,false),
  ('gi_meta_atingida','metas','baixa',true,NULL,'{"required":["goal_id","target"]}'::jsonb,false),
  ('gi_resumo_semanal','resumo_semanal','baixa',true,NULL,'{"required":["period"]}'::jsonb,false),
  ('gi_resumo_mensal','resumo_mensal','baixa',true,NULL,'{"required":["period"]}'::jsonb,false)
ON CONFLICT (key) DO NOTHING;
