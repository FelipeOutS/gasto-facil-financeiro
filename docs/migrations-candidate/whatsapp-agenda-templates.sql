-- CANDIDATO INATIVO. Depende dos catálogos C8/C11 e planning_actions (categoria agenda).
-- Não submete à Meta, não aprova templates, não ativa notificações nem cron.
BEGIN;
INSERT INTO public.whatsapp_notification_templates
 (key,category,default_priority,requires_template_window,meta_template_name,payload_schema,active)
VALUES
 ('gi_agenda_lembrete','agenda','media',true,'gi_agenda_lembrete_v1','{"language":"pt_BR","required":["1","2"],"body_params_order":["1","2"]}',false),
 ('gi_agenda_financeiro','agenda','media',true,'gi_agenda_financeiro_v1','{"language":"pt_BR","required":["1","2"],"body_params_order":["1","2"]}',false)
ON CONFLICT(key) DO NOTHING;
INSERT INTO public.whatsapp_meta_templates
 (notification_key,internal_key,meta_name,language,category,version,body,footer,placeholder_schema,examples,status,active)
VALUES
 ('gi_agenda_lembrete','gi_agenda_lembrete','gi_agenda_lembrete_v1','pt_BR','UTILITY',1,
 E'Lembrete solicitado para {{1}}: {{2}}. Confira o horário e os detalhes na Agenda do Gasto Inteligente. Para parar, responda PARAR.',
 'Gasto Inteligente',
 '{"1":{"type":"date","format":"dd/mm/yyyy","required":true},"2":{"type":"label","min":1,"max":40,"required":true,"sanitize":true}}',
 '{"1":"28/10/2026","2":"Lembrete da Agenda"}','draft',false),
 ('gi_agenda_financeiro','gi_agenda_financeiro','gi_agenda_financeiro_v1','pt_BR','UTILITY',1,
 E'Lembrete financeiro solicitado para {{1}}: {{2}}. Consulte os valores e o estado atualizado no Gasto Inteligente. Para parar, responda PARAR.',
 'Gasto Inteligente',
 '{"1":{"type":"date","format":"dd/mm/yyyy","required":true},"2":{"type":"label","min":1,"max":40,"required":true,"sanitize":true}}',
 '{"1":"28/10/2026","2":"Lembrete da Agenda"}','draft',false)
ON CONFLICT(internal_key,version) DO NOTHING;
COMMIT;
-- Rollback: desativar somente estas duas chaves. Preservar catálogo e histórico;
-- não excluir registros referenciados. Submissão/aprovação/ativação são operações separadas.
