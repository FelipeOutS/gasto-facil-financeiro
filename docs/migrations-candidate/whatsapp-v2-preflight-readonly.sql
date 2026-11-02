BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='30s';
-- SOMENTE LEITURA. Não execute automaticamente; não revela credenciais/dados pessoais.
SELECT table_name,column_name,data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('gastos','receitas')
AND column_name IN ('deleted_at','deleted_by','deletion_batch_id','deletion_source','deleted_source','deleted_reason','updated_at','import_batch_id');
SELECT c.relname,pg_get_userbyid(c.relowner) AS owner,t.tgname,t.tgenabled,
 pg_get_triggerdef(t.oid) AS definition,md5(pg_get_functiondef(t.tgfoid)) AS guard_definition_md5
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_trigger t ON t.tgrelid=c.oid
WHERE n.nspname='public' AND c.relname IN ('gastos','receitas') AND NOT t.tgisinternal;
SELECT conname,convalidated,pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid=to_regclass('public.gastos') AND conname LIKE 'gastos_deletion%';
SELECT p.oid::regprocedure,p.prosecdef,pg_get_userbyid(p.proowner),p.proconfig,p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('whatsapp_entry_mutate_v2','whatsapp_undo_recent_action_v2','gastos_soft_delete_periodo','gastos_restaurar_lote','reverter_extrato_atomic','has_feature_access');
-- Se F2 estiver ausente/parcial, PARAR: revisão específica do schema antes de qualquer migração.
-- Se os leitores F3/F4 não forem a versão homologada, PARAR; SQL não comprova a versão do código.

-- Lista esperada: ausência não pode desaparecer do relatório.
WITH expected(tbl,col,typ) AS (VALUES
 ('gastos','deleted_at','timestamp with time zone'),('gastos','deleted_by','uuid'),
 ('gastos','deletion_batch_id','uuid'),('gastos','deletion_source','text'),
 ('gastos','updated_at','timestamp with time zone'),('gastos','import_batch_id','uuid'),
 ('receitas','deleted_at','timestamp with time zone'),('receitas','deleted_source','text'),
 ('receitas','deleted_reason','text'),('receitas','updated_at','timestamp with time zone'),('receitas','import_batch_id','uuid'))
SELECT e.*,c.data_type actual_type,c.is_nullable,c.column_default,
 CASE WHEN c.column_name IS NULL THEN 'MISSING' WHEN c.data_type<>e.typ THEN 'TYPE_MISMATCH' ELSE 'PRESENT_REVIEW_NULLABILITY_DEFAULT' END status
FROM expected e LEFT JOIN information_schema.columns c ON c.table_schema='public' AND c.table_name=e.tbl AND c.column_name=e.col ORDER BY e.tbl,e.col;
WITH expected(signature) AS (VALUES
 ('public.whatsapp_entry_mutate_v2(uuid,text,text,uuid,timestamp with time zone,text,text)'),
 ('public.whatsapp_undo_recent_action_v2(uuid,text,uuid,text)'),
 ('public.whatsapp_undo_recent_action(uuid,text,uuid,text)'),
 ('public.has_feature_access(uuid,text)'))
SELECT e.signature, CASE WHEN p.oid IS NULL THEN 'MISSING' ELSE 'PRESENT_REVIEW_BODY_OWNER_ACL' END status,
 p.prosecdef,pg_get_userbyid(p.proowner) owner,p.proconfig,p.proacl,pg_get_functiondef(p.oid) definition
FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature);
-- ACL efetiva inclui herança e PUBLIC; nunca executar as RPCs para testar permissão.
SELECT p.oid::regprocedure signature,r.rolname,has_function_privilege(r.oid,p.oid,'EXECUTE') can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
CROSS JOIN pg_roles r WHERE n.nspname='public' AND r.rolname IN ('anon','authenticated','service_role')
AND p.proname IN ('whatsapp_entry_mutate_v2','whatsapp_undo_recent_action_v2','whatsapp_undo_recent_action','gastos_soft_delete_periodo','gastos_restaurar_lote');
SELECT c.relname,pg_get_userbyid(c.relowner) owner,c.relrowsecurity,c.relforcerowsecurity,c.relacl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
AND c.relname IN ('gastos','receitas','whatsapp_entry_mutations','whatsapp_recent_actions','whatsapp_links','audit_logs');
SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename IN ('gastos','receitas','whatsapp_entry_mutations','whatsapp_recent_actions','whatsapp_links');
-- Comparar com o mesmo relatório em clone descartável após candidatos: definições, owners, ACLs,
-- constraints, triggers e tipos; presença por nome não comprova equivalência. Não lê linhas financeiras.
COMMIT;
