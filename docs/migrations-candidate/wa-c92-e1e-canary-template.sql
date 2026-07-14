-- ─────────────────────────────────────────────────────────────────────────────
-- WA-C9.2 Fase E.1E — Migration CANDIDATA (NÃO APLICADA nesta fase)
--
-- Objetivo: registrar UMA linha em `public.whatsapp_notification_templates`
-- mapeando o template interno `gi_teste_integracao_canary` ao template Meta
-- APPROVED `hello_world` (idioma en_US, zero placeholders, UTILITY).
--
-- Escopo:
--   * INSERT idempotente e conservador.
--   * Zero alteração em templates produtivos (gi_conta_*).
--   * Zero coluna nova, zero constraint alterada, zero policy, zero grant,
--     zero trigger, zero cron, zero notification.
--
-- Precondições esperadas (verificar antes de aplicar):
--   * tabela `whatsapp_notification_templates` existe.
--   * CHECK constraint de `category` aceita 'avisos_sistema' ✅.
--   * CHECK constraint de `default_priority` aceita 'baixa' ✅.
--
-- Comportamento:
--   * Linha inexistente     → INSERT.
--   * Linha idêntica        → no-op silencioso (bloco DO valida e retorna).
--   * Linha DIVERGENTE      → RAISE EXCEPTION explícito (fail-closed;
--                             não sobrescreve o campo). Rollback lógico:
--                             abrir migration dedicada para o DELETE/UPDATE.
--
-- Rollback lógico (documentado, NÃO executar aqui):
--   DELETE FROM public.whatsapp_notification_templates
--    WHERE key = 'gi_teste_integracao_canary';
--
-- ─────────────────────────────────────────────────────────────────────────────

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

  -- Linha existente: validar equivalência estrita.
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

-- Validação pós-migration (idempotente):
--   SELECT key, meta_template_name, payload_schema->>'language', active
--     FROM public.whatsapp_notification_templates
--    WHERE key = 'gi_teste_integracao_canary';
