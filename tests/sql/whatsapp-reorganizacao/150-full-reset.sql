-- "Zerar tudo" com cartão, faturas, parcelas (inclusive futuras), recorrências,
-- importações e contas vinculadas; restauração tudo-ou-nada por lote.
UPDATE public.whatsapp_reorganization_policy SET release_enabled=true;
INSERT INTO public.whatsapp_reorganization_allowlist(user_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;

-- Base limpa para o titular A (lançamentos ativos de testes anteriores ficam arquivados como estão).
SELECT set_config('gi.reorganization_mutation','on',false);
INSERT INTO cartoes(id,user_id,dia_fechamento,dia_vencimento,limite_total) VALUES ('fc000000-0000-0000-0000-0000000000c1','aaaaaaaa-0000-0000-0000-000000000001',5,12,5000) ON CONFLICT DO NOTHING;
INSERT INTO gastos(id,user_id,descricao,valor,data,forma_pagamento) VALUES
 ('f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Livre',10,'2030-01-05','pix');
INSERT INTO gastos(id,user_id,descricao,valor,data,forma_pagamento,cartao_id,fatura_competencia) VALUES
 ('f0000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Cartão',200,'2030-01-06','credito','fc000000-0000-0000-0000-0000000000c1','2030-01');
INSERT INTO gastos(id,user_id,descricao,valor,data,forma_pagamento,grupo_parcelamento_id,total_parcelas) VALUES
 ('f0000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','Parcela 1/3',100,'2030-01-07','pix','f9000000-0000-0000-0000-000000000001',3),
 ('f0000000-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','Parcela 2/3',100,'2099-02-07','pix','f9000000-0000-0000-0000-000000000001',3),
 ('f0000000-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','Parcela 3/3',100,'2099-03-07','pix','f9000000-0000-0000-0000-000000000001',3);
INSERT INTO gastos(id,user_id,descricao,valor,data,forma_pagamento,recorrencia_id) VALUES
 ('f0000000-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000001','Assinatura',40,'2030-01-08','pix','f8000000-0000-0000-0000-000000000001');
INSERT INTO gastos(id,user_id,descricao,valor,data,forma_pagamento,import_batch_id,origem,id_operacao_banco) VALUES
 ('f0000000-0000-0000-0000-000000000007','aaaaaaaa-0000-0000-0000-000000000001','Importado',55,'2030-01-09','pix','f7000000-0000-0000-0000-000000000001','extrato','OP-1');
INSERT INTO gastos(id,user_id,descricao,valor,data,forma_pagamento) VALUES
 ('f0000000-0000-0000-0000-000000000008','aaaaaaaa-0000-0000-0000-000000000001','Boleto pago',30,'2030-01-10','pix'),
 ('f0000000-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-000000000001','Prestação do carro',900,'2030-01-11','pix'),
 ('f0000000-0000-0000-0000-000000000010','cccccccc-0000-0000-0000-000000000003','Outro usuário',777,'2030-01-05','pix');
INSERT INTO receitas(id,user_id,descricao,valor,data) VALUES ('f1000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Salário',3000,'2030-01-05');
INSERT INTO receitas(id,user_id,descricao,valor,data,recorrencia_id) VALUES ('f1000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Aluguel recebido',800,'2030-01-06','f8000000-0000-0000-0000-000000000002');
INSERT INTO receitas(id,user_id,descricao,valor,data,import_batch_id,id_operacao_banco) VALUES ('f1000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','Pix recebido',120,'2030-01-07','f7000000-0000-0000-0000-000000000001','OP-2');
INSERT INTO faturas_cartao(id,user_id,valor_pago,cartao_id,mes,ano,status) VALUES ('f2000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',200,'fc000000-0000-0000-0000-0000000000c1',1,2030,'paga');
INSERT INTO contas_a_pagar(id,user_id,gasto_id,valor,status,recorrente) VALUES
 ('f3000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000008',30,'pago',false),
 ('f3000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',NULL,90,'pendente',true);
INSERT INTO contas_a_receber(id,user_id,titulo,valor_total,status) VALUES ('f4000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Cliente X',500,'pendente');
INSERT INTO transferencias_internas(id,user_id,descricao,valor,data,id_operacao_banco) VALUES ('f5000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Nubank→Itaú',300,'2030-01-05','OP-3');
INSERT INTO recorrencias(id,user_id,nome,valor,status,proxima_cobranca) VALUES
 ('f8000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Assinatura',40,'ativa','2030-02-08'),
 ('f8000000-0000-0000-0000-000000000003','cccccccc-0000-0000-0000-000000000003','De outro',10,'ativa','2030-02-08');
INSERT INTO bens_pagamentos(id,gasto_id) VALUES ('f6000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000009');
SELECT set_config('gi.reorganization_mutation','off',false);

CREATE TEMP TABLE full_before AS SELECT
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM gastos t WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001') g,
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM receitas t WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001') r,
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM faturas_cartao t) f,
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM contas_a_pagar t) cp,
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM contas_a_receber t) cr,
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM transferencias_internas t) ti,
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM recorrencias t) rc,
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM cartoes t) ca,
 (SELECT md5(coalesce(string_agg(t::text,'|' ORDER BY t.id),'')) FROM bancos t) ba,
 (SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM gastos t WHERE user_id<>'aaaaaaaa-0000-0000-0000-000000000001') outros;

-- Bloco 0: trava por conta e acesso direto.
SELECT public.assert_true(public.wa_full_reset_prepare('cccccccc-0000-0000-0000-000000000003','5511999999999','x-1','111111')->>'status'='blocked','full: non-listed user blocked');
SELECT public.assert_true(NOT has_function_privilege('authenticated','public.wa_full_reset_confirm(uuid,text,text,uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.wa_full_reset_prepare(uuid,text,text,text)','EXECUTE'),'full: RPCs not callable by app users');
SELECT public.assert_true((SELECT count(*)=5 FROM pg_policies WHERE policyname='reorg_hide_archived' AND permissive='RESTRICTIVE'),'full: restrictive hide policy on 5 linked tables');

-- Prévia: tudo do titular, com bem/financiamento fora e listado.
SELECT public.wa_full_reset_prepare('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','full-1','515151') AS p \gset
SELECT public.assert_true((:'p'::jsonb)->>'status'='preview','full: preview');
SELECT public.assert_true(((:'p'::jsonb)->>'card')::int>=1 AND ((:'p'::jsonb)->>'installments')::int>=3 AND ((:'p'::jsonb)->>'futureInstallments')::int>=2,'full: card and all installments incl. future counted');
SELECT public.assert_true(((:'p'::jsonb)->>'recurringEntries')::int>=2 AND ((:'p'::jsonb)->>'imported')::int>=2,'full: recurring and imported counted');
SELECT public.assert_true(((:'p'::jsonb)->>'invoices')::int>=1 AND ((:'p'::jsonb)->>'payables')::int=2 AND ((:'p'::jsonb)->>'receivables')::int=1 AND ((:'p'::jsonb)->>'transfers')::int=1 AND ((:'p'::jsonb)->>'recurrenceRules')::int=1,'full: invoice, payables, receivable, transfer, rule counted');
SELECT public.assert_true((:'p'::jsonb)->'leftOut' @> '[{"motivo":"bem"}]' AND (:'p'::jsonb)->>'complete'='false','full: bem-linked left out, not reported complete');
SELECT public.assert_true((SELECT g FROM full_before)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM gastos t WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001'),'full: preview writes nothing');

-- Confirmação: código errado não aplica; falha no meio desfaz tudo.
SELECT public.assert_true(public.wa_full_reset_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','000000',((:'p'::jsonb)->>'operationId')::uuid)->>'status'='wrong_code','full: wrong code rejected');
CREATE FUNCTION pg_temp.boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_setting('gi.test_boom',true)='on' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END $$;
CREATE TRIGGER boom BEFORE UPDATE ON public.recorrencias FOR EACH ROW EXECUTE FUNCTION pg_temp.boom();
SELECT set_config('gi.test_boom','on',false);
DO $$ BEGIN
 BEGIN PERFORM public.wa_full_reset_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','515151',(SELECT id FROM whatsapp_reorganization_full_operations WHERE request_id='full-1'));
  RAISE EXCEPTION 'should fail';
 EXCEPTION WHEN others THEN IF SQLERRM<>'boom' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS: full: mid-operation failure raises';
END $$;
SELECT set_config('gi.test_boom','off',false);
DROP TRIGGER boom ON public.recorrencias;
SELECT public.assert_true((SELECT g FROM full_before)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM gastos t WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001')
 AND (SELECT f FROM full_before)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM faturas_cartao t)
 AND (SELECT count(*)=0 FROM whatsapp_reorganization_full_journal),'full: failure rolled back everything');
SELECT public.assert_true((SELECT status='preview' FROM whatsapp_reorganization_full_operations WHERE request_id='full-1'),'full: failure leaves confirmation unconsumed');

SELECT public.wa_full_reset_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','515151',((:'p'::jsonb)->>'operationId')::uuid) AS a \gset
SELECT public.assert_true((:'a'::jsonb)->>'status'='applied' AND (:'a'::jsonb)->>'complete'='false','full: applied, reported partial because of bem');
SELECT public.assert_true((SELECT count(*)=0 FROM gastos g WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001' AND deleted_at IS NULL AND NOT public.wa_full_reset_bem_linked(jsonb_build_object('table','gastos','row',to_jsonb(g)))),'full: only bem-linked expenses remain active');
SELECT public.assert_true((SELECT deleted_at IS NULL FROM gastos WHERE id='f0000000-0000-0000-0000-000000000009'),'full: bem-linked expense intact');
SELECT public.assert_true((SELECT count(*)=0 FROM gastos WHERE grupo_parcelamento_id='f9000000-0000-0000-0000-000000000001' AND deleted_at IS NULL),'full: all installments incl. future removed together');
SELECT public.assert_true((SELECT count(*)=0 FROM receitas WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001' AND deleted_at IS NULL),'full: all incomes removed');
SELECT public.assert_true((SELECT reorg_archived_at IS NOT NULL FROM faturas_cartao WHERE id='f2000000-0000-0000-0000-000000000001')
 AND (SELECT bool_and(reorg_archived_at IS NOT NULL) FROM contas_a_pagar WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001')
 AND (SELECT reorg_archived_at IS NOT NULL FROM contas_a_receber WHERE id='f4000000-0000-0000-0000-000000000001')
 AND (SELECT reorg_archived_at IS NOT NULL FROM transferencias_internas WHERE id='f5000000-0000-0000-0000-000000000001'),'full: invoice, payables, receivable, transfer archived');
SELECT public.assert_true((SELECT status='pausada' AND reorg_archived_at IS NOT NULL FROM recorrencias WHERE id='f8000000-0000-0000-0000-000000000001'),'full: recurrence rule paused (no regeneration)');
SELECT public.assert_true((SELECT status='ativa' FROM recorrencias WHERE id='f8000000-0000-0000-0000-000000000003'),'full: other user rule untouched');
SELECT public.assert_true((SELECT ca FROM full_before)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM cartoes t)
 AND (SELECT ba FROM full_before)=(SELECT md5(coalesce(string_agg(t::text,'|' ORDER BY t.id),'')) FROM bancos t)
 AND (SELECT outros FROM full_before)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM gastos t WHERE user_id<>'aaaaaaaa-0000-0000-0000-000000000001'),'full: cards, banks and other users untouched');
SELECT public.assert_true((SELECT count(*) FILTER (WHERE operation_key NOT LIKE 'sig:%')=3 FROM financial_import_tombstones WHERE batch_id=((:'a'::jsonb)->>'operationId')::uuid),'full: import keys tombstoned');
SELECT public.assert_true(public.wa_full_reset_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','515151',((:'a'::jsonb)->>'operationId')::uuid)->>'status'='replay','full: duplicate confirmation is replay');
SELECT public.assert_true((SELECT count(*)=1 FROM audit_logs WHERE action='whatsapp_full_reset' AND entity_id=(:'a'::jsonb)->>'operationId'),'full: audited once');

DO $$ BEGIN
 BEGIN
  PERFORM set_config('gi.reorganization_mutation','on',true);
  INSERT INTO gastos(id,user_id,descricao,valor,data,forma_pagamento,id_operacao_banco) VALUES (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001','Reimport',55,'2030-01-09','pix',' op-1 ');
  RAISE EXCEPTION 'should fail';
 EXCEPTION WHEN others THEN IF SQLERRM<>'reimport_blocked_reorganized_entry' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS: full: reimport of zeroed entry refused';
END $$;
SELECT set_config('gi.reorganization_mutation','on',false);
INSERT INTO receitas(id,user_id,descricao,valor,data,import_batch_id) VALUES ('f1000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','Sem id banco',75,'2030-01-08','f7000000-0000-0000-0000-000000000009');
SELECT set_config('gi.reorganization_mutation','off',false);
DO $$ BEGIN
 BEGIN DELETE FROM gastos WHERE id='f0000000-0000-0000-0000-000000000007'; RAISE EXCEPTION 'should fail';
 EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'financial_%' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS: full: physical delete of zeroed entry refused (e.g. import revert)';
END $$;
DO $$ BEGIN
 BEGIN UPDATE whatsapp_reorganization_full_journal SET before_row='{}' WHERE table_name='gastos'; RAISE EXCEPTION 'should fail';
 EXCEPTION WHEN others THEN IF SQLERRM<>'full_journal_immutable' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS: full: journal immutable';
END $$;

-- Restauração por voz: último lote, prévia + código; alteração posterior bloqueia tudo.
SELECT public.assert_true(public.wa_full_reset_last_applied('aaaaaaaa-0000-0000-0000-000000000001','5511999999999')=((:'a'::jsonb)->>'operationId')::uuid,'full: last applied resolves batch');
SELECT public.assert_true(public.wa_full_reset_restore_prepare('aaaaaaaa-0000-0000-0000-000000000001','5511999999999',((:'a'::jsonb)->>'operationId')::uuid,'626262')->>'status'='restore_preview','full: restore preview');
SELECT public.assert_true(public.wa_full_reset_restore_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999',((:'a'::jsonb)->>'operationId')::uuid,'000000')->>'status'='wrong_code','full: restore wrong code');
SELECT set_config('gi.reorganization_mutation','on',false);
UPDATE contas_a_receber SET titulo='editado' WHERE id='f4000000-0000-0000-0000-000000000001';
SELECT set_config('gi.reorganization_mutation','off',false);
SELECT public.assert_true(public.wa_full_reset_restore_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999',((:'a'::jsonb)->>'operationId')::uuid,'626262')->>'status'='changed','full: later edit blocks restore');
SELECT public.assert_true((SELECT count(*)=0 FROM receitas WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001' AND deleted_at IS NULL),'full: blocked restore changed nothing');
SELECT set_config('gi.reorganization_mutation','on',false);
UPDATE contas_a_receber SET titulo='Cliente X', updated_at=(SELECT (after_row->>'updated_at')::timestamptz FROM whatsapp_reorganization_full_journal WHERE row_id='f4000000-0000-0000-0000-000000000001') WHERE id='f4000000-0000-0000-0000-000000000001';
SELECT set_config('gi.reorganization_mutation','off',false);
SELECT public.assert_true(public.wa_full_reset_restore_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999',((:'a'::jsonb)->>'operationId')::uuid,'626262')->>'status'='restored','full: restored');
SELECT public.assert_true((SELECT g FROM full_before)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM gastos t WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001')
 AND (SELECT r FROM full_before)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM receitas t WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001'),'full: expenses and incomes byte-identical after restore');
SELECT public.assert_true((SELECT f FROM full_before)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM faturas_cartao t)
 AND (SELECT cp FROM full_before)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM contas_a_pagar t)
 AND (SELECT cr FROM full_before)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM contas_a_receber t)
 AND (SELECT ti FROM full_before)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM transferencias_internas t)
 AND (SELECT rc FROM full_before)=(SELECT md5(string_agg(t::text,'|' ORDER BY t.id)) FROM recorrencias t),'full: invoices, bills, transfers and rules (links, status) byte-identical after restore');
SELECT public.assert_true((SELECT count(*)=0 FROM financial_import_tombstones WHERE batch_id=((:'a'::jsonb)->>'operationId')::uuid),'full: tombstones released');
SELECT public.assert_true(public.wa_full_reset_restore_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999',((:'a'::jsonb)->>'operationId')::uuid,'626262')->>'status'='replay','full: second restore is replay, no duplication');
SELECT public.assert_true((SELECT count(*)=9 FROM gastos WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001' AND id::text LIKE 'f0%' AND deleted_at IS NULL),'full: no duplicated rows');

-- Sem vínculo com bem: limpeza realmente total.
SELECT set_config('gi.reorganization_mutation','on',false);
DELETE FROM bens_pagamentos;
SELECT set_config('gi.gastos_soft_delete','on',false);
UPDATE gastos g SET deleted_at=now(),deleted_by='aaaaaaaa-0000-0000-0000-000000000001',deletion_batch_id=gen_random_uuid(),deletion_source='site' WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001' AND deleted_at IS NULL AND (id='f0000000-0000-0000-0000-000000000009' OR bem_id IS NOT NULL);
SELECT set_config('gi.gastos_soft_delete','off',false);
SELECT set_config('gi.reorganization_mutation','off',false);
SELECT public.wa_full_reset_prepare('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','full-2','737373') AS p2 \gset
SELECT public.assert_true((:'p2'::jsonb)->>'complete'='true' AND jsonb_array_length((:'p2'::jsonb)->'leftOut')=0,'full: without bem link preview is complete');
SELECT public.assert_true(public.wa_full_reset_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','111222',NULL)->>'status'='not_found','full: voice code without matching preview falls through');
SELECT public.assert_true(public.wa_full_reset_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','737373',NULL)->>'complete'='true','full: complete reset applied by voice code (no id)');
SELECT public.assert_true((SELECT count(*)=0 FROM gastos WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001' AND deleted_at IS NULL)
 AND (SELECT count(*)=0 FROM receitas WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001' AND deleted_at IS NULL),'full: nothing active left');
SELECT public.wa_full_reset_restore_prepare('aaaaaaaa-0000-0000-0000-000000000001','5511999999999',((:'p2'::jsonb)->>'operationId')::uuid,'848484');
SELECT public.assert_true(public.wa_full_reset_restore_confirm('aaaaaaaa-0000-0000-0000-000000000001','5511999999999',NULL,'848484')->>'status'='restored','full: complete reset restored by voice code (no id)');

DELETE FROM public.whatsapp_reorganization_allowlist;
UPDATE public.whatsapp_reorganization_policy SET release_enabled=false;
SELECT public.assert_true(public.wa_full_reset_prepare('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','full-3','959595')->>'status'='blocked','full: locked again after test');
