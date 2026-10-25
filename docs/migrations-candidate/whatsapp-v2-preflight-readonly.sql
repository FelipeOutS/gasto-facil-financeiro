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
