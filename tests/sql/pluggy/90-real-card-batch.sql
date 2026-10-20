-- Somente PostgreSQL descartavel. Valores e IDs ficticios.
CREATE FUNCTION pg_temp.ok(c boolean,n text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %',n; END IF; END $$;
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
SELECT public.pluggy_link_real_card(:'F','real-card','00000000-0000-0000-0000-00000000ca01');
INSERT INTO public.pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,description,amount,amount_original,date,status,type,classification,classification_reason,is_sandbox,bill_id,bill_due_date) VALUES
(:'F','iReal','real-card','card-purchase-1','card-purchase-1','Compra ficticia',21,21,'2030-01-10','POSTED','DEBIT','gasto','compra_cartao',false,'bill-test','2030-02-05'),
(:'F','iReal','real-card','card-purchase-2','card-purchase-2','Compra ficticia 2',22,-22,'2030-01-11','POSTED','DEBIT','gasto','compra_cartao',false,'wrong-bill','2030-02-05');
INSERT INTO public.pluggy_real_batch_grants(batch_id,user_id,item_count,total,expires_at) VALUES ('00000000-0000-0000-0000-00000000cb01',:'F',2,43,now()+interval '1 day');
INSERT INTO public.pluggy_real_batch_grant_items(batch_id,user_id,account_id,transaction_id,entry_table,valor,data,categoria_id,cartao_id,bill_id,bill_due_date) VALUES
('00000000-0000-0000-0000-00000000cb01',:'F','real-card','card-purchase-1','gastos',21,'2030-01-10',:'cat','00000000-0000-0000-0000-00000000ca01','bill-test','2030-02-05'),
('00000000-0000-0000-0000-00000000cb01',:'F','real-card','card-purchase-2','gastos',22,'2030-01-11',:'cat','00000000-0000-0000-0000-00000000ca01','bill-test','2030-02-05');
SET ROLE service_role;
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.pluggy_import_apply_real_batch('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','00000000-0000-0000-0000-00000000cb01','[{"account_id":"real-card","transaction_id":"card-purchase-1","descricao":"Compra ficticia"},{"account_id":"real-card","transaction_id":"card-purchase-2","descricao":"Compra ficticia 2"}]')$q$)='pluggy_fatura_ou_vinculo_divergente','wrong bill blocks batch');
SELECT pg_temp.ok(count(*)=0,'failed batch is atomic') FROM public.gastos WHERE import_batch_id='00000000-0000-0000-0000-00000000cb01';
SELECT pg_temp.ok(consumed_at IS NULL,'failed batch leaves grant unused') FROM public.pluggy_real_batch_grants WHERE batch_id='00000000-0000-0000-0000-00000000cb01';
UPDATE public.pluggy_transactions SET bill_id='bill-test' WHERE transaction_id='card-purchase-2' AND user_id=:'F';
SELECT public.pluggy_import_apply_real_batch(:'F','00000000-0000-0000-0000-00000000cb01','[{"account_id":"real-card","transaction_id":"card-purchase-1","descricao":"Compra ficticia"},{"account_id":"real-card","transaction_id":"card-purchase-2","descricao":"Compra ficticia 2"}]');
SELECT pg_temp.ok(count(*)=2 AND sum(valor)=43,'only actual purchases, no future installments') FROM public.gastos WHERE import_batch_id='00000000-0000-0000-0000-00000000cb01' AND cartao_id='00000000-0000-0000-0000-00000000ca01' AND fatura_competencia='2030-02' AND forma_pagamento='credito';
SELECT pg_temp.ok((public.pluggy_import_apply_real_batch(:'F','00000000-0000-0000-0000-00000000cb01','[]')->>'replay')::boolean,'card batch replay harmless');
SELECT public.pluggy_link_real_card(:'F','real-card',null);
SELECT pg_temp.ok(count(*)=2,'unlink retains financial history') FROM public.gastos WHERE import_batch_id='00000000-0000-0000-0000-00000000cb01' AND deleted_at IS NULL;
SELECT public.pluggy_import_revert_real_batch(:'F','00000000-0000-0000-0000-00000000cb01');
SELECT pg_temp.ok(count(*)=2,'card batch undo works') FROM public.gastos WHERE import_batch_id='00000000-0000-0000-0000-00000000cb01' AND deleted_at IS NOT NULL;
SELECT pg_temp.ok(pg_temp.err('SELECT public.pluggy_assert_financial_release()')='pluggy_gravacao_financeira_bloqueada','global lock remains intact');
RESET ROLE;
