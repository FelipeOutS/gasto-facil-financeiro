-- Executado SOMENTE em banco descartavel, depois de 60-real-batch.sql.
CREATE FUNCTION pg_temp.ok(c boolean,n text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %',n; END IF; END $$;
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
SELECT pg_temp.ok(NOT has_function_privilege('authenticated','public.pluggy_import_revert_real_batch_items(uuid,uuid,uuid[])','EXECUTE'),'partial undo denied to browser');
SELECT pg_temp.ok(NOT has_function_privilege('sandbox_exec','public.pluggy_import_apply_real_automatic(uuid,uuid,jsonb)','EXECUTE'),'automatic denied to sandbox execution');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.pluggy_import_apply_real_automatic('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','00000000-0000-0000-0000-00000000ba05','[]')$q$)='pluggy_automatico_nao_autorizado','automatic requires independent opt-in');
SET ROLE service_role;
SELECT public.pluggy_import_apply_real_batch('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','00000000-0000-0000-0000-00000000ba05','[{"account_id":"aReal","transaction_id":"c1","descricao":"Rendimentos"},{"account_id":"aReal","transaction_id":"c2","descricao":"Rendimentos"}]');
SELECT entry_id AS first_id FROM public.pluggy_import_entries WHERE transaction_id='c1' \gset
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.pluggy_import_revert_real_batch_items('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','00000000-0000-0000-0000-00000000ba05',ARRAY['00000000-0000-0000-0000-000000000001'::uuid])$q$)='pluggy_selecao_invalida','foreign row cannot be reversed');
SELECT public.pluggy_import_revert_real_batch_items('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','00000000-0000-0000-0000-00000000ba05',ARRAY[:'first_id'::uuid]);
SELECT pg_temp.ok(count(*)=1,'only selected entry reversed') FROM public.receitas WHERE import_batch_id='00000000-0000-0000-0000-00000000ba05' AND deleted_at IS NOT NULL;
SELECT pg_temp.ok(reverted_at IS NULL,'partial selection does not close entire grant') FROM public.pluggy_real_batch_grants WHERE batch_id='00000000-0000-0000-0000-00000000ba05';
SELECT pg_temp.ok((public.pluggy_import_revert_real_batch_items('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','00000000-0000-0000-0000-00000000ba05',ARRAY[:'first_id'::uuid])->>'replay')::boolean,'partial replay harmless');
SELECT public.pluggy_import_revert_real_batch('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','00000000-0000-0000-0000-00000000ba05');
SELECT pg_temp.ok(count(*)=2,'full reversal after partial reverses remaining entry') FROM public.receitas WHERE import_batch_id='00000000-0000-0000-0000-00000000ba05' AND deleted_at IS NOT NULL;
RESET ROLE;
SELECT pg_temp.ok(pg_temp.err('SELECT public.pluggy_assert_financial_release()')='pluggy_gravacao_financeira_bloqueada','global lock intact');

SELECT pg_temp.ok(NOT has_function_privilege('authenticated','public.pluggy_set_real_automatic(uuid,boolean)','EXECUTE'),'browser cannot set preference by RPC');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.pluggy_set_real_automatic('47df50ce-df1e-4c54-8fae-0ffb5105478d',true)$q$)='pluggy_nao_autorizado','Michael cannot activate first real automatic phase');
INSERT INTO public.pluggy_settings(user_id,history_days) VALUES ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1',90) ON CONFLICT (user_id) DO NOTHING;
SELECT public.pluggy_set_real_automatic('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1',true);
SELECT pg_temp.ok(real_auto_import AND real_auto_consented_at IS NOT NULL,'explicit independent preference saved') FROM public.pluggy_settings WHERE user_id='3324b9f8-ea68-465c-8e1e-ab1cc8caebf1';
SELECT public.pluggy_set_real_automatic('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1',false);
SELECT pg_temp.ok(NOT real_auto_import,'revocation saved') FROM public.pluggy_settings WHERE user_id='3324b9f8-ea68-465c-8e1e-ab1cc8caebf1';
