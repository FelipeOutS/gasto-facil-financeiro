-- Fase 3 em banco DESCARTÁVEL: semente Sandbox (40) + aplicação/reversão atômicas.
\set F '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'
\set M '47df50ce-df1e-4c54-8fae-0ffb5105478d'
\set U '99999999-0000-0000-0000-000000000009'
CREATE FUNCTION pg_temp.ok(c boolean, n text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF c THEN RAISE NOTICE 'PASSOU: %', n; ELSE RAISE EXCEPTION 'FALHOU: %', n; END IF; END $$;
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
\i :seed_file
SELECT md5(string_agg(t::text, ',' ORDER BY id)) AS h_mp FROM public.imported_transactions t \gset
SELECT md5(string_agg(g::text, ',' ORDER BY id)) AS h_g0 FROM public.gastos g \gset
SELECT md5(string_agg(r::text, ',' ORDER BY id)) AS h_r0 FROM public.receitas r \gset

-- Permissões
SELECT pg_temp.ok(NOT has_function_privilege('authenticated','public.pluggy_import_apply(uuid,uuid,jsonb)','EXECUTE') AND NOT has_function_privilege('anon','public.pluggy_import_apply(uuid,uuid,jsonb)','EXECUTE') AND NOT has_function_privilege('sandbox_exec','public.pluggy_import_apply(uuid,uuid,jsonb)','EXECUTE'), 'apply: só service_role executa');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated','public.pluggy_import_revert(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.pluggy_link_card(uuid,text,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.pluggy_review_decide(uuid,text,text,text)','EXECUTE'), 'revert/link/review: authenticated não executa');
SELECT pg_temp.ok(NOT has_table_privilege('anon','public.pluggy_import_entries','SELECT') AND NOT has_table_privilege('authenticated','public.pluggy_import_entries','INSERT') AND NOT has_table_privilege('sandbox_exec','public.pluggy_import_entries','SELECT') AND NOT has_table_privilege('sandbox_exec','public.pluggy_card_links','SELECT') AND NOT has_table_privilege('sandbox_exec','public.pluggy_review_decisions','SELECT'), 'tabelas novas: anon/sandbox_exec sem acesso, authenticated só leitura');

SET ROLE service_role;
-- Autorização
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply(%L, gen_random_uuid(), ''[]'')', :'U')) LIKE '%pluggy_nao_autorizado%', 'usuário comum recusado');
-- Sem vínculo de cartão: compra de cartão é recusada pelo banco (defesa em profundidade)
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply(%L, gen_random_uuid(), %L)', :'F',
  (SELECT jsonb_agg(e) FROM jsonb_array_elements(:'plan'::jsonb) e WHERE e->'row'->>'forma_pagamento' = 'credito' LIMIT 1))) LIKE '%cartao_sem_vinculo%', 'compra de cartão sem vínculo confirmado é recusada');
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE origem='pluggy') = 0 AND (SELECT count(*) FROM public.extratos_importados) = 0, 'falha reverte tudo (nenhum lote parcial)');
-- Vínculo: cartão de outro usuário recusado; do próprio aceito
INSERT INTO public.cartoes(id,user_id,nome) VALUES ('00000000-0000-0000-0000-00000000ca99', :'M', 'Cartão do Michael');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_link_card(%L,%L,%L)', :'F', :'CARD', '00000000-0000-0000-0000-00000000ca99')) LIKE '%pluggy_cartao_invalido%', 'não vincula cartão de outro usuário');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_link_card(%L,%L,%L)', :'M', :'CARD', :'CARTAO')) LIKE '%pluggy_conta_cartao_invalida%', 'Michael não vincula conta do Felipe');
SELECT public.pluggy_link_card(:'F', :'CARD', :'CARTAO');
SELECT pg_temp.ok(pg_temp.err(format('UPDATE public.pluggy_card_links SET cartao_id=%L WHERE user_id=%L AND account_id=%L','00000000-0000-0000-0000-00000000ca99',:'F',:'CARD')) LIKE '%pluggy_cartao_invalido%', 'direct service card update cannot bypass ownership');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.pluggy_review_decisions(user_id,account_id,transaction_id,decision) VALUES(%L,%L,''missing'',''aprovado'')',:'F',:'CARD')) LIKE '%foreign key%', 'review audit FK rejects nonexistent transaction');
SELECT public.pluggy_link_card(:'F', :'CARD', NULL);
SELECT public.pluggy_link_card(:'F', :'CARD', NULL);
SELECT pg_temp.ok((SELECT NOT active FROM public.pluggy_card_links WHERE user_id=:'F' AND account_id=:'CARD'), 'desvínculo idempotente preserva registro e não cria cartão');
SELECT public.pluggy_link_card(:'F', :'CARD', :'CARTAO');
-- Revisão pendente nunca entra
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply(%L, gen_random_uuid(), %L)', :'F',
  jsonb_build_array(jsonb_build_object('op','insert','table','gastos','account_id',t.account_id,'transaction_id',t.transaction_id,
   'row', jsonb_build_object('descricao','x','valor',t.amount,'data',t.date,'forma_pagamento','boleto','categoria_id','00000000-0000-0000-0000-0000000c0050','id_operacao_banco','pluggy:'||t.account_id||':'||t.transaction_id)))))
  LIKE '%nao_elegivel%', 'boleto em revisão não entra') FROM public.pluggy_transactions t WHERE classification='revisao';
-- Payload adulterado (valor diferente do banco) recusado
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply(%L, gen_random_uuid(), %L)', :'F',
  jsonb_build_array(jsonb_set(:'plan'::jsonb->0, '{row,valor}', '1')))) LIKE '%lancamento_invalido%', 'valor adulterado recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply(%L, gen_random_uuid(), %L)', :'F',
  (SELECT jsonb_agg(jsonb_set(e,'{row,fatura_competencia}','"2099-01"')) FROM jsonb_array_elements(:'plan'::jsonb) e WHERE e->'row'->>'forma_pagamento'='credito'))) LIKE '%cartao_sem_vinculo%', 'competência adulterada recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply(%L,gen_random_uuid(),%L)',:'F',
  (SELECT jsonb_agg(e #- '{row,forma_pagamento}') FROM jsonb_array_elements(:'plan'::jsonb) e WHERE e->'row'->>'forma_pagamento'='credito'))) LIKE '%cartao_sem_vinculo%', 'missing credit payment fails closed');
SELECT pg_temp.ok(pg_temp.err(format('UPDATE public.pluggy_transactions SET is_sandbox=false WHERE transaction_id=%L', :'plan'::jsonb->0->>'transaction_id')) LIKE '%pluggy_tx_sandbox_only%', 'transação Live recusada pela constraint existente');

-- Importação histórica
\set B1 '00000000-0000-0000-0000-0000000000f1'
SELECT public.pluggy_import_apply(:'F', :'B1', :'plan'::jsonb) AS r1 \gset
SELECT pg_temp.ok((:'r1'::jsonb->>'gastos')::int = 31 AND (:'r1'::jsonb->>'receitas')::int = 5, '31 gastos e 5 receitas importados');
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE origem='pluggy' AND user_id=:'F') = 31 AND (SELECT count(*) FROM public.receitas WHERE origem='pluggy' AND user_id=:'F') = 5, 'linhas reais nos módulos existentes com origem pluggy');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.gastos WHERE origem='pluggy' AND descricao ILIKE '%fatura%'), '3 pagamentos de fatura não contabilizados');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.gastos WHERE origem='pluggy' AND descricao='Pagamento de boleto'), 'boleto continua fora (revisão)');
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE origem='pluggy' AND cartao_id=:'CARTAO' AND forma_pagamento='credito' AND fatura_competencia IS NOT NULL) = (SELECT count(*) FROM public.pluggy_transactions t JOIN public.pluggy_accounts a USING (user_id,account_id) WHERE a.type='CREDIT' AND t.item_id='itemF'), 'compras de cartão no cartão vinculado, com competência ' || (SELECT count(*) FROM public.gastos WHERE origem='pluggy' AND cartao_id=:'CARTAO')::text || '/' || (SELECT count(*) FROM public.gastos WHERE origem='pluggy' AND forma_pagamento='credito')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE origem='pluggy' AND (parcela_atual IS NOT NULL OR total_parcelas IS NOT NULL OR tipo_gasto<>'unico')) = 0, 'nenhuma parcela inventada');
SELECT pg_temp.ok((SELECT count(DISTINCT id_operacao_banco) FROM public.gastos WHERE origem='pluggy') = 31, 'ID Pluggy preservado e único');
SELECT pg_temp.ok((SELECT string_agg(DISTINCT c.nome, ',') FROM public.gastos g JOIN public.categorias c ON c.id=g.categoria_id WHERE g.descricao ~ 'ELETROBRAS|VIVO') = 'Contas', 'Eletrobras/Vivo em Contas');
SELECT pg_temp.ok((SELECT qtd_movimentacoes FROM public.extratos_importados WHERE id=:'B1') = 36 AND (SELECT tipo_origem FROM public.extratos_importados WHERE id=:'B1') = 'pluggy', 'lote auditável registrado');
INSERT INTO public.extratos_importados(id,user_id,tipo_origem) VALUES ('00000000-0000-0000-0000-00000000ba99',:'M','pluggy'),('00000000-0000-0000-0000-00000000ba98',:'F','pdf');
SELECT pg_temp.ok(pg_temp.err('UPDATE public.pluggy_import_entries SET batch_id=''00000000-0000-0000-0000-00000000ba99''') LIKE '%identidade_imutavel%', 'entry source/batch identity cannot be rewritten');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.pluggy_import_entries(user_id,account_id,transaction_id,entry_table,entry_id,batch_id,snapshot) VALUES(%L,%L,%L,''gastos'',gen_random_uuid(),%L,''{}'')',:'F',:'plan'::jsonb->0->>'account_id',:'plan'::jsonb->0->>'transaction_id','00000000-0000-0000-0000-00000000ba99')) LIKE '%lote_invalido%', 'direct service entry cannot use another owner batch');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.pluggy_import_entries(user_id,account_id,transaction_id,entry_table,entry_id,batch_id,snapshot) VALUES(%L,%L,%L,''gastos'',gen_random_uuid(),%L,''{}'')',:'F',:'plan'::jsonb->0->>'account_id',:'plan'::jsonb->0->>'transaction_id','00000000-0000-0000-0000-00000000ba98')) LIKE '%lote_invalido%', 'direct service entry cannot use non Pluggy batch');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.pluggy_import_entries(user_id,account_id,transaction_id,entry_table,entry_id,batch_id,snapshot) VALUES(%L,%L,%L,''gastos'',''00000000-0000-0000-0000-0000000000a2'',%L,''{}'')',:'F',:'plan'::jsonb->0->>'account_id',:'plan'::jsonb->0->>'transaction_id',:'B1')) LIKE '%lancamento_invalido%', 'direct service entry cannot point to Michael manual expense');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.pluggy_import_entries(user_id,account_id,transaction_id,entry_table,entry_id,batch_id,snapshot) VALUES(%L,%L,%L,''receitas'',''00000000-0000-0000-0000-0000000000a1'',%L,''{}'')',:'F',:'plan'::jsonb->0->>'account_id',:'plan'::jsonb->0->>'transaction_id',:'B1')) LIKE '%lancamento_invalido%', 'polymorphic target cannot point at wrong table');
SELECT e.entry_id AS card_eid, e.account_id AS card_acc, e.transaction_id AS card_tid, e.snapshot AS card_snap FROM public.pluggy_import_entries e JOIN public.gastos g ON g.id=e.entry_id WHERE g.cartao_id=:'CARTAO' ORDER BY g.id LIMIT 1 \gset
INSERT INTO public.cartoes(id,user_id,nome) VALUES ('00000000-0000-0000-0000-00000000ca98', :'F', 'Outra opção do Felipe');
SELECT public.pluggy_link_card(:'F', :'CARD', '00000000-0000-0000-0000-00000000ca98');
SELECT public.pluggy_import_apply(:'F',gen_random_uuid(),jsonb_build_array(jsonb_build_object('op','update','table','gastos','account_id',:'card_acc','transaction_id',:'card_tid','entry_id',:'card_eid','next',:'card_snap'::jsonb))) AS changed_link \gset
SELECT pg_temp.ok((:'changed_link'::jsonb->>'conflitos')::int=1 AND (SELECT cartao_id=:'CARTAO' FROM public.gastos WHERE id=:'card_eid'), 'corrigir vínculo preserva cartão anterior e bloqueia update antigo');
SELECT public.pluggy_link_card(:'F', :'CARD', NULL);
SELECT public.pluggy_import_apply(:'F',gen_random_uuid(),jsonb_build_array(jsonb_build_object('op','remove','table','gastos','account_id',:'card_acc','transaction_id',:'card_tid','entry_id',:'card_eid'))) AS unlinked \gset
SELECT pg_temp.ok((:'unlinked'::jsonb->>'conflitos')::int=1 AND (SELECT deleted_at IS NULL FROM public.gastos WHERE id=:'card_eid'), 'desvínculo não remove compra anterior');
SELECT public.pluggy_link_card(:'F', :'CARD', :'CARTAO');
-- Repetições
SELECT public.pluggy_import_apply(:'F', :'B1', :'plan'::jsonb) AS r2 \gset
SELECT pg_temp.ok((:'r2'::jsonb->>'replay')::boolean AND (SELECT count(*) FROM public.gastos WHERE origem='pluggy') = 31, 'mesmo lote repetido (duplo clique) não grava');
SELECT public.pluggy_import_apply(:'F', gen_random_uuid(), :'plan'::jsonb) AS r3 \gset
SELECT pg_temp.ok((:'r3'::jsonb->>'duplicados')::int = 36 AND (SELECT count(*) FROM public.gastos WHERE origem='pluggy') = 31, 'reimportação em lote novo: 36 duplicados, nada novo');
-- Isolamento
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply(%L, gen_random_uuid(), %L)', :'M', :'plan')) LIKE '%transacao_inexistente%', 'Michael não importa transações do Felipe');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_revert(%L, %L)', :'M', :'B1')) LIKE '%lote_inexistente%', 'Michael não desfaz lote do Felipe');
RESET ROLE;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', :'M', false);
SELECT pg_temp.ok((SELECT count(*) FROM public.pluggy_import_entries) = 0 AND (SELECT count(*) FROM public.pluggy_card_links) = 0, 'Michael não lê vínculos/entradas do Felipe');
SELECT set_config('request.jwt.claim.sub', :'F', false);
SELECT pg_temp.ok((SELECT count(*) FROM public.pluggy_import_entries) = 36, 'Felipe lê as próprias entradas');
RESET ROLE;
-- Atualização vinda do banco
SET ROLE service_role;
SELECT e.entry_id AS eid, e.account_id AS acc, e.transaction_id AS tid, e.snapshot AS snap FROM public.pluggy_import_entries e JOIN public.gastos g ON g.id=e.entry_id WHERE g.descricao='SMART FIT ACADEMIA' ORDER BY g.data LIMIT 1 \gset
UPDATE public.pluggy_transactions SET amount = 99.9 WHERE account_id=:'acc' AND transaction_id=:'tid';
UPDATE public.pluggy_transactions SET status='PENDING' WHERE account_id=:'acc' AND transaction_id=:'tid';
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply(%L, gen_random_uuid(), %L)', :'F', jsonb_build_array(jsonb_build_object('op','update','table','gastos','account_id',:'acc','transaction_id',:'tid','entry_id',:'eid','next',(:'snap'::jsonb)||'{"valor":99.9}')))) LIKE '%nao_elegivel%', 'update pendente recusado');
UPDATE public.pluggy_transactions SET status='POSTED' WHERE account_id=:'acc' AND transaction_id=:'tid';
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_import_apply(%L, gen_random_uuid(), %L)', :'F', jsonb_build_array(jsonb_build_object('op','remove','table','gastos','account_id',:'acc','transaction_id',:'tid','entry_id',:'eid')))) LIKE '%remocao_nao_elegivel%', 'remoção sem alteração de origem recusada');
SELECT public.pluggy_import_apply(:'F', gen_random_uuid(), jsonb_build_array(jsonb_build_object('op','update','table','gastos','account_id',:'acc','transaction_id',:'tid','entry_id',:'eid','next', (:'snap'::jsonb) || '{"valor":99.9}'))) AS r4 \gset
SELECT pg_temp.ok((:'r4'::jsonb->>'atualizados')::int = 1 AND (SELECT valor FROM public.gastos WHERE id=:'eid') = 99.9, 'atualização do banco aplicada em lançamento não editado');
-- Edição manual bloqueia atualização e reversão
UPDATE public.gastos SET descricao = 'Academia (editado)' WHERE id=:'eid';
UPDATE public.pluggy_transactions SET amount = 109.9 WHERE account_id=:'acc' AND transaction_id=:'tid';
SELECT public.pluggy_import_apply(:'F', gen_random_uuid(), jsonb_build_array(jsonb_build_object('op','update','table','gastos','account_id',:'acc','transaction_id',:'tid','entry_id',:'eid','next', jsonb_build_object('valor',109.9,'data',(:'snap'::jsonb)->>'data','descricao','SMART FIT ACADEMIA')))) AS r5 \gset
SELECT pg_temp.ok((:'r5'::jsonb->>'conflitos')::int = 1 AND (SELECT descricao FROM public.gastos WHERE id=:'eid') = 'Academia (editado)', 'edição manual nunca é sobrescrita');
-- Revisão: idempotente, auditada, reversível
SELECT t.account_id AS racc, t.transaction_id AS rtid FROM public.pluggy_transactions t WHERE classification='revisao' \gset
SELECT public.pluggy_review_decide(:'F', :'racc', :'rtid', 'rejeitado');
SELECT public.pluggy_review_decide(:'F', :'racc', :'rtid', 'rejeitado');
SELECT public.pluggy_review_decide(:'F', :'racc', :'rtid', NULL);
SELECT pg_temp.ok((SELECT count(*) FROM public.pluggy_review_decisions) = 2 AND (SELECT review_status FROM public.pluggy_transactions WHERE transaction_id=:'rtid') IS NULL AND (SELECT count(*) FROM public.pluggy_transactions WHERE item_id='itemF') = 40, 'revisão idempotente, auditada, reversível e sem excluir');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.pluggy_review_decide(%L,%L,%L,''aprovado'')', :'M', :'racc', :'rtid')) LIKE '%transacao_inexistente%', 'Michael não decide revisão do Felipe');
-- Desfazer
-- An edit of notes alone must protect the row, not just amount/description edits.
SELECT e.entry_id AS note_id FROM public.pluggy_import_entries e JOIN public.gastos g ON g.id=e.entry_id WHERE e.batch_id=:'B1' AND g.id<>:'eid' ORDER BY g.id LIMIT 1 \gset
UPDATE public.gastos SET observacao='Nota manual preservada' WHERE id=:'note_id';
SELECT public.pluggy_import_revert(:'F', :'B1') AS rv \gset
SELECT pg_temp.ok((:'rv'::jsonb->>'revertidos')::int = 34 AND (:'rv'::jsonb->>'preservados')::int = 2, 'desfazer: 34 removidos de forma reversível, 2 editados preservados');
SELECT pg_temp.ok((SELECT deleted_at IS NULL AND observacao='Nota manual preservada' FROM public.gastos WHERE id=:'note_id'), 'edição apenas de observação também impede exclusão');
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE origem='pluggy' AND deleted_at IS NULL) = 2 AND (SELECT count(*) FROM public.gastos WHERE origem='pluggy') = 31, 'nenhuma exclusão física');
SELECT public.pluggy_import_revert(:'F', :'B1') AS rv2 \gset
SELECT pg_temp.ok((:'rv2'::jsonb->>'replay')::boolean, 'desfazer repetido é idempotente');
SELECT pg_temp.ok((SELECT status FROM public.extratos_importados WHERE id=:'B1') = 'revertido', 'lote marcado revertido (histórico mantido)');
RESET ROLE;
-- Proteção dos dados existentes
SELECT pg_temp.ok(md5(string_agg(t::text, ',' ORDER BY id)) = :'h_mp' AND count(*) = 751, '751 Mercado Pago intactas') FROM public.imported_transactions t;
SELECT pg_temp.ok(md5(string_agg(g::text, ',' ORDER BY id)) = :'h_g0', 'gastos de outras origens intactos (Felipe e Michael)') FROM public.gastos g WHERE origem IS DISTINCT FROM 'pluggy';
SELECT pg_temp.ok(md5(string_agg(r::text, ',' ORDER BY id)) = :'h_r0', 'receitas de outras origens intactas') FROM public.receitas r WHERE origem IS DISTINCT FROM 'pluggy';
