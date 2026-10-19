-- Fase 4: importação real em LOTE FECHADO (candidata) em banco DESCARTÁVEL. Roda após 50-real-once.sql.
\set F '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'
\set M '47df50ce-df1e-4c54-8fae-0ffb5105478d'
CREATE FUNCTION pg_temp.ok(c boolean, n text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF c THEN RAISE NOTICE 'PASSOU: %', n; ELSE RAISE EXCEPTION 'FALHOU: %', n; END IF; END $$;
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

INSERT INTO public.pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,description,amount,date,status,type,classification,classification_reason,is_sandbox) VALUES
 (:'F','iReal','aReal','b1','k-b1','Rendimentos',0.07,'2026-10-20','POSTED','CREDIT','receita','credito_conta',false),
 (:'F','iReal','aReal','b2','k-b2','Pix recebido João',123.45,'2026-10-21','POSTED','CREDIT','receita','credito_conta',false),
 (:'F','iReal','aReal','b3','k-b3','Pix enviado Padaria',17.33,'2026-10-21','POSTED','DEBIT','gasto','debito_conta',false),
 (:'F','iReal','aReal','bx','k-bx','Pix enviado Ana',44.44,'2026-10-22','POSTED','DEBIT','gasto','debito_conta',false),
 (:'F','iReal','aReal','bwa','k-bwa','Pix enviado Mercado',61.11,'2026-10-22','POSTED','DEBIT','gasto','debito_conta',false),
 (:'F','iReal','aReal','bmp','k-bmp','Pagamento',7,'2026-10-22','POSTED','DEBIT','gasto','debito_conta',false),
 (:'F','iReal','aReal','bpend','k-bpend','Pendente',9.99,'2026-10-22','PENDING','DEBIT','gasto','debito_conta',false),
 (:'F','iReal','aReal','c1','k-c1','Rendimentos',0.05,'2026-10-23','POSTED','CREDIT','receita','credito_conta',false),
 (:'F','iReal','aReal','c2','k-c2','Rendimentos',0.06,'2026-10-23','POSTED','CREDIT','receita','credito_conta',false);
-- Lançamento do WhatsApp coincidente (61,11 em 22/10) e MP antigo (7,00 em 22/10)
INSERT INTO public.gastos(user_id,descricao,valor,data,forma_pagamento,mes,ano,origem) VALUES (:'F','Mercado via WhatsApp',61.11,'2026-10-22','pix',10,2026,'whatsapp');
INSERT INTO public.imported_transactions(user_id,provider,provider_transaction_id,amount,status,occurred_at) VALUES (:'F','mercado_pago','mp-old-7',-7,'approved','2026-10-22 12:00Z');
SELECT id AS cat FROM public.categorias WHERE user_id=:'F' ORDER BY id LIMIT 1 \gset
SELECT md5(string_agg(t::text, ',' ORDER BY id)) AS h_mp FROM public.imported_transactions t \gset
SELECT md5(string_agg(g::text, ',' ORDER BY id)) AS h_g FROM public.gastos g \gset
SELECT md5(string_agg(r::text, ',' ORDER BY id)) AS h_r FROM public.receitas r \gset
SELECT count(*) AS n_ent0 FROM public.pluggy_import_entries \gset

\set L1 '00000000-0000-0000-0000-00000000ba01'
\set L2 '00000000-0000-0000-0000-00000000ba02'
\set L3 '00000000-0000-0000-0000-00000000ba03'
\set L4 '00000000-0000-0000-0000-00000000ba04'
\set L5 '00000000-0000-0000-0000-00000000ba05'
\set L6 '00000000-0000-0000-0000-00000000ba06'

-- Privilégios
SELECT pg_temp.ok(NOT has_function_privilege('authenticated','public.pluggy_import_apply_real_batch(uuid,uuid,jsonb)','EXECUTE') AND NOT has_function_privilege('anon','public.pluggy_import_revert_real_batch(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.pluggy_real_batch_in_use(uuid,text,text,text,uuid)','EXECUTE'), 'lote: authenticated/anon não executam');
SELECT pg_temp.ok(NOT has_table_privilege('service_role','public.pluggy_real_batch_grants','INSERT') AND NOT has_table_privilege('service_role','public.pluggy_real_batch_grant_items','INSERT') AND NOT has_table_privilege('service_role','public.pluggy_real_batch_grants','UPDATE') AND NOT has_table_privilege('authenticated','public.pluggy_real_batch_grant_items','SELECT'), 'lote: servidor não cria/altera autorização; usuário não lê');
SET ROLE service_role;
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.pluggy_real_batch_grants(batch_id,user_id,item_count,total,expires_at) VALUES(gen_random_uuid(),%L,1,1,now()+interval ''1 day'')', :'F')) LIKE '%permission denied%', 'service_role não cria autorização de lote');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_batch(%L,gen_random_uuid(),''[]'')', :'F')) LIKE '%lote_nao_autorizado%', 'sem autorização de lote nada é gravado');
RESET ROLE;

-- Autorizações (feitas pelo dono do banco, como seria o SQL aprovado)
INSERT INTO public.pluggy_real_batch_grants(batch_id,user_id,item_count,total,expires_at) VALUES
 (:'L1',:'F',3,140.85,now()+interval '1 day'),
 (:'L2',:'F',2,105.55,now()+interval '1 day'),
 (:'L3',:'F',1,7,now()+interval '1 day'),
 (:'L4',:'F',1,9.99,now()+interval '1 day'),
 (:'L5',:'F',2,0.11,now()+interval '1 day'),
 (:'L6',:'F',1,0.05,now()-interval '1 minute');
INSERT INTO public.pluggy_real_batch_grant_items(batch_id,user_id,account_id,transaction_id,entry_table,valor,data,categoria_id,tipo) VALUES
 (:'L1',:'F','aReal','b1','receitas',0.07,'2026-10-20',NULL,'outros'),
 (:'L1',:'F','aReal','b2','receitas',123.45,'2026-10-21',NULL,'pix'),
 (:'L1',:'F','aReal','b3','gastos',17.33,'2026-10-21',:'cat',NULL),
 (:'L2',:'F','aReal','bx','gastos',44.44,'2026-10-22',:'cat',NULL),
 (:'L2',:'F','aReal','bwa','gastos',61.11,'2026-10-22',:'cat',NULL),
 (:'L3',:'F','aReal','bmp','gastos',7,'2026-10-22',:'cat',NULL),
 (:'L4',:'F','aReal','bpend','gastos',9.99,'2026-10-22',:'cat',NULL),
 (:'L5',:'F','aReal','c1','receitas',0.05,'2026-10-23',NULL,'outros');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.pluggy_real_batch_grant_items(batch_id,user_id,account_id,transaction_id,entry_table,valor,data,tipo) VALUES(%L,%L,''aReal'',''r1'',''receitas'',0.01,''2026-10-16'',''outros'')', :'L5', :'F')) LIKE '%ja_autorizada_ou_importada%', 'transação do 1º teste (importada e desfeita) não entra em lote');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.pluggy_real_batch_grant_items(batch_id,user_id,account_id,transaction_id,entry_table,valor,data,tipo) VALUES(%L,%L,''aReal'',''b1'',''receitas'',0.07,''2026-10-20'',''outros'')', :'L5', :'F')) LIKE '%duplicate key%', 'mesma transação não entra em dois lotes');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.pluggy_real_batch_grant_items(batch_id,user_id,account_id,transaction_id,entry_table,valor,data,tipo) VALUES(%L,%L,''aRealM'',''m1'',''receitas'',0.01,''2026-10-16'',''outros'')', :'L5', :'M')) LIKE '%check%', 'itens de lote só para o Felipe');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.pluggy_real_batch_grant_items(batch_id,user_id,account_id,transaction_id,entry_table,valor,data) VALUES(%L,%L,''aReal'',''c2'',''gastos'',0.06,''2026-10-23'')', :'L5', :'F')) LIKE '%check%', 'gasto exige categoria fixada na autorização');
INSERT INTO public.pluggy_real_batch_grant_items(batch_id,user_id,account_id,transaction_id,entry_table,valor,data,tipo) VALUES (:'L5',:'F','aReal','c2','receitas',0.06,'2026-10-23','outros');

SELECT '[{"account_id":"aReal","transaction_id":"b1","descricao":"Rendimentos"},{"account_id":"aReal","transaction_id":"b2","descricao":"Pix recebido João"},{"account_id":"aReal","transaction_id":"b3","descricao":"Padaria"}]' AS rows1 \gset
SET ROLE service_role;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_batch(%L,%L,%L)', :'M', :'L1', :'rows1')) LIKE '%nao_autorizado%', 'Michael recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_batch(%L,%L,%L)', :'F', :'L1', ((:'rows1')::jsonb - 2)::text)) LIKE '%lista_nao_autorizada%', 'lista com item faltando recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_batch(%L,%L,%L)', :'F', :'L1', ((:'rows1')::jsonb || '[{"account_id":"aReal","transaction_id":"bx","descricao":"x"}]')::text)) LIKE '%lista_nao_autorizada%', 'lista com item não autorizado recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_batch(%L,%L,%L)', :'F', :'L1', (((:'rows1')::jsonb - 2) || '[{"account_id":"aReal","transaction_id":"b1","descricao":"x"}]')::text)) LIKE '%lista_nao_autorizada%', 'item repetido na lista recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_batch(%L,%L,%L)', :'F', :'L2', :'rows1')) LIKE '%lista_nao_autorizada%', 'lista de outro lote recusada');
-- Lote com 1 item válido + 1 coincidente com WhatsApp: tudo abortado
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_batch(%L,%L,%L)', :'F', :'L2', '[{"account_id":"aReal","transaction_id":"bx","descricao":"Ana"},{"account_id":"aReal","transaction_id":"bwa","descricao":"Mercado"}]')) LIKE '%possivel_duplicata%', 'coincidência com WhatsApp aborta o lote');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.gastos WHERE id_operacao_banco IN ('pluggy:aReal:bx','pluggy:aReal:bwa')) AND NOT EXISTS (SELECT 1 FROM public.extratos_importados WHERE id=:'L2') AND (SELECT consumed_at IS NULL AND active_txid IS NULL FROM public.pluggy_real_batch_grants WHERE batch_id=:'L2'), 'tudo-ou-nada: item válido do lote abortado também não foi gravado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_batch(%L,%L,%L)', :'F', :'L3', '[{"account_id":"aReal","transaction_id":"bmp","descricao":"Pagamento"}]')) LIKE '%possivel_duplicata%', 'coincidência com Mercado Pago antigo bloqueia');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_batch(%L,%L,%L)', :'F', :'L4', '[{"account_id":"aReal","transaction_id":"bpend","descricao":"Pendente"}]')) LIKE '%nao_elegivel%', 'movimentação pendente recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_batch(%L,%L,%L)', :'F', :'L6', '[]')) LIKE '%expirada%', 'autorização de lote expirada recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply_real_batch(%L,%L,%L)', :'F', :'L1', '[{"account_id":"aReal","transaction_id":"b1","descricao":""},{"account_id":"aReal","transaction_id":"b2","descricao":"a"},{"account_id":"aReal","transaction_id":"b3","descricao":"b"}]')) LIKE '%lancamento_invalido%', 'descrição vazia aborta o lote');
SELECT pg_temp.ok((SELECT count(*) FROM public.pluggy_import_entries) = :n_ent0 AND (SELECT consumed_at IS NULL FROM public.pluggy_real_batch_grants WHERE batch_id=:'L1'), 'falhas não consomem autorização nem gravam');
-- Sucesso
SELECT pg_temp.ok((public.pluggy_import_apply_real_batch(:'F',:'L1',:'rows1')->>'receitas')::int = 2, 'lote de 3 gravado (2 receitas + 1 gasto)');
SELECT pg_temp.ok((SELECT count(*) FROM public.receitas WHERE import_batch_id=:'L1' AND origem='pluggy' AND deleted_at IS NULL) = 2 AND (SELECT count(*) FROM public.gastos WHERE import_batch_id=:'L1' AND origem='pluggy' AND deleted_at IS NULL AND categoria_id=:'cat' AND cartao_id IS NULL) = 1, 'lançamentos nos módulos existentes com categoria fixada');
SELECT pg_temp.ok((SELECT tipo FROM public.receitas WHERE id_operacao_banco='pluggy:aReal:b2') = 'pix' AND (SELECT valor FROM public.receitas WHERE id_operacao_banco='pluggy:aReal:b2') = 123.45, 'valor e tipo vêm da autorização');
SELECT pg_temp.ok((SELECT qtd_movimentacoes=3 AND total_receitas=123.52 AND total_despesas=17.33 AND status='importado' FROM public.extratos_importados WHERE id=:'L1'), 'histórico do lote com quantidade e totais');
SELECT pg_temp.ok((public.pluggy_import_apply_real_batch(:'F',:'L1',:'rows1')->>'replay')::boolean AND (SELECT count(*) FROM public.pluggy_import_entries WHERE batch_id=:'L1') = 3, 'clique repetido: replay sem duplicar');
SELECT pg_temp.ok((SELECT consumed_at IS NOT NULL AND active_txid IS NULL FROM public.pluggy_real_batch_grants WHERE batch_id=:'L1'), 'autorização consumida e janela fechada');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.pluggy_import_entries(user_id,account_id,transaction_id,entry_table,entry_id,batch_id,snapshot) VALUES(%L,''aReal'',''bx'',''gastos'',gen_random_uuid(),%L,''{}'')', :'F', :'L1')) LIKE '%bloqueada%', 'gravação direta com lote autorizado continua bloqueada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply(%L,gen_random_uuid(),''[]'')', :'F')) LIKE '%bloqueada%', 'importação genérica continua bloqueada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_revert(%L,%L)', :'F', :'L1')) LIKE '%bloqueada%', 'desfazer genérico continua bloqueado');
SELECT pg_temp.ok(pg_temp.err('SELECT public.pluggy_assert_financial_release()') LIKE '%gravacao_financeira_bloqueada%', 'trava global intacta');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.pluggy_real_batch_grant_items(batch_id,user_id,account_id,transaction_id,entry_table,valor,data,tipo) VALUES(%L,%L,''aReal'',''c9'',''receitas'',1,''2026-10-23'',''outros'')', :'L1', :'F')) ~ '(lote_fechado|foreign key)', 'lote consumido não aceita novos itens');
-- Edição manual de um item, depois desfazer: editado preservado
UPDATE public.gastos SET descricao='Padaria (editado)' WHERE id_operacao_banco='pluggy:aReal:b3';
SET ROLE service_role;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_revert_real_batch(%L,%L)', :'M', :'L1')) LIKE '%nao_autorizado%', 'Michael não desfaz');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_revert_real_batch(%L,%L)', :'F', :'L2')) LIKE '%lote_inexistente%', 'lote não gravado não é desfeito');
SELECT pg_temp.ok((SELECT (j->>'revertidos')::int = 2 AND (j->>'preservados')::int = 1 AND j->>'resultado' = 'parcial' FROM (SELECT public.pluggy_import_revert_real_batch(:'F',:'L1') j) s), 'desfazer: 2 revertidos, editado preservado');
SELECT pg_temp.ok((SELECT count(*) FROM public.receitas WHERE import_batch_id=:'L1' AND deleted_at IS NOT NULL AND deleted_reason='importacao_pluggy_desfeita') = 2 AND (SELECT deleted_at IS NULL FROM public.gastos WHERE id_operacao_banco='pluggy:aReal:b3'), 'exclusão reversível (deleted_at), sem exclusão física');
SELECT pg_temp.ok((SELECT count(*) FROM public.receitas WHERE import_batch_id=:'L1') = 2, 'linhas continuam existindo');
SELECT pg_temp.ok((SELECT status='parcial' FROM public.extratos_importados WHERE id=:'L1') AND (SELECT revert_outcome='parcial' AND revert_kept=1 FROM public.pluggy_real_batch_grants WHERE batch_id=:'L1'), 'lote e autorização registram desfazer parcial');
SELECT pg_temp.ok((public.pluggy_import_revert_real_batch(:'F',:'L1')->>'replay')::boolean, 'desfazer repetido é replay');
RESET ROLE;
-- Reimportar transação desfeita: bloqueado na criação da autorização
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.pluggy_real_batch_grants(batch_id,user_id,item_count,total,expires_at) VALUES(gen_random_uuid(),%L,1,0.07,now()+interval ''1 day''); INSERT INTO public.pluggy_real_batch_grant_items(batch_id,user_id,account_id,transaction_id,entry_table,valor,data,tipo) SELECT batch_id,%L,''aReal'',''b1'',''receitas'',0.07,''2026-10-20'',''outros'' FROM public.pluggy_real_batch_grants WHERE total=0.07', :'F', :'F')) !~ '^ok$', 'transação desfeita não pode ser reautorizada');
-- Integridade
SELECT pg_temp.ok((SELECT md5(string_agg(t::text, ',' ORDER BY id)) FROM public.imported_transactions t) = :'h_mp', 'MP antigo intacto');
SELECT pg_temp.ok((SELECT md5(string_agg(g::text, ',' ORDER BY id)) FROM public.gastos g WHERE import_batch_id IS DISTINCT FROM :'L1') = :'h_g', 'gastos anteriores intactos');
SELECT pg_temp.ok((SELECT md5(string_agg(r::text, ',' ORDER BY id)) FROM public.receitas r WHERE import_batch_id IS DISTINCT FROM :'L1') = :'h_r', 'receitas anteriores intactas');
