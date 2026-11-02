-- Native/PGlite disposable fixtures only. No real banking identifiers.
\set F '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'
CREATE FUNCTION pg_temp.ok(c boolean,n text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %',n; END IF; END $$;
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
UPDATE pluggy_items SET status='UPDATED',consent_expires_at=now()+interval '1 day' WHERE item_id='iReal';
SELECT pg_temp.ok(NOT has_function_privilege('authenticated','pluggy_continuous_process(uuid,text,boolean)','EXECUTE'),'browser cannot authorize/import directly');
SELECT pg_temp.ok(NOT has_table_privilege('service_role','pluggy_continuous_release','UPDATE'),'service cannot open release');
SELECT pg_temp.ok(pg_temp.err($q$SELECT pluggy_continuous_set('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','aReal',true,ARRAY['interest'],null,10,15,2,true)$q$)='pluggy_politica_bloqueada','migration alone cannot activate policy');
-- Test-only admin release in disposable DB.
UPDATE pluggy_continuous_release SET enabled=true;
SELECT pg_temp.ok(pg_temp.err($q$SELECT pluggy_continuous_set('47df50ce-df1e-4c54-8fae-0ffb5105478d','aReal',true,ARRAY['interest'],null,10,15,2,true)$q$)='pluggy_nao_autorizado','other holder blocked');
SELECT pg_temp.ok(pg_temp.err($q$SELECT pluggy_continuous_set('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','aReal',true,ARRAY['interest'],null,10,15,2,false)$q$)='pluggy_politica_bloqueada','explicit consent required');
SELECT pluggy_continuous_set(:'F','aReal',true,ARRAY['interest'],null,10,15,2,true);
INSERT INTO pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,description,amount,date,status,type,classification,classification_reason,is_sandbox,operation_type)
SELECT :'F','iReal','aReal',id,id,description,amount,(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,'POSTED','CREDIT','receita','credito_conta',false,op FROM (VALUES
 ('policy-a','Rendimento',1.11,'RENDIMENTO'),('policy-b','Rendimento',2.22,'RENDIMENTO'),('policy-limit','Rendimento',50,'RENDIMENTO'),('policy-pix','Pix emprestimo',3.33,'PIX'),('policy-no-code','Rendimento',4.44,NULL)) v(id,description,amount,op);
SELECT pluggy_continuous_process(:'F','aReal',true);
SELECT pg_temp.ok(count(*)=0,'preview has no audit writes') FROM pluggy_continuous_audit;
SELECT pg_temp.ok(count(*)=0,'preview has no financial writes') FROM receitas WHERE id_operacao_banco LIKE 'pluggy:aReal:policy-%';
SET ROLE service_role;
SELECT pluggy_continuous_process(:'F','aReal',false);
RESET ROLE;
SELECT pg_temp.ok(count(*)=2,'only explicitly eligible interest imported') FROM pluggy_continuous_audit WHERE outcome='imported';
SELECT pg_temp.ok(sum(amount)=3.33,'exact amounts audited') FROM pluggy_continuous_audit WHERE outcome='imported';
SELECT pluggy_continuous_process(:'F','aReal',false);
SELECT pg_temp.ok(count(*)=2,'retry does not duplicate') FROM receitas WHERE id_operacao_banco LIKE 'pluggy:aReal:policy-%';
SELECT pg_temp.ok(pg_temp.err('SELECT pluggy_assert_financial_release()')='pluggy_gravacao_financeira_bloqueada','global writer remains blocked');
SELECT pluggy_continuous_set(:'F','aReal',false,ARRAY['interest'],null,10,15,2,true);
SELECT pg_temp.ok((pluggy_continuous_process(:'F','aReal',false)->>'blocked')::boolean,'pause blocks processing');
-- Retry after undo remains blocked by imported tombstone; edits survive undo.
UPDATE receitas SET descricao='Edited by owner' WHERE id_operacao_banco='pluggy:aReal:policy-a';
SELECT pluggy_import_revert_real_batch(:'F',batch_id) FROM pluggy_continuous_audit WHERE transaction_id IN('policy-a','policy-b');
SELECT pg_temp.ok(deleted_at IS NULL,'manual edit preserved') FROM receitas WHERE id_operacao_banco='pluggy:aReal:policy-a';
SELECT pg_temp.ok(deleted_at IS NOT NULL,'untouched import reverted') FROM receitas WHERE id_operacao_banco='pluggy:aReal:policy-b';
SELECT pluggy_continuous_set(:'F','aReal',true,ARRAY['interest'],null,10,15,10,true);
SELECT pluggy_continuous_process(:'F','aReal',false);
SELECT pg_temp.ok(count(*)=2,'undo never enables reimport') FROM receitas WHERE id_operacao_banco LIKE 'pluggy:aReal:policy-%';
-- Native runner subsequently imports this same new transaction from two sessions.
INSERT INTO pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,description,amount,date,status,type,classification,classification_reason,is_sandbox,operation_type)
VALUES(:'F','iReal','aReal','policy-race','policy-race','Rendimento',5.55,(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,'POSTED','CREDIT','receita','credito_conta',false,'RENDIMENTO');

-- Strict known Mercado Pago interest is not confused with a principal redemption.
SELECT pg_temp.ok(pluggy_continuous_kind(jsonb_populate_record(NULL::pluggy_transactions,to_jsonb(t)||'{"description":"Rendimentos","pluggy_category":"Proceeds interests and dividends","operation_type":"RESGATE_APLIC_FINANCEIRA"}'::jsonb),'BANK')='interest','MP structured interest exception') FROM pluggy_transactions t WHERE transaction_id='policy-race';
SELECT pg_temp.ok(pluggy_continuous_kind(jsonb_populate_record(NULL::pluggy_transactions,to_jsonb(t)||'{"description":"Resgate de reserva","operation_type":"RESGATE_APLIC_FINANCEIRA"}'::jsonb),'BANK') IS NULL,'principal redemption excluded') FROM pluggy_transactions t WHERE transaction_id='policy-race';
UPDATE pluggy_continuous_policies SET expires_at=now()-interval '1 second';
SELECT pg_temp.ok((pluggy_continuous_process(:'F','aReal',false)->>'blocked')::boolean,'expired policy blocks writer');
UPDATE pluggy_continuous_policies SET expires_at=now()+interval '1 day';

SELECT pg_temp.ok(pluggy_continuous_kind(jsonb_populate_record(NULL::pluggy_transactions,to_jsonb(t)||'{"description":"Empréstimo pessoal","operation_type":"SALARIO"}'::jsonb),'BANK') IS NULL,'accented loan text never becomes automatic salary') FROM pluggy_transactions t WHERE transaction_id='policy-race';
