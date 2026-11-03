INSERT INTO bancos VALUES('cccccccc-0000-0000-0000-000000000005','cccccccc-0000-0000-0000-000000000001','Conta teste');
INSERT INTO receitas(user_id,descricao,valor,data,financial_bank_id,cash_effective_at) VALUES('cccccccc-0000-0000-0000-000000000001','Recebida',100,'2026-11-03','cccccccc-0000-0000-0000-000000000005','2026-11-03T12:00:00Z');
SELECT public.assert_true((SELECT sum(amount_cents)=10000 FROM financial_cash_facts WHERE banco_id='cccccccc-0000-0000-0000-000000000005'),'assigned received income credits exact bank');
UPDATE receitas SET deleted_at=now() WHERE descricao='Recebida';
SELECT public.assert_true((SELECT sum(amount_cents)=10000 FROM financial_cash_facts WHERE banco_id='cccccccc-0000-0000-0000-000000000005'),'hiding income never erases real cash receipt');
-- Restore fixture as table owner/trusted mutation, not as ordinary client.
SELECT set_config('gi.reorganization_mutation','on',false);
UPDATE receitas SET deleted_at=null WHERE descricao='Recebida';
SELECT set_config('gi.reorganization_mutation','off',false);
SELECT public.assert_true((SELECT count(*)=1 FROM financial_cash_facts WHERE banco_id='cccccccc-0000-0000-0000-000000000005'),'restoring income never duplicates cash');
INSERT INTO gastos(user_id,descricao,valor,data,forma_pagamento,financial_bank_id,cash_effective_at) VALUES('cccccccc-0000-0000-0000-000000000001','Despesa paga',35,'2026-11-03','pix','cccccccc-0000-0000-0000-000000000005','2026-11-03T13:00:00Z');
SELECT public.assert_true((SELECT sum(amount_cents)=6500 FROM financial_cash_facts WHERE banco_id='cccccccc-0000-0000-0000-000000000005'),'paid expense debits 35 not invoice charge');
DO $$ BEGIN INSERT INTO gastos(user_id,descricao,valor,data,forma_pagamento,financial_bank_id,cash_effective_at) VALUES('cccccccc-0000-0000-0000-000000000001','Compra crédito',35,'2026-11-03','credito','cccccccc-0000-0000-0000-000000000005',now()); RAISE EXCEPTION 'expected_failure'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'credit_purchase_not_bank_payment' THEN RAISE; END IF; END $$;
SELECT public.assert_true(NOT EXISTS(SELECT 1 FROM gastos WHERE descricao='Compra crédito'),'credit charge cannot debit cash as payment');