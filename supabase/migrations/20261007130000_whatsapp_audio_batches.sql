CREATE TABLE public.whatsapp_audio_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_hash text NOT NULL CHECK (phone_hash ~ '^[a-f0-9]{64}$'),
  source_external_id text NOT NULL,
  items jsonb NOT NULL CHECK (jsonb_typeof(items)='array' AND jsonb_array_length(items) BETWEEN 1 AND 10),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,source_external_id)
);
ALTER TABLE public.whatsapp_audio_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_audio_batches FROM anon,authenticated;
GRANT ALL ON public.whatsapp_audio_batches TO service_role;

CREATE FUNCTION public.whatsapp_audio_batch_item(p_owner uuid,p_phone_hash text,p_batch uuid,p_index integer,p_action text,p_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE batch public.whatsapp_audio_batches%ROWTYPE; item jsonb; new_state text; result_text text;
BEGIN
  -- Serialize selection across different batches of the same conversation.
  PERFORM pg_advisory_xact_lock(hashtextextended('wa-audio:'||p_owner::text||':'||p_phone_hash,0));
  SELECT * INTO batch FROM public.whatsapp_audio_batches
    WHERE id=p_batch AND user_id=p_owner AND phone_hash=p_phone_hash FOR UPDATE;
  IF NOT FOUND OR batch.expires_at <= now() OR p_index<0 OR p_index>=jsonb_array_length(batch.items)
    THEN RETURN jsonb_build_object('outcome','unavailable'); END IF;
  item=batch.items->p_index;
  IF p_action='pick' AND (
    EXISTS(SELECT 1 FROM public.whatsapp_audio_batches b,
      LATERAL jsonb_array_elements(b.items) entry
      WHERE b.user_id=p_owner AND b.phone_hash=p_phone_hash AND b.expires_at>now() AND entry->>'state'='processing')
    OR EXISTS(SELECT 1 FROM public.whatsapp_messages WHERE user_id=p_owner AND recebida_em>now()-interval '30 minutes'
      AND (status LIKE 'aguardando_%' OR status LIKE 'rec_aguardando_%' OR status LIKE 'img_aguardando_%'))
  ) THEN RETURN jsonb_build_object('outcome','pending_confirmation'); END IF;
  IF p_action='finish' AND item->>'state'='processing' THEN
    new_state='routed';
  ELSIF item->>'state'='routed' THEN RETURN jsonb_build_object('outcome','already_routed');
  ELSIF item->>'state'<>'pending' THEN RETURN jsonb_build_object('outcome','unavailable');
  ELSIF p_action='cancel' THEN new_state='cancelled';
  ELSIF p_action='edit' THEN
    IF p_text IS NULL OR length(trim(p_text)) NOT BETWEEN 1 AND 1000 THEN RETURN jsonb_build_object('outcome','invalid'); END IF;
    item=jsonb_set(item,'{text}',to_jsonb(trim(p_text)));
    UPDATE public.whatsapp_audio_batches SET items=jsonb_set(items,ARRAY[p_index::text],item) WHERE id=p_batch;
    RETURN jsonb_build_object('outcome','edited');
  ELSIF p_action='pick' THEN new_state='processing'; result_text=item->>'text';
  ELSE RETURN jsonb_build_object('outcome','invalid'); END IF;
  item=jsonb_set(item,'{state}',to_jsonb(new_state));
  IF new_state IN ('cancelled','routed') THEN item=jsonb_set(item,'{text}','""'::jsonb); END IF;
  UPDATE public.whatsapp_audio_batches SET items=jsonb_set(items,ARRAY[p_index::text],item) WHERE id=p_batch;
  RETURN jsonb_build_object('outcome',CASE new_state WHEN 'processing' THEN 'picked' ELSE new_state END,'text',result_text);
END $$;
REVOKE ALL ON FUNCTION public.whatsapp_audio_batch_item(uuid,text,uuid,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_audio_batch_item(uuid,text,uuid,integer,text,text) TO service_role;

CREATE FUNCTION public.whatsapp_audio_scrub_expired()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE affected integer;
BEGIN
  UPDATE public.whatsapp_audio_batches b SET items=(
    SELECT jsonb_agg(entry || jsonb_build_object('text','','state','cancelled'))
      FROM jsonb_array_elements(b.items) entry)
    WHERE expires_at <= now() AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.items) entry WHERE entry->>'text'<>'');
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END $$;
REVOKE ALL ON FUNCTION public.whatsapp_audio_scrub_expired() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_audio_scrub_expired() TO service_role;
