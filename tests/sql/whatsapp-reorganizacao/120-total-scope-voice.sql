-- Escopo total (start/end NULL) inclui o mês atual; restauração por voz resolve o último lote.
-- Depende do estado deixado por 110-partial-scope.sql (gastos 5a5a...01..05 restaurados/íntegros).
UPDATE public.whatsapp_reorganization_policy SET release_enabled=true;

-- Escopo total: elegíveis = livre antigo (01) + mês atual (04); parcelado (02) e recorrente (03) ficam de fora.
SELECT public.assert_true(public.wa_reorganization_prepare_v2('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','total-1','{"tables":["gastos","receitas"],"start":null,"end":null}',null,'918276')->>'status'='preview','total scope preview');
SELECT public.assert_true((SELECT snapshot @> '[{"table":"gastos","row":{"id":"5a5a5a5a-0000-0000-0000-000000000004"}}]' FROM whatsapp_reorganization_operations WHERE request_id='total-1'),'total scope includes current month row');
SELECT public.assert_true((SELECT snapshot @> '[{"table":"gastos","row":{"id":"5a5a5a5a-0000-0000-0000-000000000001"}}]' FROM whatsapp_reorganization_operations WHERE request_id='total-1'),'total scope includes free old row');
SELECT public.assert_true((SELECT NOT snapshot @> '[{"row":{"id":"5a5a5a5a-0000-0000-0000-000000000002"}}]' AND NOT snapshot @> '[{"row":{"id":"5a5a5a5a-0000-0000-0000-000000000003"}}]' FROM whatsapp_reorganization_operations WHERE request_id='total-1'),'linked rows stay out of total snapshot');
SELECT public.assert_true((SELECT left_out @> '[{"motivo":"parcelado","n":1,"total":300},{"motivo":"recorrente","n":1,"total":40}]' FROM whatsapp_reorganization_operations WHERE request_id='total-1'),'total scope lists linked rows as left out');
SELECT public.assert_true((SELECT count(*)=5 FROM gastos WHERE id::text LIKE '5a5a5a5a%' AND deleted_at IS NULL),'total preview writes nothing');

SELECT public.assert_true(public.wa_reorganization_confirm_v2('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','918276',(SELECT id FROM whatsapp_reorganization_operations WHERE request_id='total-1'))->>'status'='applied','total scope applied');
SELECT public.assert_true((SELECT deleted_at IS NOT NULL FROM gastos WHERE id='5a5a5a5a-0000-0000-0000-000000000004'),'current month row deleted in total scope');
SELECT public.assert_true((SELECT deleted_at IS NULL FROM gastos WHERE id='5a5a5a5a-0000-0000-0000-000000000002'),'linked row stays out in total scope');

-- Restauração por voz: resolve o lote aplicado mais recente do titular.
SELECT public.assert_true(public.wa_reorganization_last_applied('aaaaaaaa-0000-0000-0000-000000000001','5511999999999')=(SELECT id FROM whatsapp_reorganization_operations WHERE request_id='total-1'),'last applied resolves latest batch');
SELECT public.assert_true(public.wa_reorganization_last_applied('cccccccc-0000-0000-0000-000000000003','5511999999999') IS NULL,'other user has no last batch');
SELECT public.assert_true(NOT has_function_privilege('authenticated','public.wa_reorganization_last_applied(uuid,text)','EXECUTE'),'last_applied not callable by authenticated');

-- Restaura o lote total; depois disso não há mais lote aplicado para resolver.
SELECT public.wa_reorganization_restore_prepare('aaaaaaaa-0000-0000-0000-000000000001','5511999999999',(SELECT id FROM whatsapp_reorganization_operations WHERE request_id='total-1'),'918277');
SELECT public.assert_true(public.wa_reorganization_control('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','restore:'||(SELECT id FROM whatsapp_reorganization_operations WHERE request_id='total-1')||':918277')->>'status'='restored','total batch restored');
SELECT public.assert_true((SELECT count(*)=5 FROM gastos WHERE id::text LIKE '5a5a5a5a%' AND deleted_at IS NULL),'total restore returns only own batch');
SELECT public.assert_true(public.wa_reorganization_last_applied('aaaaaaaa-0000-0000-0000-000000000001','5511999999999') IS DISTINCT FROM (SELECT id FROM whatsapp_reorganization_operations WHERE request_id='total-1'),'restored batch no longer resolves as applied');

UPDATE public.whatsapp_reorganization_policy SET release_enabled=false;
SELECT public.assert_true(public.wa_reorganization_last_applied('aaaaaaaa-0000-0000-0000-000000000001','5511999999999') IS NULL,'release off: last applied fails closed');
