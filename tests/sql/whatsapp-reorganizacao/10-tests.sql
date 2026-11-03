CREATE FUNCTION public.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
INSERT INTO public.whatsapp_links VALUES('aaaaaaaa-0000-0000-0000-000000000001','5511999999999',true,now(),null);
INSERT INTO public.gastos(id,user_id,descricao,valor,data,forma_pagamento) VALUES
 ('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Mercado',10,'2026-10-01','pix'),
 ('11111111-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Atual',20,'2026-11-01','pix'),
 ('11111111-0000-0000-0000-000000000003','cccccccc-0000-0000-0000-000000000003','Outro',30,'2026-10-01','pix');
INSERT INTO public.receitas(id,user_id,descricao,valor,data) VALUES('22222222-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Antiga',50,'2026-10-01');
SELECT public.assert_true(NOT public.wa_reorganization_authorized('aaaaaaaa-0000-0000-0000-000000000001','5511999999999'),'policy absent blocks');
-- Local isolated fixture only, never production release.
INSERT INTO public.whatsapp_reorganization_policy VALUES(true,true);
SELECT public.assert_true(NOT has_function_privilege('authenticated','public.wa_reorganization_confirm(uuid,text,text,uuid)','EXECUTE'),'authenticated cannot execute');
SELECT public.assert_true(NOT has_table_privilege('authenticated','public.whatsapp_reorganization_operations','SELECT'),'journal private');
SELECT public.assert_true(NOT public.wa_reorganization_authorized('cccccccc-0000-0000-0000-000000000003','5511999999999'),'other owner blocked');
SELECT public.assert_true(NOT public.wa_reorganization_authorized('aaaaaaaa-0000-0000-0000-000000000001','5511888888888'),'wrong phone blocked');
SELECT public.wa_reorganization_prepare('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','one','{"tables":["gastos","receitas"],"start":null,"end":"2026-11-01"}','{"descricao":"Salário","valor":4500,"data":"2026-11-03","tipo":"salario"}','004821');
SELECT public.assert_true((SELECT count(*)=3 FROM gastos WHERE deleted_at IS NULL),'preview no mutation');
SELECT public.assert_true(public.wa_reorganization_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','sim')->>'status'='wrong_code','sim denied');
SELECT public.assert_true(public.wa_reorganization_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','004820')->>'status'='wrong_code','wrong code denied');
SELECT public.assert_true(public.wa_reorganization_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','004821')->>'status'='applied','atomic compound applied');
SELECT public.assert_true((SELECT deleted_at IS NOT NULL AND deleted_by=user_id AND deletion_batch_id IS NOT NULL AND deletion_source='whatsapp_periodo' FROM gastos WHERE id='11111111-0000-0000-0000-000000000001'),'F2 markers coherent');
SELECT public.assert_true((SELECT sum(valor)=4500 FROM receitas WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001' AND deleted_at IS NULL),'income total exact');
SELECT public.assert_true((SELECT count(*)=3 FROM gastos),'no physical delete');
SELECT public.assert_true((SELECT count(*)=2 FROM gastos WHERE deleted_at IS NULL),'current month and other owner preserved');
SELECT public.assert_true(public.wa_reorganization_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','004821')->>'status'='replay','repeat confirmation idempotent');
SELECT public.assert_true((SELECT count(*)=2 FROM receitas),'no duplicate income');
UPDATE public.whatsapp_reorganization_policy SET release_enabled=false;
SELECT public.assert_true(public.wa_reorganization_control('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','restore')->>'status'='blocked','bare restore blocked');
SELECT public.wa_reorganization_restore_prepare('aaaaaaaa-0000-0000-0000-000000000001','5511999999999',(SELECT id FROM whatsapp_reorganization_operations WHERE request_id='one'),'121212');
SELECT public.assert_true(public.wa_reorganization_control('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','restore:'||(SELECT id FROM whatsapp_reorganization_operations WHERE request_id='one')||':121212')->>'status'='restored','confirmed restore while release paused');
SELECT public.assert_true((SELECT count(*)=3 FROM gastos WHERE deleted_at IS NULL),'restored old rows');
SELECT public.assert_true((SELECT sum(valor)=50 FROM receitas WHERE deleted_at IS NULL),'compound new income soft reverted');
SELECT public.assert_true(public.wa_reorganization_control('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','restore:'||(SELECT id FROM whatsapp_reorganization_operations WHERE request_id='one')||':121212')->>'status'='replay','repeat restore idempotent');
UPDATE public.whatsapp_reorganization_policy SET release_enabled=true;
SELECT public.wa_reorganization_prepare('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','two','{"tables":["gastos"],"start":null,"end":"2026-11-01"}',null,'111111');
UPDATE public.whatsapp_reorganization_operations SET expires_at=now()-interval '1 second' WHERE request_id='two';
SELECT public.assert_true(public.wa_reorganization_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','111111')->>'status'='expired','expired denied');
SELECT public.wa_reorganization_prepare('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','three','{"tables":["gastos"],"start":null,"end":"2026-11-01"}',null,'222222');
SELECT public.assert_true(public.wa_reorganization_control('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','cancel')->>'status'='cancelled','cancel');
SELECT public.assert_true(public.wa_reorganization_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','222222')->>'status'='cancelled','cancel cannot confirm');
SELECT public.wa_reorganization_prepare('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','four','{"tables":["gastos"],"start":null,"end":"2026-11-01"}',null,'333333');
UPDATE gastos SET valor=11 WHERE id='11111111-0000-0000-0000-000000000001';
SELECT public.assert_true(public.wa_reorganization_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','333333')->>'status'='changed','full snapshot catches edit without version bump');
CREATE FUNCTION public.fail_income() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.descricao='FALHA' THEN RAISE EXCEPTION 'simulated'; END IF; RETURN NEW; END $$;
CREATE TRIGGER fail_income BEFORE INSERT ON receitas FOR EACH ROW EXECUTE FUNCTION public.fail_income();
SELECT public.wa_reorganization_prepare('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','five','{"tables":["gastos"],"start":null,"end":"2026-11-01"}','{"descricao":"FALHA","valor":4500,"data":"2026-11-03","tipo":"outros"}','444444');
DO $$ BEGIN PERFORM public.wa_reorganization_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','444444'); RAISE EXCEPTION 'expected failure'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'simulated' THEN RAISE; END IF; END $$;
SELECT public.assert_true((SELECT count(*)=3 FROM gastos WHERE deleted_at IS NULL),'income failure rolls back deletion');
SELECT public.assert_true((SELECT status='preview' FROM whatsapp_reorganization_operations WHERE request_id='five'),'failure does not consume operation');
DROP TRIGGER fail_income ON receitas;
SELECT public.wa_reorganization_prepare('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','six','{"tables":["gastos"],"start":null,"end":"2026-11-01"}',null,'555555');
SELECT public.wa_reorganization_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','555555');
SELECT set_config('gi.gastos_soft_delete','on',false);
UPDATE gastos SET descricao='Editada depois' WHERE id='11111111-0000-0000-0000-000000000001';
SELECT set_config('gi.gastos_soft_delete','off',false);
SELECT public.wa_reorganization_restore_prepare('aaaaaaaa-0000-0000-0000-000000000001','5511999999999',(SELECT id FROM whatsapp_reorganization_operations WHERE request_id='six'),'343434');
SELECT public.assert_true((public.wa_reorganization_control('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','restore:'||(SELECT id FROM whatsapp_reorganization_operations WHERE request_id='six')||':343434')->>'kept')::int=1,'partial restore preserves changed snapshot');
SELECT public.assert_true((SELECT deleted_at IS NULL AND valor=30 FROM gastos WHERE id='11111111-0000-0000-0000-000000000003'),'other owner still untouched');

-- Linked rows cause all-or-nothing refusal, never silent partial cleanup.
INSERT INTO gastos(id,user_id,descricao,valor,data,cartao_id) VALUES('33333333-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Cartão',40,'2026-12-01','99999999-0000-0000-0000-000000000001');
DO $$ BEGIN
 PERFORM public.wa_reorganization_prepare('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','linked','{"tables":["gastos"],"start":"2026-12-01","end":"2027-01-01"}',null,'666666');
 RAISE EXCEPTION 'expected failure';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'linked_scope_blocked' THEN RAISE; END IF;
END $$;
SELECT public.assert_true((SELECT deleted_at IS NULL FROM gastos WHERE id='33333333-0000-0000-0000-000000000001'),'linked card preserved');
SELECT public.wa_reorganization_prepare('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','attempts','{"tables":["receitas"],"start":null,"end":"2026-11-01"}',null,'777777');
SELECT public.wa_reorganization_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','000000') FROM generate_series(1,5);
SELECT public.assert_true((SELECT failed_attempts=0 FROM whatsapp_reorganization_operations WHERE request_id='attempts'),'unrelated codes do not charge latest operation');
SELECT public.assert_true((SELECT sum(valor)=50 FROM receitas WHERE deleted_at IS NULL),'unrecognized codes do not mutate income');