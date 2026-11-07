-- Local proposal lifecycle only. Does not alter the four pending migrations.
CREATE TABLE public.whatsapp_reminder_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_external_id text NOT NULL,
  draft jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','confirmed','cancelled')),
  agenda_item_id uuid REFERENCES public.agenda_items(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,source_external_id)
);
ALTER TABLE public.whatsapp_reminder_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_reminder_proposals FROM anon, authenticated;
GRANT ALL ON public.whatsapp_reminder_proposals TO service_role;

-- Placeholders only; never imply approval or turn on sending. Depends on
-- planning_actions' category constraint accepting 'agenda'.
INSERT INTO public.whatsapp_notification_templates
  (key,category,default_priority,requires_template_window,meta_template_name,payload_schema,active)
VALUES
  ('gi_agenda_lembrete','agenda','media',true,NULL,
    '{"required":["agenda_titulo","agenda_quando"],"body_params_order":["agenda_titulo","agenda_quando"]}'::jsonb,false),
  ('gi_agenda_financeiro','agenda','alta',true,NULL,
    '{"required":["agenda_nome","agenda_prazo","agenda_valor","agenda_vencimento"],"body_params_order":["agenda_nome","agenda_prazo","agenda_valor","agenda_vencimento"]}'::jsonb,false)
ON CONFLICT (key) DO NOTHING;

CREATE FUNCTION public.whatsapp_reminder_resolve(p_owner uuid, p_proposal uuid, p_confirm boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE proposal public.whatsapp_reminder_proposals%ROWTYPE; item public.agenda_items%ROWTYPE;
  source_kind text; source_uuid uuid; owned boolean := false;
BEGIN
  SELECT * INTO proposal FROM public.whatsapp_reminder_proposals
    WHERE id=p_proposal AND user_id=p_owner FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','unavailable'); END IF;
  IF proposal.state='confirmed' THEN
    SELECT * INTO item FROM public.agenda_items WHERE id=proposal.agenda_item_id AND user_id=p_owner;
    RETURN jsonb_build_object('outcome','confirmed','item',to_jsonb(item));
  END IF;
  IF proposal.state='cancelled' THEN RETURN jsonb_build_object('outcome','cancelled'); END IF;
  IF proposal.expires_at <= now() THEN
    UPDATE public.whatsapp_reminder_proposals SET state='cancelled',draft='{}'::jsonb WHERE id=proposal.id;
    RETURN jsonb_build_object('outcome','expired');
  END IF;
  IF NOT p_confirm THEN
    UPDATE public.whatsapp_reminder_proposals SET state='cancelled', draft='{}'::jsonb WHERE id=proposal.id;
    RETURN jsonb_build_object('outcome','cancelled');
  END IF;
  source_kind=proposal.draft->>'source_type';
  source_uuid=(proposal.draft->>'source_id')::uuid;
  IF source_kind IS NOT NULL THEN
    IF source_kind='cartao' THEN SELECT EXISTS(SELECT 1 FROM public.cartoes WHERE id=source_uuid AND user_id=p_owner) INTO owned;
    ELSIF source_kind='conta_a_pagar' THEN SELECT EXISTS(SELECT 1 FROM public.contas_a_pagar WHERE id=source_uuid AND user_id=p_owner AND status='pendente') INTO owned;
    ELSIF source_kind='recorrencia' THEN SELECT EXISTS(SELECT 1 FROM public.recorrencias WHERE id=source_uuid AND user_id=p_owner) INTO owned;
    END IF;
    IF NOT owned THEN RETURN jsonb_build_object('outcome','unavailable'); END IF;
  ELSIF (proposal.draft->>'starts_at') IS NULL OR (proposal.draft->>'starts_at')::timestamptz <= now() THEN
    RETURN jsonb_build_object('outcome','expired');
  END IF;
  INSERT INTO public.agenda_items(user_id,kind,titulo,starts_at,timezone,recurrence_freq,origem,
    source_type,source_id,aviso_dias_antes,aviso_hora_local)
    VALUES(p_owner,proposal.draft->>'kind',proposal.draft->>'titulo',
      (proposal.draft->>'starts_at')::timestamptz,proposal.draft->>'timezone',
      proposal.draft->>'recurrence_freq','whatsapp',source_kind,source_uuid,
      (proposal.draft->>'aviso_dias_antes')::integer,coalesce((proposal.draft->>'aviso_hora_local')::integer,9)) RETURNING * INTO item;
  UPDATE public.whatsapp_reminder_proposals SET state='confirmed',agenda_item_id=item.id,draft='{}'::jsonb WHERE id=proposal.id;
  RETURN jsonb_build_object('outcome','confirmed','item',to_jsonb(item));
END $$;
REVOKE ALL ON FUNCTION public.whatsapp_reminder_resolve(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_reminder_resolve(uuid,uuid,boolean) TO service_role;

CREATE FUNCTION public.whatsapp_reminder_scrub_expired()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE affected integer;
BEGIN
  UPDATE public.whatsapp_reminder_proposals SET state='cancelled',draft='{}'::jsonb
    WHERE state='pending' AND expires_at <= now();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END $$;
REVOKE ALL ON FUNCTION public.whatsapp_reminder_scrub_expired() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_reminder_scrub_expired() TO service_role;
