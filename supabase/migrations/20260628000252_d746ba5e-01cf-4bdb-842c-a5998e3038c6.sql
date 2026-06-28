-- WA-C9: seed dos templates de lembrete de contas a pagar
INSERT INTO public.whatsapp_notification_templates
  (key, category, default_priority, requires_template_window, meta_template_name, payload_schema, active)
VALUES
  (
    'gi_conta_vencendo_hoje',
    'contas_a_pagar',
    'alta',
    true,
    NULL,
    '{"required":["conta_id","due_date","valor_centavos","type"]}'::jsonb,
    true
  ),
  (
    'gi_conta_vencendo_amanha',
    'contas_a_pagar',
    'media',
    true,
    NULL,
    '{"required":["conta_id","due_date","valor_centavos","type"]}'::jsonb,
    true
  ),
  (
    'gi_conta_atrasada',
    'contas_a_pagar',
    'alta',
    true,
    NULL,
    '{"required":["conta_id","due_date","valor_centavos","type"]}'::jsonb,
    true
  ),
  (
    'gi_conta_recorrente_pendente',
    'contas_a_pagar',
    'baixa',
    true,
    NULL,
    '{"required":["conta_id","due_date","valor_centavos","type"]}'::jsonb,
    true
  )
ON CONFLICT (key) DO NOTHING;
