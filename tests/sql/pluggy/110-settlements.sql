\set F '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'
CREATE FUNCTION pg_temp.ok(c boolean,n text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %',n; END IF; END $$;
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
SELECT pg_temp.ok(NOT has_function_privilege('authenticated','pluggy_settlement_apply(uuid,text,text,text,uuid,timestamptz,boolean,jsonb)','EXECUTE'),'settlement denied to browser');
SELECT pg_temp.ok(NOT has_table_privilege('service_role','pluggy_settlement_release','UPDATE'),'service cannot release settlement');
INSERT INTO contas_a_receber(id,user_id,titulo,valor_total,valor_restante,data_prevista) VALUES('00000000-0000-0000-0000-00000000ee01',:'F','Fictitious advance',17,17,current_date);
INSERT INTO pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,description,amount,date,status,type,classification,classification_reason,is_sandbox,operation_type)
SELECT :'F','iReal','aReal',id,id,'Fictitious test',amount,current_date,'POSTED',nature,'revisao',reason,false,op FROM (VALUES('advance',17,'DEBIT','adiantamento_a_receber','PIX'),('return-one',5,'CREDIT','adiantamento_a_receber','PIX'),('return-two',12,'CREDIT','adiantamento_a_receber','PIX'),('refund-one',4,'CREDIT','estorno','ESTORNO')) v(id,amount,nature,reason,op);
SELECT pg_temp.ok(pg_temp.err($q$SELECT pluggy_settlement_apply('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','aReal','advance','advance_link','00000000-0000-0000-0000-00000000ee01',null,true,(SELECT jsonb_build_object('transaction',updated_at) FROM pluggy_transactions WHERE transaction_id='advance'))$q$)='pluggy_conciliacao_bloqueada','settlement default off');
UPDATE pluggy_settlement_release SET enabled=true;
SELECT pluggy_settlement_apply(:'F','aReal','advance','advance_link',id,updated_at,true,(SELECT jsonb_build_object('transaction',updated_at) FROM pluggy_transactions WHERE transaction_id='advance')) FROM contas_a_receber WHERE id='00000000-0000-0000-0000-00000000ee01';
SELECT pluggy_settlement_apply(:'F','aReal','return-one','receivable_return',id,updated_at,true,(SELECT jsonb_build_object('transaction',updated_at) FROM pluggy_transactions WHERE transaction_id='return-one')) FROM contas_a_receber WHERE id='00000000-0000-0000-0000-00000000ee01';
SELECT pg_temp.ok(valor_restante=12 AND status='parcial','partial principal return') FROM contas_a_receber WHERE id='00000000-0000-0000-0000-00000000ee01';
SELECT pluggy_settlement_apply(:'F','aReal','return-two','receivable_return',id,updated_at,true,(SELECT jsonb_build_object('transaction',updated_at) FROM pluggy_transactions WHERE transaction_id='return-two')) FROM contas_a_receber WHERE id='00000000-0000-0000-0000-00000000ee01';
SELECT pg_temp.ok(valor_restante=0 AND status='recebido','full principal return') FROM contas_a_receber WHERE id='00000000-0000-0000-0000-00000000ee01';
SELECT pluggy_settlement_apply(:'F','aReal','return-two','receivable_return',id,updated_at,true,(SELECT jsonb_build_object('transaction',updated_at) FROM pluggy_transactions WHERE transaction_id='return-two')) FROM contas_a_receber WHERE id='00000000-0000-0000-0000-00000000ee01';
SELECT pg_temp.ok(count(*)=2,'return replay audited once') FROM pluggy_settlements WHERE kind='receivable_return';
SELECT pg_temp.ok(count(*)=0,'principal is never new income') FROM receitas WHERE id_operacao_banco IN('pluggy:aReal:return-one','pluggy:aReal:return-two');
SELECT pg_temp.ok(pluggy_settlement_undo(:'F',id)='revertido','undo latest return') FROM pluggy_settlements WHERE source_id='return-two';
SELECT pg_temp.ok(valor_restante=12,'return undo restores balance') FROM contas_a_receber WHERE id='00000000-0000-0000-0000-00000000ee01';
SELECT pg_temp.ok(pluggy_settlement_undo(:'F',id)='revertido','undo earlier return after latest') FROM pluggy_settlements WHERE source_id='return-one';
SELECT pg_temp.ok(valor_restante=17 AND valor_recebido=0,'sequential undo restores full principal') FROM contas_a_receber WHERE id='00000000-0000-0000-0000-00000000ee01';
INSERT INTO gastos(id,user_id,descricao,valor,data,mes,ano,origem,forma_pagamento) VALUES('00000000-0000-0000-0000-00000000ee02',:'F','Fictitious purchase',10,current_date,extract(month FROM current_date),extract(year FROM current_date),'manual','debito');
SELECT pg_temp.ok(pg_temp.err($q$SELECT pluggy_settlement_apply('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','aReal','refund-one','refund','00000000-0000-0000-0000-00000000ee02',(SELECT updated_at FROM gastos WHERE id='00000000-0000-0000-0000-00000000ee02'),true,'{}')$q$)='pluggy_origem_alterada','stale origin approval rejected');
SELECT pluggy_settlement_apply(:'F','aReal','refund-one','refund',id,updated_at,true,(SELECT jsonb_build_object('transaction',updated_at) FROM pluggy_transactions WHERE transaction_id='refund-one')) FROM gastos WHERE id='00000000-0000-0000-0000-00000000ee02';
SELECT pg_temp.ok(valor=6,'refund reduces original expense') FROM gastos WHERE id='00000000-0000-0000-0000-00000000ee02';
UPDATE gastos SET descricao='Manual edit' WHERE id='00000000-0000-0000-0000-00000000ee02';
SELECT pg_temp.ok(pluggy_settlement_undo(:'F',id)='preservado','refund undo keeps manual edits') FROM pluggy_settlements WHERE source_id='refund-one';
SELECT pluggy_link_real_card(:'F','real-card','00000000-0000-0000-0000-00000000da01');
INSERT INTO gastos(user_id,descricao,valor,data,mes,ano,origem,cartao_id,fatura_competencia,forma_pagamento) VALUES(:'F','Invoice test',10,'2026-07-20',7,2026,'manual','00000000-0000-0000-0000-00000000da01','2026-08','credito');
INSERT INTO pluggy_bill_snapshots(user_id,account_id,bill_id,due_date,total,currency,payments,charges) VALUES
(:'F','real-card','previous-test','2026-08-05',10,'BRL','[]','[]'),
(:'F','real-card','next-test','2026-09-05',30,'BRL','[{"id":"p1","amount":10,"currencyCode":"BRL","paymentDate":"2026-08-05"}]','[]');
SELECT pluggy_settlement_apply(:'F','real-card','previous-test','bill_payment','00000000-0000-0000-0000-00000000da01',null,true,(SELECT jsonb_build_object('previous',p.updated_at,'next',n.updated_at) FROM pluggy_bill_snapshots p,pluggy_bill_snapshots n WHERE p.bill_id='previous-test' AND n.bill_id='next-test'));
SELECT pg_temp.ok(status='paga' AND valor_pago=10,'bank next-cycle payment settles matching local invoice') FROM faturas_cartao WHERE cartao_id='00000000-0000-0000-0000-00000000da01' AND mes=8;
SELECT pg_temp.ok(pluggy_settlement_undo(:'F',id)='revertido','invoice settlement reversible') FROM pluggy_settlements WHERE source_id='previous-test';
SELECT pg_temp.ok(status='aberta' AND valor_pago=0,'invoice returned to open without deleting history') FROM faturas_cartao WHERE cartao_id='00000000-0000-0000-0000-00000000da01' AND mes=8;
SELECT pg_temp.ok(pg_temp.err('SELECT pluggy_assert_financial_release()')='pluggy_gravacao_financeira_bloqueada','global lock retained after all settlements');

-- Two partial refunds can be undone in reverse order without weakening manual edit protection.
INSERT INTO gastos(id,user_id,descricao,valor,data,mes,ano,origem,forma_pagamento) VALUES('00000000-0000-0000-0000-00000000ee03',:'F','Refund sequence',10,current_date,extract(month FROM current_date),extract(year FROM current_date),'manual','debito');
INSERT INTO pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,description,amount,date,status,type,classification,classification_reason,is_sandbox,operation_type)
SELECT :'F','iReal','aReal',id,id,'Test refund',amount,current_date,'POSTED','CREDIT','revisao','estorno',false,'ESTORNO' FROM (VALUES('refund-seq-a',4),('refund-seq-b',6),('race-refund',2)) v(id,amount);
SELECT pluggy_settlement_apply(:'F','aReal','refund-seq-a','refund',id,updated_at,true,(SELECT jsonb_build_object('transaction',updated_at) FROM pluggy_transactions WHERE transaction_id='refund-seq-a')) FROM gastos WHERE id='00000000-0000-0000-0000-00000000ee03';
SELECT pluggy_settlement_apply(:'F','aReal','refund-seq-b','refund',id,updated_at,true,(SELECT jsonb_build_object('transaction',updated_at) FROM pluggy_transactions WHERE transaction_id='refund-seq-b')) FROM gastos WHERE id='00000000-0000-0000-0000-00000000ee03';
SELECT pg_temp.ok(deleted_at IS NOT NULL,'full refund retains original tombstone') FROM gastos WHERE id='00000000-0000-0000-0000-00000000ee03';
SELECT pg_temp.ok(pluggy_settlement_undo(:'F',id)='revertido','undo full refund') FROM pluggy_settlements WHERE source_id='refund-seq-b';
SELECT pg_temp.ok(pluggy_settlement_undo(:'F',id)='revertido','undo preceding partial refund') FROM pluggy_settlements WHERE source_id='refund-seq-a';
SELECT pg_temp.ok(valor=10 AND deleted_at IS NULL,'refund sequence restores original') FROM gastos WHERE id='00000000-0000-0000-0000-00000000ee03';
