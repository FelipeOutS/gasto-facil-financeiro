-- Somente leitura. Revisar e executar no ambiente correto com autorização de consulta.
-- Não contém INSERT, UPDATE, DELETE, RPC financeira ou concessão de permissões.
BEGIN TRANSACTION READ ONLY;
SELECT current_database(), current_user;
SELECT to_regclass('supabase_migrations.schema_migrations') AS migration_history,
       to_regclass('public.pluggy_real_batch_grants') AS batch_grants,
       to_regprocedure('public.pluggy_import_apply_real_batch(uuid,uuid,jsonb)') AS batch_rpc;
-- Conferir o histórico de migrações separadamente se a tabela acima existir.
SELECT user_id, origem, count(*) AS ativos FROM public.gastos
 WHERE deleted_at IS NULL AND user_id IN ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','47df50ce-df1e-4c54-8fae-0ffb5105478d') GROUP BY user_id,origem;
SELECT user_id, origem, count(*) AS ativos FROM public.receitas
 WHERE deleted_at IS NULL AND user_id IN ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','47df50ce-df1e-4c54-8fae-0ffb5105478d') GROUP BY user_id,origem;
SELECT user_id,count(*) FROM public.cartoes WHERE user_id IN ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','47df50ce-df1e-4c54-8fae-0ffb5105478d') GROUP BY user_id;
SELECT user_id,status,count(*) FROM public.extratos_importados WHERE tipo_origem='pluggy' GROUP BY user_id,status;
SELECT user_id,count(*) FROM public.imported_transactions WHERE provider='mercado_pago' GROUP BY user_id;
SELECT user_id,is_sandbox,classification,count(*) FROM public.pluggy_transactions GROUP BY user_id,is_sandbox,classification;
SELECT transaction_id,date,amount,status,classification,deleted_at IS NOT NULL AS excluida
 FROM public.pluggy_transactions WHERE user_id='3324b9f8-ea68-465c-8e1e-ab1cc8caebf1' AND transaction_id IN
 ('684afd15-cec6-43ad-8831-655304d3c45d','844dc673-5b09-48f5-9e31-348f97c602e5','323eaf7f-4624-4cab-ab21-d7afd92077df');
SELECT user_id,state,count(*) FROM public.pluggy_import_entries GROUP BY user_id,state;
SELECT proname,prosecdef,proconfig FROM pg_proc WHERE proname LIKE 'pluggy_%';
SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE tablename LIKE 'pluggy_%';
COMMIT;
