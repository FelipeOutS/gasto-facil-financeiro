\set F '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'
\set M '47df50ce-df1e-4c54-8fae-0ffb5105478d'
CREATE FUNCTION pg_temp.ok(c boolean,n text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %',n; END IF; END $$;
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
SELECT pg_temp.ok(NOT has_function_privilege('authenticated','public.pluggy_link_real_card(uuid,text,uuid)','EXECUTE'),'browser cannot link directly');
INSERT INTO public.pluggy_accounts(user_id,item_id,account_id,type,name,is_sandbox) VALUES (:'F','iReal','real-card','CREDIT','Test card',false);
INSERT INTO public.cartoes(id,user_id,nome,dia_fechamento,dia_vencimento) VALUES ('00000000-0000-0000-0000-00000000da01',:'F','Test card',25,5),('00000000-0000-0000-0000-00000000da02',:'M','Other owner',25,5);
INSERT INTO public.pluggy_items(user_id,item_id,connector_id,connector_name,is_sandbox) VALUES (:'F','sandbox-link',2,'Sandbox',true);
INSERT INTO public.pluggy_accounts(user_id,item_id,account_id,type,name,is_sandbox) VALUES (:'F','sandbox-link','sandbox-card','CREDIT','Sandbox',true);
SET ROLE service_role;
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.pluggy_link_real_card('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','sandbox-card','00000000-0000-0000-0000-00000000da01')$q$)='pluggy_conta_cartao_invalida','sandbox cannot link real card');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.pluggy_link_real_card('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','real-card','00000000-0000-0000-0000-00000000da02')$q$)='pluggy_cartao_invalido','other owner blocked');
SELECT public.pluggy_link_real_card(:'F','real-card','00000000-0000-0000-0000-00000000da01');
SELECT pg_temp.ok(active,'link saved') FROM public.pluggy_card_links WHERE user_id=:'F' AND account_id='real-card';
SELECT public.pluggy_link_real_card(:'F','real-card',null);
SELECT pg_temp.ok(NOT active,'unlink deactivates') FROM public.pluggy_card_links WHERE user_id=:'F' AND account_id='real-card';
SELECT pg_temp.ok(pg_temp.err('SELECT public.pluggy_assert_financial_release()')='pluggy_gravacao_financeira_bloqueada','link never opens financial lock');
RESET ROLE;
