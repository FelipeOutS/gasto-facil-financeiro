-- Migração candidata amount_original aplicada sobre a Revisão 4 com dados já existentes.
\set F '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'
\set M '47df50ce-df1e-4c54-8fae-0ffb5105478d'
CREATE FUNCTION pg_temp.ok(c boolean, n text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF c THEN RAISE NOTICE 'PASSOU: %', n; ELSE RAISE EXCEPTION 'FALHOU: %', n; END IF; END $$;
RESET ROLE;
INSERT INTO public.pluggy_items(user_id,item_id,is_sandbox) VALUES (:'F','iAmt',true);
INSERT INTO public.pluggy_accounts(user_id,item_id,account_id,type,is_sandbox) VALUES (:'F','iAmt','accAmt','CREDIT',true);
-- registro "antigo" com correções manuais do usuário
INSERT INTO public.pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,amount,date,status,type,classification,classification_reason,categoria_manual,review_status,is_sandbox)
 VALUES (:'F','iAmt','accAmt','old1','kold1',55.90,'2026-09-01','POSTED','CREDIT','revisao','credito_em_cartao','Lazer','aprovado',true);
SELECT count(*) AS n_before, md5(string_agg(t::text, ',' ORDER BY id)) AS h_before FROM public.pluggy_transactions t \gset
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pluggy_transactions' AND column_name='amount_original'), 'coluna não existe antes');
\i docs/migrations-candidate/pluggy-amount-original.sql
SELECT pg_temp.ok(count(*) = :n_before, 'nenhuma linha apagada/recriada') FROM public.pluggy_transactions;
SELECT pg_temp.ok(bool_and(amount_original IS NULL), 'registros antigos ficam NULL (sinal desconhecido)') FROM public.pluggy_transactions;
SELECT pg_temp.ok(md5(string_agg((t.id,t.user_id,t.item_id,t.account_id,t.transaction_id,t.dedupe_key,t.description,t.amount,t.currency,t.date,t.status,t.type,t.pluggy_category,t.operation_type,t.installment_number,t.total_installments,t.classification,t.classification_reason,t.categoria_sugerida,t.categoria_manual,t.review_status,t.mp_match_ids,t.is_sandbox,t.imported_gasto_id,t.imported_receita_id,t.deleted_at,t.created_at,t.updated_at)::text, ',' ORDER BY id)) = :'h_before', 'colunas existentes idênticas byte a byte') FROM public.pluggy_transactions t;
-- ressincronização: upsert com amount_original preserva correções manuais
SET ROLE service_role;
INSERT INTO public.pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,amount,amount_original,date,status,type,classification,classification_reason,is_sandbox)
 VALUES (:'F','iAmt','accAmt','old1','kold1',55.90,-55.9,'2026-09-01','POSTED','CREDIT','gasto','compra_cartao_valor_negativo',true)
 ON CONFLICT (user_id,account_id,transaction_id) DO UPDATE SET amount_original=EXCLUDED.amount_original, classification=EXCLUDED.classification, classification_reason=EXCLUDED.classification_reason;
SELECT pg_temp.ok(amount_original = -55.9 AND categoria_manual='Lazer' AND review_status='aprovado' AND classification='gasto', 'ressincronização preenche sinal e mantém correção manual') FROM public.pluggy_transactions WHERE transaction_id='old1';
UPDATE public.pluggy_transactions SET amount_original = -0.123456789 WHERE transaction_id='old1';
SELECT pg_temp.ok(amount_original::text = '-0.123456789', 'precisão da API preservada sem arredondar') FROM public.pluggy_transactions WHERE transaction_id='old1';
RESET ROLE;
-- RLS e permissões
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', :'F', false);
SELECT pg_temp.ok(count(amount_original) >= 1, 'Felipe lê o novo campo das próprias linhas') FROM public.pluggy_transactions;
SELECT set_config('request.jwt.claim.sub', :'M', false);
SELECT pg_temp.ok(count(*) FILTER (WHERE user_id = :'F') = 0, 'Michael não vê linhas do Felipe') FROM public.pluggy_transactions;
DO $$ BEGIN UPDATE public.pluggy_transactions SET amount_original = 1; RAISE EXCEPTION 'FALHOU: authenticated atualizou';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: authenticated não grava amount_original'; END $$;
RESET ROLE;
SELECT pg_temp.ok(NOT has_column_privilege('anon','public.pluggy_transactions','amount_original','SELECT'), 'anon sem acesso ao novo campo');
SELECT pg_temp.ok(NOT has_column_privilege('sandbox_exec','public.pluggy_transactions','amount_original','SELECT')
              AND NOT has_column_privilege('sandbox_exec','public.pluggy_transactions','amount_original','INSERT'), 'sandbox_exec sem acesso ao novo campo');
SELECT pg_temp.ok(NOT has_column_privilege('authenticated','public.pluggy_transactions','amount_original','UPDATE'), 'authenticated sem UPDATE no novo campo');
