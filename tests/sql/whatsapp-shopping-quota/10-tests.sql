-- Testes da cota candidata (PG local isolado; dados fictícios).
CREATE OR REPLACE FUNCTION pg_temp.ok(c boolean, n text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF c THEN RAISE NOTICE 'PASSOU %', n; ELSE RAISE EXCEPTION 'FALHOU %', n; END IF; END $$;
SET ROLE service_role;

-- Q1 reserva + idempotência
SELECT pg_temp.ok((SELECT claim_state FROM whatsapp_shopping_reserve('00000000-0000-0000-0000-000000000001','m1'))='reserved','Q1 reserva');
SELECT pg_temp.ok((SELECT claim_state FROM whatsapp_shopping_reserve('00000000-0000-0000-0000-000000000001','m1'))='duplicate','Q2 duplicado nao reserva de novo');
-- Q3 finish 0 chamadas libera (não conta)
SELECT pg_temp.ok((SELECT user_remaining FROM whatsapp_shopping_finish('00000000-0000-0000-0000-000000000001','m1',0,'r'))=10,'Q3 zero chamadas libera');
-- Q4 finish idempotente: segundo finish não altera
SELECT pg_temp.ok((SELECT NOT finished FROM whatsapp_shopping_finish('00000000-0000-0000-0000-000000000001','m1',2,'x')),'Q4 finish repetido ignorado');
SELECT pg_temp.ok((SELECT api_calls FROM whatsapp_shopping_searches WHERE external_id='m1')=0,'Q4b chamadas preservadas');
-- Q5 tentativas inválidas recusadas
DO $$ BEGIN PERFORM whatsapp_shopping_reserve('00000000-0000-0000-0000-000000000001','m5');
  BEGIN PERFORM whatsapp_shopping_finish('00000000-0000-0000-0000-000000000001','m5',3,null); RAISE EXCEPTION 'FALHOU Q5';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF; END;
  RAISE NOTICE 'PASSOU Q5 tentativas>2 recusadas'; END $$;
-- Q6 limite usuário 10 (m5 pendente conta)
DO $$ DECLARE i int; s text; BEGIN
  PERFORM whatsapp_shopping_finish('00000000-0000-0000-0000-000000000001','m5',1,'r');
  FOR i IN 1..9 LOOP SELECT claim_state INTO s FROM whatsapp_shopping_reserve('00000000-0000-0000-0000-000000000001','u'||i);
    PERFORM whatsapp_shopping_finish('00000000-0000-0000-0000-000000000001','u'||i,1,'r'); END LOOP;
  SELECT claim_state INTO s FROM whatsapp_shopping_reserve('00000000-0000-0000-0000-000000000001','u11');
  IF s <> 'user_quota' THEN RAISE EXCEPTION 'FALHOU Q6 %', s; END IF; RAISE NOTICE 'PASSOU Q6 limite 10/usuario'; END $$;
-- Q7 falha com chamada conta (api_calls=1 já contado acima); usuário 2 independe
SELECT pg_temp.ok((SELECT claim_state FROM whatsapp_shopping_reserve('00000000-0000-0000-0000-000000000002','a'))='reserved','Q7 isolamento por usuario');
-- Q8 órfã expira de forma conservadora (2 chamadas)
RESET ROLE;
UPDATE whatsapp_shopping_searches SET created_at = now() - interval '20 minutes' WHERE external_id='a';
SET ROLE service_role;
SELECT whatsapp_shopping_reserve('00000000-0000-0000-0000-000000000003','z');
SELECT pg_temp.ok((SELECT state='expired' AND api_calls=2 FROM whatsapp_shopping_searches WHERE external_id='a'),'Q8 orfa expirada conta 2');
-- Q9 novo mês zera contagem
RESET ROLE;
UPDATE whatsapp_shopping_searches SET month_key='2000-01' WHERE user_id='00000000-0000-0000-0000-000000000001';
SET ROLE service_role;
SELECT pg_temp.ok((SELECT claim_state FROM whatsapp_shopping_reserve('00000000-0000-0000-0000-000000000001','novo'))='reserved','Q9 novo mes renova');
-- Q10 teto global 200 chamadas nunca ultrapassado
DO $$ DECLARE i int; s text; tot int; BEGIN
  FOR i IN 1..150 LOOP SELECT claim_state INTO s FROM whatsapp_shopping_reserve(gen_random_uuid(),'g'||i); END LOOP;
  SELECT coalesce(sum(CASE WHEN state='pending' THEN reserved_calls ELSE api_calls END),0) INTO tot
    FROM whatsapp_shopping_searches WHERE month_key = whatsapp_shopping_month_key();
  IF tot > 200 THEN RAISE EXCEPTION 'FALHOU Q10 %', tot; END IF;
  IF s <> 'global_quota' THEN RAISE EXCEPTION 'FALHOU Q10b %', s; END IF;
  RAISE NOTICE 'PASSOU Q10 teto global % <= 200', tot; END $$;
RESET ROLE;
-- Q11 papéis de API não escrevem direto nem executam RPC
DO $$ BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM whatsapp_shopping_reserve(gen_random_uuid(),'h'); RAISE EXCEPTION 'FALHOU Q11a';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM whatsapp_shopping_searches; RAISE EXCEPTION 'FALHOU Q11b';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE; SET LOCAL ROLE service_role;
  BEGIN UPDATE whatsapp_shopping_searches SET api_calls=0; RAISE EXCEPTION 'FALHOU Q11c';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO whatsapp_shopping_searches(user_id,external_id,month_key) VALUES (gen_random_uuid(),'x','2026-10'); RAISE EXCEPTION 'FALHOU Q11d';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASSOU Q11 sem escrita direta / sem RPC para authenticated'; END $$;
SELECT pg_temp.ok(NOT has_function_privilege('anon','whatsapp_shopping_finish(uuid,text,integer,text)','EXECUTE'),'Q12 anon sem EXECUTE');
SELECT pg_temp.ok((SELECT bool_and(p.prosecdef AND array_to_string(p.proconfig,',') LIKE 'search_path=pg_catalog, public%')
  FROM pg_proc p WHERE p.proname IN ('whatsapp_shopping_reserve','whatsapp_shopping_finish')),'Q13 SECURITY DEFINER com search_path fixo');
