-- Uso normal depois de "zerar tudo" + restauração que preserva lançamentos posteriores.
\set U '''aaaaaaaa-0000-0000-0000-000000000001'''
UPDATE public.whatsapp_reorganization_policy SET release_enabled=true;
INSERT INTO public.whatsapp_reorganization_allowlist(user_id) VALUES (:U) ON CONFLICT DO NOTHING;
SELECT set_config('gi.reorganization_mutation','on',false);
UPDATE recorrencias SET detection_key='det-assinatura' WHERE id='f8000000-0000-0000-0000-000000000001';
SELECT set_config('gi.reorganization_mutation','off',false);
CREATE TEMP TABLE pre_reset AS SELECT
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM gastos t WHERE user_id=:U) g,
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM receitas t WHERE user_id=:U) r,
 (SELECT count(*) FROM gastos WHERE user_id=:U AND deleted_at IS NULL) ng,
 (SELECT count(*) FROM receitas WHERE user_id=:U AND deleted_at IS NULL) nr;
SELECT public.wa_full_reset_prepare(:U,'5511999999999','post-1','414141') AS pp \gset
SELECT public.wa_full_reset_confirm(:U,'5511999999999','414141',NULL) AS pa \gset
SELECT public.assert_true((:'pa'::jsonb)->>'status'='applied','post: reset applied');
SELECT public.assert_true((SELECT count(*)=0 FROM gastos WHERE user_id=:U AND deleted_at IS NULL),'post: history zeroed');
SELECT public.assert_true(public.financial_current_generation(:U)>0,'post: generation advanced');

-- Novos lançamentos depois da limpeza: sem erro e sem marca de exclusão/arquivo.
INSERT INTO gastos(id,user_id,descricao,valor,data,forma_pagamento) VALUES
 ('e0000000-0000-0000-0000-000000000001',:U,'Mercado novo',87.5,'2030-02-01','pix'),
 ('e0000000-0000-0000-0000-000000000002',:U,'Livre',10,'2030-01-05','pix'),
 ('e0000000-0000-0000-0000-000000000003',:U,'Apagar depois',5,'2030-02-02','pix');
INSERT INTO receitas(id,user_id,descricao,valor,data) VALUES ('e1000000-0000-0000-0000-000000000001',:U,'Salário novo',4000,'2030-02-05');
INSERT INTO cartoes(id,user_id,dia_fechamento,dia_vencimento,limite_total) VALUES ('ec000000-0000-0000-0000-0000000000c2',:U,10,17,3000);
INSERT INTO faturas_cartao(id,user_id,cartao_id,mes,ano,status,valor_pago) VALUES ('e2000000-0000-0000-0000-000000000001',:U,'fc000000-0000-0000-0000-0000000000c1',1,2030,'paga',50);
INSERT INTO contas_a_pagar(id,user_id,valor,status,recorrente) VALUES ('e3000000-0000-0000-0000-000000000001',:U,120,'pendente',false);
INSERT INTO contas_a_receber(id,user_id,titulo,valor_total,status) VALUES ('e4000000-0000-0000-0000-000000000001',:U,'Cliente novo',250,'pendente');
INSERT INTO transferencias_internas(id,user_id,descricao,valor,data) VALUES ('e5000000-0000-0000-0000-000000000001',:U,'Itaú→Nubank',100,'2030-02-03');
INSERT INTO recorrencias(id,user_id,nome,valor,status,proxima_cobranca,detection_key) VALUES ('e8000000-0000-0000-0000-000000000001',:U,'Assinatura',45,'ativa','2030-03-08','det-assinatura');
UPDATE gastos SET valor=90 WHERE id='e0000000-0000-0000-0000-000000000001';
UPDATE contas_a_pagar SET status='pago' WHERE id='e3000000-0000-0000-0000-000000000001';
DELETE FROM gastos WHERE id='e0000000-0000-0000-0000-000000000003';
SELECT public.assert_true((SELECT offline_generation=public.financial_current_generation(:U) AND deleted_at IS NULL FROM gastos WHERE id='e0000000-0000-0000-0000-000000000001'),'post: online expense stamped with current generation');
SELECT public.assert_true((SELECT count(*)=0 FROM faturas_cartao WHERE id::text LIKE 'e%' AND reorg_archived_at IS NOT NULL)
 AND NOT public.financial_row_in_applied_reset('gastos','e0000000-0000-0000-0000-000000000001'),'post: new rows not confused with hidden ones');
DO $$ BEGIN RAISE NOTICE 'PASS: post: new expense, income, card, invoice (same month), bill, receivable, transfer and recurrence accepted'; END $$;

-- Ocultados continuam protegidos; fila offline antiga continua recusada.
DO $$ DECLARE g bigint:=public.financial_current_generation('aaaaaaaa-0000-0000-0000-000000000001'); BEGIN
 BEGIN UPDATE faturas_cartao SET status='aberta' WHERE id='f2000000-0000-0000-0000-000000000001'; RAISE EXCEPTION 'should fail';
 EXCEPTION WHEN others THEN IF SQLERRM<>'archived_by_reset_immutable' THEN RAISE; END IF; END;
 BEGIN DELETE FROM contas_a_pagar WHERE id='f3000000-0000-0000-0000-000000000002'; RAISE EXCEPTION 'should fail';
 EXCEPTION WHEN others THEN IF SQLERRM<>'archived_by_reset_immutable' THEN RAISE; END IF; END;
 BEGIN UPDATE contas_a_pagar SET reorg_archived_at=now() WHERE id='e3000000-0000-0000-0000-000000000001'; RAISE EXCEPTION 'should fail';
 EXCEPTION WHEN others THEN IF SQLERRM<>'archived_by_reset_immutable' THEN RAISE; END IF; END;
 BEGIN UPDATE gastos SET valor=1 WHERE id='f0000000-0000-0000-0000-000000000001'; RAISE EXCEPTION 'should fail';
 EXCEPTION WHEN others THEN IF SQLERRM NOT IN ('financial_tombstone_immutable','gastos_soft_deleted_immutable') AND SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF; END;
 BEGIN INSERT INTO gastos(id,user_id,descricao,valor,data,forma_pagamento,offline_client_id,offline_generation) VALUES (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001','Fila antiga',9,'2030-01-02','pix','old-queue-1',g-1); RAISE EXCEPTION 'should fail';
 EXCEPTION WHEN others THEN IF SQLERRM<>'financial_generation_stale_review_required' THEN RAISE; END IF; END;
 INSERT INTO gastos(id,user_id,descricao,valor,data,forma_pagamento,offline_client_id,offline_generation) VALUES ('e0000000-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','Fila nova',9,'2030-02-02','pix','new-queue-1',g);
 UPDATE gastos SET descricao='Fila nova editada' WHERE id='e0000000-0000-0000-0000-000000000004';
 RAISE NOTICE 'PASS: post: hidden/archived rows immutable, stale offline queue refused, current queue and its later edit accepted';
END $$;

CREATE TEMP TABLE post_new AS SELECT
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM gastos t WHERE id::text LIKE 'e0%') g,
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM receitas t WHERE id::text LIKE 'e1%') r,
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM faturas_cartao t WHERE id::text LIKE 'e2%') f,
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM contas_a_pagar t WHERE id::text LIKE 'e3%') cp,
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM recorrencias t WHERE id::text LIKE 'e8%') rc;

-- Restauração da limpeza anterior.
SELECT public.wa_full_reset_restore_prepare(:U,'5511999999999',((:'pa'::jsonb)->>'operationId')::uuid,'525252');
SELECT public.wa_full_reset_restore_confirm(:U,'5511999999999',NULL,'525252') AS pr \gset
SELECT public.assert_true((:'pr'::jsonb)->>'status'='restored','post: restore succeeds with later movements present');
SELECT public.assert_true(((:'pr'::jsonb)->>'supersededByNewer')::int=2,'post: newer invoice/recurrence prevail and are reported');
SELECT public.assert_true(((:'pr'::jsonb)->>'possibleDuplicates')::int=1,'post: re-typed entry flagged as possible duplicate, not merged');
SELECT public.assert_true((SELECT g FROM post_new)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM gastos t WHERE id::text LIKE 'e0%')
 AND (SELECT r FROM post_new)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM receitas t WHERE id::text LIKE 'e1%')
 AND (SELECT f FROM post_new)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM faturas_cartao t WHERE id::text LIKE 'e2%')
 AND (SELECT cp FROM post_new)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM contas_a_pagar t WHERE id::text LIKE 'e3%')
 AND (SELECT rc FROM post_new)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM recorrencias t WHERE id::text LIKE 'e8%'),'post: later movements untouched by restore');
SELECT public.assert_true((SELECT count(*) FROM gastos WHERE user_id=:U AND deleted_at IS NULL)=(SELECT ng FROM pre_reset)+3
 AND (SELECT count(*) FROM receitas WHERE user_id=:U AND deleted_at IS NULL)=(SELECT nr FROM pre_reset)+1,'post: old entries back plus new ones, nothing lost or duplicated');
SELECT public.assert_true((SELECT count(*)=1 FROM faturas_cartao WHERE user_id=:U AND cartao_id='fc000000-0000-0000-0000-0000000000c1' AND mes=1 AND ano=2030 AND reorg_archived_at IS NULL),'post: one active invoice per card/month');
SELECT public.assert_true((SELECT count(*)=1 FROM recorrencias WHERE user_id=:U AND detection_key='det-assinatura' AND reorg_archived_at IS NULL),'post: one active recurrence per detection key');
INSERT INTO gastos(id,user_id,descricao,valor,data,forma_pagamento) VALUES ('e0000000-0000-0000-0000-000000000005',:U,'Depois da restauração',12,'2030-02-09','pix');
DELETE FROM gastos WHERE id='e0000000-0000-0000-0000-000000000005';
DO $$ BEGIN RAISE NOTICE 'PASS: post: normal use continues after restore'; END $$;

DELETE FROM public.whatsapp_reorganization_allowlist;
UPDATE public.whatsapp_reorganization_policy SET release_enabled=false;
