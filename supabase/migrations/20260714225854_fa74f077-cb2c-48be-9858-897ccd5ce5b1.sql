DO $$
DECLARE
  v_existing public.whatsapp_notification_templates%ROWTYPE;
  v_target_schema jsonb := jsonb_build_object(
    'required', '[]'::jsonb,
    'body_params_order', '[]'::jsonb,
    'language', 'en_US'
  );
BEGIN
  SELECT * INTO v_existing
    FROM public.whatsapp_notification_templates
   WHERE key = 'gi_teste_integracao_canary';

  IF NOT FOUND THEN
    INSERT INTO public.whatsapp_notification_templates
      (key, category, default_priority, requires_template_window,
       meta_template_name, payload_schema, active)
    VALUES
      ('gi_teste_integracao_canary',
       'avisos_sistema',
       'baixa',
       true,
       'hello_world',
       v_target_schema,
       true);
    RAISE NOTICE 'canary template inserted';
    RETURN;
  END IF;

  IF v_existing.category           <> 'avisos_sistema'
     OR v_existing.default_priority <> 'baixa'
     OR v_existing.requires_template_window IS DISTINCT FROM true
     OR v_existing.meta_template_name IS DISTINCT FROM 'hello_world'
     OR v_existing.active IS DISTINCT FROM true
     OR v_existing.payload_schema  <> v_target_schema
  THEN
    RAISE EXCEPTION
      'canary template row divergente — abortando (esperado: %; encontrado: %)',
      v_target_schema, v_existing.payload_schema;
  END IF;

  RAISE NOTICE 'canary template already present and equivalent — no-op';
END $$;