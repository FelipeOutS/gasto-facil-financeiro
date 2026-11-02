-- Real F2 is already installed by runner. All IDs/data fictitious.
INSERT INTO gastos(id,user_id,origem,descricao,valor,data,mes,ano,forma_pagamento)
VALUES('aaaaaaaa-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','web','Individual',10,'2026-10-25',10,2026,'pix');
DO $$ DECLARE u uuid:='11111111-1111-4111-8111-111111111111'; g uuid:='aaaaaaaa-0000-4000-8000-000000000001'; t timestamptz; r text; BEGIN
 SELECT updated_at INTO t FROM gastos WHERE id=g;
 r:=whatsapp_entry_mutate_v2(u,'5511900000000','gastos',g,t,'delete','delete-1');
 IF r<>'deleted' THEN RAISE EXCEPTION 'delete: %',r; END IF;
 IF NOT EXISTS(SELECT 1 FROM gastos WHERE id=g AND deleted_at IS NOT NULL AND deleted_by=u AND deletion_batch_id IS NOT NULL AND deletion_source='whatsapp') THEN RAISE EXCEPTION 'markers'; END IF;
 IF whatsapp_entry_mutate_v2(u,'5511900000000','gastos',g,t,'delete','delete-1')<>'gone' THEN RAISE EXCEPTION 'replay'; END IF;
 BEGIN UPDATE gastos SET descricao='Forbidden' WHERE id=g; RAISE EXCEPTION 'guard bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 SELECT updated_at INTO t FROM gastos WHERE id=g;
 r:=whatsapp_entry_mutate_v2(u,'5511900000000','gastos',g,t,'restore','restore-1');
 IF r<>'restored' THEN RAISE EXCEPTION 'restore: %',r; END IF;
 IF NOT EXISTS(SELECT 1 FROM gastos WHERE id=g AND deleted_at IS NULL AND descricao='Individual') THEN RAISE EXCEPTION 'restore row'; END IF;
 IF whatsapp_entry_mutate_v2(u,'wrong','gastos',g,t,'delete','wrong-phone')<>'blocked' THEN RAISE EXCEPTION 'phone'; END IF;
 UPDATE gastos SET updated_at=clock_timestamp()+interval '1 second' WHERE id=g;
 IF whatsapp_entry_mutate_v2(u,'5511900000000','gastos',g,t,'delete','stale')<>'changed' THEN RAISE EXCEPTION 'CAS'; END IF;
END $$;

-- Service-role callers cannot bypass F2 by setting the GUC themselves.
SET ROLE service_role;
DO $$ BEGIN
 BEGIN UPDATE gastos SET deleted_at=now() WHERE id='aaaaaaaa-0000-4000-8000-000000000001'; RAISE EXCEPTION 'service bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ DECLARE u uuid:='11111111-1111-4111-8111-111111111111'; b uuid:='22222222-2222-4222-8222-222222222222'; g uuid:='aaaaaaaa-0000-4000-8000-000000000001'; t timestamptz; r text; BEGIN
 SELECT updated_at INTO t FROM gastos WHERE id=g;
 IF whatsapp_entry_mutate_v2(b,'5511900000000','gastos',g,t,'delete','cross-user')<>'blocked' THEN RAISE EXCEPTION 'cross-user'; END IF;
 UPDATE whatsapp_links SET revogado_em=now() WHERE user_id=u;
 IF whatsapp_entry_mutate_v2(u,'5511900000000','gastos',g,t,'delete','revoked')<>'blocked' THEN RAISE EXCEPTION 'revocation'; END IF;
 UPDATE whatsapp_links SET revogado_em=NULL WHERE user_id=u;
 UPDATE fixture_entitlements SET allowed=false WHERE user_id=u;
 IF whatsapp_entry_mutate_v2(u,'5511900000000','gastos',g,t,'delete','plan')<>'blocked' THEN RAISE EXCEPTION 'plan'; END IF;
 UPDATE fixture_entitlements SET allowed=true WHERE user_id=u;
 UPDATE gastos SET import_batch_id=gen_random_uuid() WHERE id=g;
 IF whatsapp_entry_mutate_v2(u,'5511900000000','gastos',g,t,'delete','import')<>'blocked' THEN RAISE EXCEPTION 'import'; END IF;
 UPDATE gastos SET import_batch_id=NULL,cartao_id=gen_random_uuid(),total_parcelas=3 WHERE id=g;
 IF whatsapp_entry_mutate_v2(u,'5511900000000','gastos',g,t,'delete','card')<>'blocked' THEN RAISE EXCEPTION 'card'; END IF;
 UPDATE gastos SET cartao_id=NULL,total_parcelas=1,recorrencia_id=gen_random_uuid() WHERE id=g;
 IF whatsapp_entry_mutate_v2(u,'5511900000000','gastos',g,t,'delete','recurring')<>'blocked' THEN RAISE EXCEPTION 'recurring'; END IF;
 UPDATE gastos SET recorrencia_id=NULL WHERE id=g;
END $$;
INSERT INTO receitas(id,user_id,origem,descricao,valor,data,mes,ano) VALUES
('bbbbbbbb-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','web','Income',20,'2026-10-25',10,2026);
DO $$ DECLARE u uuid:='11111111-1111-4111-8111-111111111111'; r uuid:='bbbbbbbb-0000-4000-8000-000000000001'; t timestamptz; BEGIN
 SELECT updated_at INTO t FROM receitas WHERE id=r;
 IF whatsapp_entry_mutate_v2(u,'5511900000000','receitas',r,t,'delete','income-del')<>'deleted' THEN RAISE EXCEPTION 'income deletion'; END IF;
 SELECT updated_at INTO t FROM receitas WHERE id=r;
 IF whatsapp_entry_mutate_v2(u,'5511900000000','receitas',r,t,'restore','income-restore')<>'restored' THEN RAISE EXCEPTION 'income restoration'; END IF;
 IF NOT EXISTS(SELECT 1 FROM receitas WHERE id=r AND deleted_at IS NULL AND valor=20) THEN RAISE EXCEPTION 'income preservation'; END IF;
END $$;
-- Inject failure AFTER financial update, at journal insert: transaction must undo it.
CREATE FUNCTION fixture_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected_failure'; END $$;
CREATE TRIGGER fixture_fail_audit BEFORE INSERT ON whatsapp_entry_mutations FOR EACH ROW EXECUTE FUNCTION fixture_fail_audit();
DO $$ DECLARE t timestamptz; BEGIN
 SELECT updated_at INTO t FROM gastos WHERE id='aaaaaaaa-0000-4000-8000-000000000001';
 BEGIN
 PERFORM whatsapp_entry_mutate_v2('11111111-1111-4111-8111-111111111111','5511900000000','gastos','aaaaaaaa-0000-4000-8000-000000000001',t,'delete','failure');
 RAISE EXCEPTION 'failure not injected';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected_failure' THEN RAISE; END IF; END;
 IF NOT EXISTS(SELECT 1 FROM gastos WHERE id='aaaaaaaa-0000-4000-8000-000000000001' AND deleted_at IS NULL AND updated_at=t) THEN RAISE EXCEPTION 'rollback failed'; END IF;
END $$;
DROP TRIGGER fixture_fail_audit ON whatsapp_entry_mutations;
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM whatsapp_entry_mutate_v2('11111111-1111-4111-8111-111111111111','5511900000000','gastos','aaaaaaaa-0000-4000-8000-000000000001',now(),'delete','unauthorized'); RAISE EXCEPTION 'execute exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- A deletion by the site/F2 cannot be restored via this WhatsApp RPC.
DO $$ DECLARE u uuid:='11111111-1111-4111-8111-111111111111'; g uuid:='aaaaaaaa-0000-4000-8000-000000000001'; t timestamptz; BEGIN
 PERFORM set_config('gi.gastos_soft_delete','on',true);
 UPDATE gastos SET deleted_at=now(),deleted_by=u,deletion_batch_id=gen_random_uuid(),deletion_source='site' WHERE id=g;
 PERFORM set_config('gi.gastos_soft_delete','off',true);
 SELECT updated_at INTO t FROM gastos WHERE id=g;
 IF whatsapp_entry_mutate_v2(u,'5511900000000','gastos',g,t,'restore','foreign-delete')<>'blocked' THEN RAISE EXCEPTION 'restored unrelated deletion'; END IF;
 PERFORM set_config('gi.gastos_soft_delete','on',true);
 UPDATE gastos SET deleted_at=NULL,deleted_by=NULL,deletion_batch_id=NULL,deletion_source=NULL WHERE id=g;
 PERFORM set_config('gi.gastos_soft_delete','off',true);
END $$;
-- Receipt manually modified while deleted must not be overwritten/restored.
DO $$ DECLARE u uuid:='11111111-1111-4111-8111-111111111111'; r uuid:='bbbbbbbb-0000-4000-8000-000000000001'; t timestamptz; BEGIN
 SELECT updated_at INTO t FROM receitas WHERE id=r;
 IF whatsapp_entry_mutate_v2(u,'5511900000000','receitas',r,t,'delete','income-del-2')<>'deleted' THEN RAISE EXCEPTION 'income deletion 2'; END IF;
 SELECT updated_at INTO t FROM receitas WHERE id=r;
 UPDATE receitas SET valor=99 WHERE id=r;
 IF whatsapp_entry_mutate_v2(u,'5511900000000','receitas',r,t,'restore','income-changed')<>'blocked' THEN RAISE EXCEPTION 'snapshot not respected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM receitas WHERE id=r AND valor=99 AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'manual edit lost'; END IF;
END $$;
-- Recent undo v2: income, revocation, plan, cross-user, edits and audit rollback.
INSERT INTO receitas(id,user_id,origem,descricao,valor,data,mes,ano) VALUES
('bbbbbbbb-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','whatsapp','Recent income',30,'2026-10-25',10,2026);
INSERT INTO whatsapp_recent_actions(id,user_id,telefone,source_external_id,entity_kind,entity_id)
VALUES('cccccccc-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','5511900000000','recent-income-v2','income','bbbbbbbb-0000-4000-8000-000000000002');
DO $$ DECLARE u uuid:='11111111-1111-4111-8111-111111111111'; a uuid:='cccccccc-0000-4000-8000-000000000002'; BEGIN
 UPDATE fixture_entitlements SET allowed=false WHERE user_id=u;
 IF whatsapp_undo_recent_action_v2(u,'5511900000000',a)<>'unavailable' THEN RAISE EXCEPTION 'undo plan'; END IF;
 UPDATE fixture_entitlements SET allowed=true WHERE user_id=u;
 UPDATE whatsapp_links SET revogado_em=now() WHERE user_id=u;
 IF whatsapp_undo_recent_action_v2(u,'5511900000000',a)<>'unavailable' THEN RAISE EXCEPTION 'undo revoked'; END IF;
 UPDATE whatsapp_links SET revogado_em=NULL WHERE user_id=u;
 IF whatsapp_undo_recent_action_v2('22222222-2222-4222-8222-222222222222','5511900000000',a)<>'unavailable' THEN RAISE EXCEPTION 'undo cross user'; END IF;
 IF whatsapp_undo_recent_action_v2(u,'5511900000000',a)<>'undone' THEN RAISE EXCEPTION 'undo income'; END IF;
 IF NOT EXISTS(SELECT 1 FROM receitas WHERE id='bbbbbbbb-0000-4000-8000-000000000002' AND deleted_at IS NOT NULL AND deleted_source='whatsapp' AND valor=30) THEN RAISE EXCEPTION 'undo income markers'; END IF;
END $$;
INSERT INTO gastos(id,user_id,origem,descricao,valor,data,mes,ano,forma_pagamento)
VALUES('aaaaaaaa-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','whatsapp','Rollback expense',10,'2026-10-25',10,2026,'pix');
INSERT INTO whatsapp_recent_actions(id,user_id,telefone,source_external_id,entity_kind,entity_id)
VALUES('cccccccc-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','5511900000000','recent-expense-v2','expense','aaaaaaaa-0000-4000-8000-000000000003');
CREATE TRIGGER fixture_fail_undo_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fixture_fail_audit();
DO $$ BEGIN
 BEGIN PERFORM whatsapp_undo_recent_action_v2('11111111-1111-4111-8111-111111111111','5511900000000','cccccccc-0000-4000-8000-000000000003'); RAISE EXCEPTION 'failure not injected';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected_failure' THEN RAISE; END IF; END;
 IF NOT EXISTS(SELECT 1 FROM gastos WHERE id='aaaaaaaa-0000-4000-8000-000000000003' AND deleted_at IS NULL)
 OR NOT EXISTS(SELECT 1 FROM whatsapp_recent_actions WHERE id='cccccccc-0000-4000-8000-000000000003' AND state='active') THEN RAISE EXCEPTION 'undo rollback failed'; END IF;
END $$;
DROP TRIGGER fixture_fail_undo_audit ON audit_logs;
UPDATE gastos SET valor=99,updated_at=clock_timestamp()+interval '1 second' WHERE id='aaaaaaaa-0000-4000-8000-000000000003';
DO $$ BEGIN
 IF whatsapp_undo_recent_action_v2('11111111-1111-4111-8111-111111111111','5511900000000','cccccccc-0000-4000-8000-000000000003')<>'modified' THEN RAISE EXCEPTION 'undo lost edit'; END IF;
END $$;
-- Recurrence undo affects only its authorized occurrence, retaining historical income.
INSERT INTO recorrencias(id,user_id,origem,status) VALUES('dddddddd-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','whatsapp','ativa');
INSERT INTO receitas(id,user_id,origem,descricao,valor,data,mes,ano,recorrencia_id) VALUES
('bbbbbbbb-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','whatsapp','Occurrence',40,'2026-10-25',10,2026,'dddddddd-0000-4000-8000-000000000001'),
('bbbbbbbb-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','whatsapp','History',40,'2026-09-25',9,2026,'dddddddd-0000-4000-8000-000000000001');
INSERT INTO whatsapp_recent_actions(id,user_id,telefone,source_external_id,entity_kind,entity_id,related_id)
VALUES('cccccccc-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','5511900000000','recurring-v2','recurring_income','bbbbbbbb-0000-4000-8000-000000000003','dddddddd-0000-4000-8000-000000000001');
DO $$ BEGIN
 IF whatsapp_undo_recent_action_v2('11111111-1111-4111-8111-111111111111','5511900000000','cccccccc-0000-4000-8000-000000000004','occurrence')<>'undone' THEN RAISE EXCEPTION 'recurring undo'; END IF;
 IF NOT EXISTS(SELECT 1 FROM receitas WHERE id='bbbbbbbb-0000-4000-8000-000000000004' AND deleted_at IS NULL)
 OR NOT EXISTS(SELECT 1 FROM recorrencias WHERE id='dddddddd-0000-4000-8000-000000000001' AND status='ativa') THEN RAISE EXCEPTION 'recurring history lost'; END IF;
END $$;
