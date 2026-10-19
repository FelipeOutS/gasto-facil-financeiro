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
