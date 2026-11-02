-- Primeira importação real controlada (candidata) em banco DESCARTÁVEL.
\set F '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'
\set M '47df50ce-df1e-4c54-8fae-0ffb5105478d'
CREATE FUNCTION pg_temp.ok(c boolean, n text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF c THEN RAISE NOTICE 'PASSOU: %', n; ELSE RAISE EXCEPTION 'FALHOU: %', n; END IF; END $$;
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

INSERT INTO public.pluggy_items(user_id,item_id,connector_id,connector_name,is_sandbox) VALUES (:'F','iReal',606,'Mercado Pago',false),(:'M','iRealM',606,'Mercado Pago',false),(:'F','iOther',206,'Mercado Pago',false);
INSERT INTO public.pluggy_accounts(user_id,item_id,account_id,type,is_sandbox) VALUES (:'F','iReal','aReal','BANK',false),(:'F','iReal','cReal','CREDIT',false),(:'M','iRealM','aRealM','BANK',false),(:'F','iOther','aOther','BANK',false);
INSERT INTO public.pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,description,amount,date,status,type,classification,classification_reason,is_sandbox) VALUES
 (:'F','iReal','aReal','r1','k-r1','Rendimentos',0.01,'2026-10-16','POSTED','CREDIT','receita','credito_conta',false),
 (:'F','iReal','aReal','g1','k-g1','Pix enviado Maria',35,'2026-10-17','POSTED','DEBIT','gasto','debito_conta',false),
 (:'F','iReal','aReal','dup1','k-dup1','Pix recebido',50,'2026-10-15','POSTED','CREDIT','receita','credito_conta',false),
 (:'F','iReal','aReal','rev1','k-rev1','Reembolso Uber',38.94,'2026-10-12','POSTED','CREDIT','revisao','estorno',false),
 (:'F','iReal','cReal','card1','k-card1','Loja',20,'2026-10-12','POSTED','DEBIT','gasto','compra_cartao',false),
 (:'F','iReal','aReal','exp1','k-exp1','Rendimentos',0.02,'2026-10-14','POSTED','CREDIT','receita','credito_conta',false),
 (:'F','iOther','aOther','o1','k-o1','Outro conector',10,'2026-10-14','POSTED','CREDIT','receita','credito_conta',false),
 (:'M','iRealM','aRealM','m1','k-m1','Rendimentos',0.01,'2026-10-16','POSTED','CREDIT','receita','credito_conta',false);
INSERT INTO public.receitas(user_id,descricao,valor,data,tipo,mes,ano,origem) VALUES (:'F','Pix recebido manual',50,'2026-10-15','pix',10,2026,'manual');
SELECT id AS cat FROM public.categorias WHERE user_id=:'F' ORDER BY id LIMIT 1 \gset
SELECT md5(string_agg(t::text, ',' ORDER BY id)) AS h_mp FROM public.imported_transactions t \gset
SELECT md5(string_agg(g::text, ',' ORDER BY id)) AS h_g FROM public.gastos g \gset
SELECT md5(string_agg(r::text, ',' ORDER BY id)) AS h_r FROM public.receitas r \gset

SELECT pg_temp.ok(NOT has_function_privilege('authenticated','public.pluggy_import_apply_real_once(uuid,text,text,uuid,jsonb)','EXECUTE') AND NOT has_function_privilege('anon','public.pluggy_import_revert_real_once(uuid,uuid)','EXECUTE'), 'real-once: authenticated/anon não executam');
SELECT pg_temp.ok(NOT has_table_privilege('service_role','public.pluggy_real_import_grants','INSERT') AND NOT has_table_privilege('service_role','public.pluggy_real_import_grants','UPDATE') AND NOT has_table_privilege('authenticated','public.pluggy_real_import_grants','SELECT'), 'autorizações: servidor não cria nem altera; usuário não lê');

SET ROLE service_role;
SELECT pg_temp.ok(pg_temp.err('SELECT public.pluggy_assert_financial_release()') LIKE '%gravacao_financeira_bloqueada%', 'trava global continua rejeitando');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.pluggy_real_import_grants(user_id,account_id,transaction_id,entry_table,valor,data,expires_at) VALUES(%L,''aReal'',''r1'',''receitas'',0.01,''2026-10-16'',now()+interval ''1 day'')', :'F')) LIKE '%permission denied%', 'service_role não autoriza movimentação');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_once(%L,''aReal'',''r1'',gen_random_uuid(),%L)', :'F', jsonb_build_object('descricao','Rendimentos','valor',0.01,'data','2026-10-16','tipo','outros','id_operacao_banco','pluggy:aReal:r1'))) LIKE '%autorizacao_inexistente%', 'sem autorização expressa nada é gravado');
RESET ROLE;
\set B1 '00000000-0000-0000-0000-0000000b0001'
\set B2 '00000000-0000-0000-0000-0000000b0002'

INSERT INTO public.pluggy_real_import_grants(user_id,account_id,transaction_id,entry_table,valor,data,batch_id,expires_at) VALUES
 (:'F','aReal','r1','receitas',0.01,'2026-10-16',:'B1',now()+interval '1 day'),
 (:'F','aReal','g1','gastos',35,'2026-10-17',:'B2',now()+interval '1 day');
INSERT INTO public.pluggy_real_import_grants(user_id,account_id,transaction_id,entry_table,valor,data,expires_at) VALUES
 (:'F','aReal','dup1','receitas',50,'2026-10-15',now()+interval '1 day'),
 (:'F','aReal','rev1','receitas',38.94,'2026-10-12',now()+interval '1 day'),
 (:'F','cReal','card1','gastos',20,'2026-10-12',now()+interval '1 day'),
 (:'F','aReal','exp1','receitas',0.02,'2026-10-14',now()-interval '1 minute'),
 (:'F','aOther','o1','receitas',10,'2026-10-14',now()+interval '1 day');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.pluggy_real_import_grants(user_id,account_id,transaction_id,entry_table,valor,data,expires_at) VALUES(%L,''aRealM'',''m1'',''receitas'',0.01,''2026-10-16'',now()+interval ''1 day'')', :'M')) LIKE '%check%', 'autorização só existe para a conta do Felipe');

\set B3 '00000000-0000-0000-0000-0000000b0003'
SELECT jsonb_build_object('descricao','Rendimentos','valor',0.01,'data','2026-10-16','tipo','outros','id_operacao_banco','pluggy:aReal:r1') AS row_r1 \gset
SET ROLE service_role;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_once(%L,''aRealM'',''m1'',gen_random_uuid(),%L)', :'M', :'row_r1')) LIKE '%nao_autorizado%', 'Michael recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_once(%L,''aReal'',''r1'',%L,%L)', :'F', :'B1', (:'row_r1')::jsonb || '{"valor":9.99}')) LIKE '%lancamento_invalido%', 'valor adulterado recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_once(%L,''aReal'',''r1'',gen_random_uuid(),%L)', :'F', :'row_r1')) LIKE '%lote_nao_autorizado%', 'movimentação correta com lote incorreto recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_once(%L,''aReal'',''r1'',%L,%L)', :'F', :'B2', :'row_r1')) LIKE '%lote_nao_autorizado%', 'lote de outra autorização recusado');
SELECT pg_temp.ok((SELECT consumed_at IS NULL FROM public.pluggy_real_import_grants WHERE transaction_id='r1') AND NOT EXISTS (SELECT 1 FROM public.receitas WHERE id_operacao_banco='pluggy:aReal:r1'), 'falha não consome autorização nem grava');
SELECT public.pluggy_import_apply_real_once(:'F','aReal','r1',:'B1',:'row_r1');
SELECT pg_temp.ok((SELECT count(*) FROM public.receitas WHERE id_operacao_banco='pluggy:aReal:r1' AND deleted_at IS NULL AND origem='pluggy' AND import_batch_id=:'B1') = 1, 'uma receita real criada no módulo Receitas');
SELECT pg_temp.ok((SELECT banco='Mercado Pago' AND tipo_origem='pluggy' AND observacao LIKE '%conector 606%aReal%r1%' FROM public.extratos_importados WHERE id=:'B1'), 'lote registra instituição, conector, conta e transação');
SELECT pg_temp.ok((public.pluggy_import_apply_real_once(:'F','aReal','r1',:'B1',:'row_r1')->>'replay')::boolean AND (SELECT count(*) FROM public.receitas WHERE id_operacao_banco='pluggy:aReal:r1') = 1, 'clique repetido: replay sem duplicar');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_once(%L,''aReal'',''r1'',gen_random_uuid(),%L)', :'F', :'row_r1')) LIKE '%lote_nao_autorizado%', 'autorização consumida não aceita outro lote');
SELECT pg_temp.ok((SELECT active_txid IS NULL FROM public.pluggy_real_import_grants WHERE transaction_id='r1'), 'liberação encerrada ao fim da operação');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.pluggy_import_entries(user_id,account_id,transaction_id,entry_table,entry_id,batch_id,snapshot) VALUES(%L,''aReal'',''g1'',''gastos'',gen_random_uuid(),%L,''{}'')', :'F', :'B1')) LIKE '%bloqueada%', 'gravação direta com o lote autorizado continua bloqueada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_revert(%L,%L)', :'F', :'B1')) LIKE '%bloqueada%', 'desfazer genérico continua bloqueado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply(%L,gen_random_uuid(),''[]'')', :'F')) LIKE '%bloqueada%', 'importação genérica continua bloqueada');
-- Dashboard/Relatórios leem receitas não excluídas do mês
SELECT pg_temp.ok((SELECT coalesce(sum(valor),0) FROM public.receitas WHERE user_id=:'F' AND deleted_at IS NULL AND mes=10 AND ano=2026 AND origem='pluggy') = 0.01, 'total do mês inclui o lançamento importado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_once(%L,''aReal'',''dup1'',(SELECT batch_id FROM public.pluggy_real_import_grants WHERE transaction_id=''dup1''),%L)', :'F', jsonb_build_object('descricao','Pix recebido','valor',50,'data','2026-10-15','id_operacao_banco','pluggy:aReal:dup1'))) LIKE '%possivel_duplicata%', 'coincidência com lançamento manual bloqueia');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_once(%L,''aReal'',''rev1'',(SELECT batch_id FROM public.pluggy_real_import_grants WHERE transaction_id=''rev1''),%L)', :'F', jsonb_build_object('descricao','Reembolso','valor',38.94,'data','2026-10-12','id_operacao_banco','pluggy:aReal:rev1'))) LIKE '%nao_elegivel%', 'estorno em revisão não entra');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_once(%L,''cReal'',''card1'',(SELECT batch_id FROM public.pluggy_real_import_grants WHERE transaction_id=''card1''),%L)', :'F', jsonb_build_object('descricao','Loja','valor',20,'data','2026-10-12','categoria_id',:'cat','id_operacao_banco','pluggy:cReal:card1'))) LIKE '%origem_nao_permitida%', 'compra de cartão não entra');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_once(%L,''aReal'',''exp1'',(SELECT batch_id FROM public.pluggy_real_import_grants WHERE transaction_id=''exp1''),%L)', :'F', jsonb_build_object('descricao','Rendimentos','valor',0.02,'data','2026-10-14','id_operacao_banco','pluggy:aReal:exp1'))) LIKE '%expirada%', 'autorização expirada recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_once(%L,''aOther'',''o1'',(SELECT batch_id FROM public.pluggy_real_import_grants WHERE transaction_id=''o1''),%L)', :'F', jsonb_build_object('descricao','Outro','valor',10,'data','2026-10-14','id_operacao_banco','pluggy:aOther:o1'))) LIKE '%origem_nao_permitida%', 'outro conector recusado');
-- Desfazer
SELECT pg_temp.ok((public.pluggy_import_revert_real_once(:'F',:'B1')->>'revertidos')::int = 1, 'desfazer retira o lançamento importado');
SELECT pg_temp.ok((SELECT deleted_at IS NOT NULL FROM public.receitas WHERE id_operacao_banco='pluggy:aReal:r1') AND (SELECT coalesce(sum(valor),0) FROM public.receitas WHERE user_id=:'F' AND deleted_at IS NULL AND origem='pluggy') = 0, 'exclusão reversível; total do mês volta ao anterior');
SELECT pg_temp.ok((SELECT status='revertido' AND reverted_at IS NOT NULL FROM public.extratos_importados WHERE id=:'B1') AND (SELECT revert_outcome='revertido' AND revert_kept=0 FROM public.pluggy_real_import_grants WHERE batch_id=:'B1') AND (SELECT state='revertido' FROM public.pluggy_import_entries WHERE batch_id=:'B1'), 'desfazer total: lote, autorização e entrada coerentes');
SELECT pg_temp.ok((public.pluggy_import_revert_real_once(:'F',:'B1')->>'replay')::boolean, 'desfazer repetido é replay');
-- Editado manualmente é preservado
SELECT public.pluggy_import_apply_real_once(:'F','aReal','g1',:'B2', jsonb_build_object('descricao','Pix enviado Maria','valor',35,'data','2026-10-17','categoria_id',:'cat','forma_pagamento','pix','id_operacao_banco','pluggy:aReal:g1'));
RESET ROLE;
UPDATE public.gastos SET descricao='Maria (editado)', updated_at=now()+interval '1 second' WHERE id_operacao_banco='pluggy:aReal:g1';
SET ROLE service_role;
SELECT pg_temp.ok((public.pluggy_import_revert_real_once(:'F',:'B2')->>'preservados')::int = 1 AND (SELECT deleted_at IS NULL FROM public.gastos WHERE id_operacao_banco='pluggy:aReal:g1'), 'lançamento editado é preservado no desfazer');
SELECT pg_temp.ok((SELECT status='parcial' AND reverted_at IS NULL AND observacao LIKE '%preservado(s) por edição manual%' FROM public.extratos_importados WHERE id=:'B2'), 'desfazer parcial: lote fica parcial, não declara reversão total');
SELECT pg_temp.ok((SELECT revert_outcome='parcial' AND revert_kept=1 FROM public.pluggy_real_import_grants WHERE batch_id=:'B2') AND (SELECT state='ativo' FROM public.pluggy_import_entries WHERE batch_id=:'B2'), 'desfazer parcial: autorização registra preservação; entrada continua ativa');
SELECT pg_temp.ok((public.pluggy_import_revert_real_once(:'F',:'B2')->>'resultado') = 'parcial', 'replay do desfazer parcial informa parcial');
RESET ROLE;
-- Janela de exceção aberta (txid ativo) só vale para a identidade exata
CREATE FUNCTION pg_temp.in_window(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.pluggy_real_import_grants SET active_txid = txid_current() WHERE batch_id = '00000000-0000-0000-0000-0000000b0001';
  EXECUTE q; RAISE EXCEPTION 'GRAVOU';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
SELECT pg_temp.ok(pg_temp.in_window(format('INSERT INTO public.pluggy_import_entries(user_id,account_id,transaction_id,entry_table,entry_id,batch_id,snapshot) VALUES(%L,''aReal'',''g1'',''gastos'',gen_random_uuid(),%L,''{}'')', :'F', :'B1')) LIKE '%bloqueada%', 'mesmo lote com outra movimentação: bloqueado');
SELECT pg_temp.ok(pg_temp.in_window(format('INSERT INTO public.pluggy_import_entries(user_id,account_id,transaction_id,entry_table,entry_id,batch_id,snapshot) VALUES(%L,''aRealM'',''m1'',''receitas'',gen_random_uuid(),%L,''{}'')', :'M', :'B1')) LIKE '%bloqueada%', 'mesmo lote com outro titular: bloqueado');
SELECT pg_temp.ok(pg_temp.in_window(format('INSERT INTO public.pluggy_import_entries(user_id,account_id,transaction_id,entry_table,entry_id,batch_id,snapshot) VALUES(%L,''aReal'',''r1'',''gastos'',gen_random_uuid(),%L,''{}'')', :'F', :'B1')) LIKE '%bloqueada%', 'mesmo lote com outra tabela: bloqueado');
SELECT pg_temp.ok(pg_temp.in_window(format('INSERT INTO public.pluggy_import_entries(user_id,account_id,transaction_id,entry_table,entry_id,batch_id,snapshot) VALUES(%L,''aReal'',''r1'',''receitas'',gen_random_uuid(),%L,''{}'')', :'F', :'B2')) LIKE '%bloqueada%', 'movimentação autorizada com lote de outra autorização: bloqueado');
SELECT pg_temp.ok((SELECT active_txid IS NULL FROM public.pluggy_real_import_grants WHERE batch_id=:'B1'), 'janela simulada desfeita (rollback)');
SET ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_once(%L,''aReal'',''r1'',%L,%L)', :'F', :'B1', :'row_r1')) LIKE '%permission denied%', 'sem privilégio: authenticated não executa importação');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_revert_real_once(%L,%L)', :'F', :'B1')) LIKE '%permission denied%', 'sem privilégio: authenticated não executa desfazer');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_real_grant_in_use(%L,''aReal'',''r1'',''receitas'',%L)', :'F', :'B1')) LIKE '%permission denied%', 'sem privilégio: authenticated não consulta a exceção');
RESET ROLE;
SET ROLE anon;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_once(%L,''aReal'',''r1'',%L,%L)', :'F', :'B1', :'row_r1')) LIKE '%permission denied%', 'sem privilégio: anon não executa importação');
RESET ROLE;
-- Integridade dos dados anteriores
SELECT pg_temp.ok((SELECT md5(string_agg(t::text, ',' ORDER BY id)) FROM public.imported_transactions t) = :'h_mp', 'movimentações antigas do Mercado Pago intactas');
SELECT pg_temp.ok((SELECT md5(string_agg(g::text, ',' ORDER BY id)) FROM public.gastos g WHERE coalesce(origem,'') <> 'pluggy' OR import_batch_id IS DISTINCT FROM :'B2') = :'h_g', 'gastos anteriores intactos');
SELECT pg_temp.ok((SELECT md5(string_agg(r::text, ',' ORDER BY id)) FROM public.receitas r WHERE import_batch_id IS DISTINCT FROM :'B1') = :'h_r', 'receitas anteriores intactas');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.gastos WHERE id_operacao_banco LIKE 'pluggy:aRealM:%') AND NOT EXISTS (SELECT 1 FROM public.receitas WHERE id_operacao_banco LIKE 'pluggy:aRealM:%'), 'Michael sem lançamentos');
