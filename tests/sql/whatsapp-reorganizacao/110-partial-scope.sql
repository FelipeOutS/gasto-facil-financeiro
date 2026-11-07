-- Escopo parcial explícito: vinculados ficam de fora, intactos e listados; elegíveis atômicos.
UPDATE public.whatsapp_reorganization_policy SET release_enabled=true;
SELECT set_config('gi.reorganization_mutation','on',false); -- fixture insert only
INSERT INTO gastos(id,user_id,descricao,valor,data,forma_pagamento) VALUES
 ('5a5a5a5a-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Livre antigo',150,'2031-03-10','pix');
INSERT INTO gastos(id,user_id,descricao,valor,data,forma_pagamento,total_parcelas) VALUES
 ('5a5a5a5a-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Parcela antiga',300,'2031-03-11','pix',3);
INSERT INTO gastos(id,user_id,descricao,valor,data,forma_pagamento,recorrencia_id) VALUES
 ('5a5a5a5a-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','Assinatura antiga',40,'2031-03-12','pix',gen_random_uuid());
INSERT INTO gastos(id,user_id,descricao,valor,data,forma_pagamento) VALUES
 ('5a5a5a5a-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','Mês atual',70,'2031-04-02','pix'),
 ('5a5a5a5a-0000-0000-0000-000000000005','cccccccc-0000-0000-0000-000000000003','Outro usuário',999,'2031-03-10','pix');
SELECT set_config('gi.reorganization_mutation','off',false);
SELECT public.assert_true(public.wa_reorganization_prepare_v2('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','partial-1','{"tables":["gastos"],"start":"2031-03-01","end":"2031-04-01"}',null,'918273')->>'status'='preview','partial preview instead of refusal');
SELECT public.assert_true((SELECT jsonb_array_length(snapshot)=1 FROM whatsapp_reorganization_operations WHERE request_id='partial-1'),'only free entry eligible');
SELECT public.assert_true((SELECT left_out @> '[{"motivo":"parcelado","n":1,"total":300},{"motivo":"recorrente","n":1,"total":40}]' FROM whatsapp_reorganization_operations WHERE request_id='partial-1'),'left out listed with value');
SELECT public.assert_true((SELECT count(*)=5 FROM gastos WHERE id::text LIKE '5a5a5a5a%' AND deleted_at IS NULL),'preview writes nothing');
SELECT public.assert_true(public.wa_reorganization_confirm_v2('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','918273',(SELECT id FROM whatsapp_reorganization_operations WHERE request_id='partial-1'))->'leftOut' @> '[{"motivo":"parcelado"}]','applied result reports left out');
SELECT public.assert_true((SELECT deleted_at IS NOT NULL FROM gastos WHERE id='5a5a5a5a-0000-0000-0000-000000000001'),'eligible deleted reversibly');
SELECT public.assert_true((SELECT count(*)=4 FROM gastos WHERE id::text LIKE '5a5a5a5a%' AND id<>'5a5a5a5a-0000-0000-0000-000000000001' AND deleted_at IS NULL),'left out, current month and other user intact');
SELECT public.assert_true(public.wa_reorganization_confirm_v2('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','918273',(SELECT id FROM whatsapp_reorganization_operations WHERE request_id='partial-1'))->>'status'='replay','partial replay idempotent');
SELECT public.wa_reorganization_restore_prepare('aaaaaaaa-0000-0000-0000-000000000001','5511999999999',(SELECT id FROM whatsapp_reorganization_operations WHERE request_id='partial-1'),'918274');
SELECT public.assert_true(public.wa_reorganization_control('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','restore:'||(SELECT id FROM whatsapp_reorganization_operations WHERE request_id='partial-1')||':918274')->>'status'='restored','partial batch restored');
SELECT public.assert_true((SELECT count(*)=5 FROM gastos WHERE id::text LIKE '5a5a5a5a%' AND deleted_at IS NULL),'restore returns only own batch, nothing else changed');
SELECT public.assert_true(public.wa_reorganization_prepare_v2('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','partial-2','{"tables":["gastos"],"start":"2031-03-11","end":"2031-03-13"}',null,'918275')->>'status'='nothing_eligible','only linked rows: explicit nothing eligible');
SELECT public.assert_true(NOT has_function_privilege('authenticated','public.wa_reorganization_prepare_v2(uuid,text,text,jsonb,jsonb,text,jsonb)','EXECUTE'),'v2 not callable by authenticated');
UPDATE public.whatsapp_reorganization_policy SET release_enabled=false;
