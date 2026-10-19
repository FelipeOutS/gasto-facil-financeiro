\set F '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'
\set M '47df50ce-df1e-4c54-8fae-0ffb5105478d'
\set U '99999999-0000-0000-0000-000000000009'
CREATE FUNCTION pg_temp.ok(c boolean, n text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF c THEN RAISE NOTICE 'PASSOU: %', n; ELSE RAISE EXCEPTION 'FALHOU: %', n; END IF; END $$;
-- dados de teste (service_role)
SET ROLE service_role;
INSERT INTO public.pluggy_items(user_id,item_id,is_sandbox) VALUES (:'F','iF',true),(:'M','iM',true);
INSERT INTO public.pluggy_accounts(user_id,item_id,account_id,type,is_sandbox) VALUES (:'F','iF','acc1','BANK',true),(:'M','iM','acc1','BANK',true);
INSERT INTO public.pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,amount,date,status,type,classification,classification_reason,is_sandbox)
 VALUES (:'F','iF','acc1','t1','k1',1,'2026-10-01','POSTED','DEBIT','gasto','x',true),
        (:'M','iM','acc1','t1','k1',2,'2026-10-01','POSTED','DEBIT','gasto','x',true);
SELECT pg_temp.ok(true, 'mesma transaction_id/dedupe_key em donos diferentes não conflita');
DO $$ BEGIN
  INSERT INTO public.pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,amount,date,status,type,classification,classification_reason,is_sandbox)
  VALUES ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','iF','acc1','t1','k2',1,'2026-10-01','POSTED','DEBIT','gasto','x',true);
  RAISE EXCEPTION 'FALHOU: duplicata aceita';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASSOU: duplicata do mesmo dono+conta rejeitada'; END $$;
DO $$ BEGIN
  INSERT INTO public.pluggy_accounts(user_id,item_id,account_id,type,is_sandbox) VALUES ('47df50ce-df1e-4c54-8fae-0ffb5105478d','iF','accX','BANK',true);
  RAISE EXCEPTION 'FALHOU: conta ligada a item de outro dono';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'PASSOU: FK impede conta em item de outro dono'; END $$;
RESET ROLE;

-- leitura por papel
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', :'F', false);
SELECT pg_temp.ok(public.pluggy_is_allowed(), 'Felipe autorizado');
SELECT pg_temp.ok((SELECT count(*) FROM public.pluggy_transactions)=1 AND (SELECT bool_and(user_id=:'F') FROM public.pluggy_transactions), 'Felipe vê só as próprias');
SELECT set_config('request.jwt.claim.sub', :'M', false);
SELECT pg_temp.ok((SELECT count(*) FROM public.pluggy_items)=1 AND (SELECT bool_and(user_id=:'M') FROM public.pluggy_items), 'Michael vê só os próprios');
SELECT set_config('request.jwt.claim.sub', :'U', false);
SELECT pg_temp.ok(NOT public.pluggy_is_allowed(), 'usuário comum não autorizado');
SELECT pg_temp.ok((SELECT count(*) FROM public.pluggy_transactions)=0, 'usuário comum vê 0 linhas');
DO $$ BEGIN PERFORM public.pluggy_is_allowed('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid); RAISE EXCEPTION 'FALHOU: consulta de terceiros';
EXCEPTION WHEN undefined_function THEN RAISE NOTICE 'PASSOU: não existe consulta por UUID de terceiros'; END $$;
DO $$ BEGIN INSERT INTO public.pluggy_settings(user_id) VALUES (auth.uid()); RAISE EXCEPTION 'FALHOU: insert';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: authenticated não grava'; END $$;
DO $$ BEGIN PERFORM * FROM public.pluggy_webhook_events; RAISE EXCEPTION 'FALHOU: fila legível';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: authenticated não lê a fila'; END $$;
DO $$ BEGIN PERFORM public.pluggy_webhook_claim(5, 60); RAISE EXCEPTION 'FALHOU: claim';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: authenticated não executa RPCs da fila'; END $$;
RESET ROLE;
SET ROLE anon; SELECT set_config('request.jwt.claim.sub', '', false);
DO $$ BEGIN PERFORM * FROM public.pluggy_transactions; RAISE EXCEPTION 'FALHOU: anon lê';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: anon sem acesso'; END $$;
DO $$ BEGIN PERFORM public.pluggy_is_allowed(); RAISE EXCEPTION 'FALHOU: anon executa';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: anon não executa a função'; END $$;
RESET ROLE;


-- Revisão 3: duas contas do mesmo dono, compra idêntica (valor/data/descrição)
SET ROLE service_role;
INSERT INTO public.pluggy_accounts(user_id,item_id,account_id,type,is_sandbox) VALUES (:'F','iF','acc2','BANK',true);
INSERT INTO public.pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,description,amount,date,status,type,classification,classification_reason,is_sandbox)
 VALUES (:'F','iF','acc2','t9','k1','PADARIA',1,'2026-10-01','POSTED','DEBIT','gasto','x',true);
SELECT pg_temp.ok((SELECT count(*) FROM public.pluggy_transactions WHERE user_id=:'F' AND amount=1 AND date='2026-10-01')=2, 'mesma compra em 2 contas do mesmo dono não conflita');
DO $$ BEGIN
  INSERT INTO public.pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,amount,date,status,type,classification,classification_reason,is_sandbox)
  VALUES ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','iF','acc2','t10','k1',1,'2026-10-01','POSTED','DEBIT','gasto','x',true);
  RAISE EXCEPTION 'FALHOU: dedupe repetida na mesma conta';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASSOU: dedupe_key repetida na mesma conta rejeitada'; END $$;
DO $$ BEGIN
  INSERT INTO public.pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,amount,date,status,type,classification,classification_reason,is_sandbox)
  VALUES ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','iF','acc2','t9','k77',1,'2026-10-01','POSTED','DEBIT','gasto','x',true);
  RAISE EXCEPTION 'FALHOU: transaction_id repetido';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASSOU: transaction_id repetido na mesma conta rejeitado'; END $$;
-- integridade: transação com conexão errada / dono errado
INSERT INTO public.pluggy_items(user_id,item_id,is_sandbox) VALUES (:'F','iF2',true);
DO $$ BEGIN
  INSERT INTO public.pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,amount,date,status,type,classification,classification_reason,is_sandbox)
  VALUES ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','iF2','acc1','tX','kX',1,'2026-10-01','POSTED','DEBIT','gasto','x',true);
  RAISE EXCEPTION 'FALHOU: transação em conexão diferente da conta';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'PASSOU: transação com conexão diferente da conta rejeitada'; END $$;
DO $$ BEGIN
  INSERT INTO public.pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,amount,date,status,type,classification,classification_reason,is_sandbox)
  VALUES ('47df50ce-df1e-4c54-8fae-0ffb5105478d','iF','acc1','tY','kY',1,'2026-10-01','POSTED','DEBIT','gasto','x',true);
  RAISE EXCEPTION 'FALHOU: transação com dono diferente';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'PASSOU: transação com dono diferente da conta rejeitada'; END $$;
DO $$ BEGIN
  INSERT INTO public.pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,amount,date,status,type,classification,classification_reason,is_sandbox)
  VALUES ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','iF','accNAO','tZ','kZ',1,'2026-10-01','POSTED','DEBIT','gasto','x',true);
  RAISE EXCEPTION 'FALHOU: conta inexistente';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'PASSOU: transação em conta inexistente rejeitada'; END $$;
-- Sandbox/Live
DO $$ BEGIN INSERT INTO public.pluggy_items(user_id,item_id,is_sandbox) VALUES ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','iLive',false);
  RAISE EXCEPTION 'FALHOU: conexão Live aceita';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASSOU: conexão Live rejeitada pelo banco'; END $$;
DO $$ BEGIN INSERT INTO public.pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,amount,date,status,type,classification,classification_reason,is_sandbox)
  VALUES ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','iF','acc1','tL','kL',1,'2026-10-01','POSTED','DEBIT','gasto','x',false);
  RAISE EXCEPTION 'FALHOU: transação Live aceita';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASSOU: transação marcada Live rejeitada'; END $$;
DO $$ BEGIN UPDATE public.pluggy_items SET is_sandbox=false WHERE item_id='iF';
  RAISE EXCEPTION 'FALHOU: conexão virou Live';
EXCEPTION WHEN check_violation OR foreign_key_violation THEN RAISE NOTICE 'PASSOU: conexão Sandbox não pode virar Live'; END $$;
RESET ROLE;
-- permissões efetivas com privilégios padrão do Cloud
SELECT pg_temp.ok(NOT has_table_privilege('anon','public.pluggy_transactions','SELECT') AND NOT has_table_privilege('anon','public.pluggy_webhook_events','INSERT'), 'anon sem nenhum privilégio apesar do padrão');
SELECT pg_temp.ok(has_table_privilege('authenticated','public.pluggy_transactions','SELECT') AND NOT has_table_privilege('authenticated','public.pluggy_transactions','INSERT') AND NOT has_table_privilege('authenticated','public.pluggy_transactions','UPDATE') AND NOT has_table_privilege('authenticated','public.pluggy_transactions','DELETE') AND NOT has_table_privilege('authenticated','public.pluggy_webhook_events','SELECT'), 'authenticated só SELECT (RLS) apesar do padrão');
SELECT pg_temp.ok(NOT has_function_privilege('anon','public.pluggy_is_allowed()','EXECUTE') AND NOT has_function_privilege('authenticated','public.pluggy_webhook_claim(integer,integer)','EXECUTE') AND NOT has_function_privilege('anon','public.pluggy_webhook_enqueue(text,text,text,text[])','EXECUTE'), 'funções sem EXECUTE indevido apesar do padrão');

-- sandbox_exec (BYPASSRLS) sem acesso a nada Pluggy
SELECT pg_temp.ok(rolbypassrls, 'stub reproduz BYPASSRLS de sandbox_exec') FROM pg_roles WHERE rolname='sandbox_exec';
SELECT pg_temp.ok(bool_and(NOT has_table_privilege('sandbox_exec', t, p)), 'sandbox_exec sem SELECT/INSERT/UPDATE/DELETE/TRUNCATE nas 5 tabelas')
  FROM unnest(ARRAY['public.pluggy_settings','public.pluggy_items','public.pluggy_accounts','public.pluggy_transactions','public.pluggy_webhook_events']) t,
       unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p;
SELECT pg_temp.ok(NOT has_function_privilege('sandbox_exec','public.pluggy_webhook_claim(integer,integer)','EXECUTE') AND NOT has_function_privilege('sandbox_exec','public.pluggy_is_allowed()','EXECUTE'), 'sandbox_exec sem EXECUTE nas funções Pluggy');
SET ROLE sandbox_exec;
DO $$ BEGIN PERFORM * FROM public.pluggy_transactions; RAISE EXCEPTION 'FALHOU: sandbox_exec lê';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: sandbox_exec não lê transações de Felipe/Michael'; END $$;
DO $$ BEGIN INSERT INTO public.pluggy_webhook_events(event_id,event) VALUES ('x','item/updated'); RAISE EXCEPTION 'FALHOU: sandbox_exec insere';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: sandbox_exec não insere na fila'; END $$;
DO $$ BEGIN UPDATE public.pluggy_items SET status='x'; RAISE EXCEPTION 'FALHOU: sandbox_exec altera';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: sandbox_exec não altera'; END $$;
DO $$ BEGIN DELETE FROM public.pluggy_accounts; RAISE EXCEPTION 'FALHOU: sandbox_exec exclui';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: sandbox_exec não exclui'; END $$;
RESET ROLE;
-- fila
SET ROLE service_role;
SELECT pg_temp.ok((SELECT is_new FROM public.pluggy_webhook_enqueue('e1','item/updated','iF','{}')), 'evento novo gravado como pendente');
SELECT pg_temp.ok(NOT (SELECT is_new FROM public.pluggy_webhook_enqueue('e1','item/updated','iF','{}')), 'reentrega não duplica');
CREATE TEMP TABLE c1 AS SELECT * FROM public.pluggy_webhook_claim(5, 60);
SELECT pg_temp.ok((SELECT count(*) FROM c1)=1, 'claim reserva o evento');
SELECT pg_temp.ok((SELECT count(*) FROM public.pluggy_webhook_claim(5, 60))=0, 'evento reservado não é pego de novo');
SELECT pg_temp.ok(public.pluggy_webhook_finish((SELECT id FROM c1), gen_random_uuid(), true, NULL)='reserva_perdida', 'token errado não finaliza');
SELECT pg_temp.ok(public.pluggy_webhook_finish((SELECT id FROM c1), (SELECT claim_token FROM c1), false, 'pluggy_http_500')='falhou', 'falha vira falhou');
SELECT pg_temp.ok((SELECT status FROM public.pluggy_webhook_enqueue('e1','item/updated','iF','{}'))='pendente', 'reentrega de evento falho volta a pendente');
CREATE TEMP TABLE c2 AS SELECT * FROM public.pluggy_webhook_claim(5, 60);
SELECT pg_temp.ok((SELECT attempts FROM c2)=2, 'tentativas contadas');
SELECT pg_temp.ok(public.pluggy_webhook_finish((SELECT id FROM c2), (SELECT claim_token FROM c2), true, NULL)='concluido', 'sucesso vira concluido');
SELECT pg_temp.ok((SELECT status FROM public.pluggy_webhook_enqueue('e1','item/updated','iF','{}'))='concluido', 'reentrega de concluido permanece concluido');
SELECT pg_temp.ok((SELECT count(*) FROM public.pluggy_webhook_claim(5, 60))=0, 'concluido nunca é reprocessado');
-- esgotado
SELECT public.pluggy_webhook_enqueue('e2','item/updated','iF','{}');
UPDATE public.pluggy_webhook_events SET max_attempts=1 WHERE event_id='e2';
CREATE TEMP TABLE c3 AS SELECT * FROM public.pluggy_webhook_claim(5, 60);
SELECT pg_temp.ok(public.pluggy_webhook_finish((SELECT id FROM c3), (SELECT claim_token FROM c3), false, 'x')='esgotado', 'limite de tentativas vira esgotado');
SELECT pg_temp.ok((SELECT status FROM public.pluggy_webhook_enqueue('e2','item/updated','iF','{}'))='esgotado', 'esgotado exige intervenção');
-- lease expirado é recuperado
SELECT public.pluggy_webhook_enqueue('e3','item/updated','iF','{}');
CREATE TEMP TABLE c4 AS SELECT * FROM public.pluggy_webhook_claim(5, 60);
UPDATE public.pluggy_webhook_events SET locked_until = now() - interval '1 second' WHERE event_id='e3';
CREATE TEMP TABLE c5 AS SELECT * FROM public.pluggy_webhook_claim(5, 60);
SELECT pg_temp.ok((SELECT count(*) FROM c5)=1 AND (SELECT claim_token FROM c5)<>(SELECT claim_token FROM c4), 'processamento travado é recuperado');
SELECT pg_temp.ok(public.pluggy_webhook_finish((SELECT id FROM c4), (SELECT claim_token FROM c4), true, NULL)='reserva_perdida', 'worker antigo não sobrescreve');
RESET ROLE;
-- remoção física de item remove só dados Pluggy dele
DELETE FROM public.pluggy_items WHERE item_id='iF';
SELECT pg_temp.ok((SELECT count(*) FROM public.pluggy_transactions WHERE user_id=:'F')=0 AND (SELECT count(*) FROM public.pluggy_transactions WHERE user_id=:'M')=1, 'cascade limitado ao item removido');
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos)=1, 'gastos intocado');
