SET ROLE service_role;
DO $$ BEGIN UPDATE cartoes SET limite_total=0; RAISE EXCEPTION 'expected_failure'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'linked_writer_requires_transaction_context' THEN RAISE; END IF; END $$;
DO $$ BEGIN INSERT INTO financial_cash_facts(user_id,banco_id,kind,amount_cents,request_id) VALUES('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000005','adjustment',999999,'malicious'); RAISE EXCEPTION 'expected_failure'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'financial_fact_requires_authorized_routine' THEN RAISE; END IF; END $$;
RESET ROLE;
SELECT public.assert_true((SELECT limite_total=1000 FROM cartoes WHERE id='99999999-0000-0000-0000-000000000005'),'linked writer cannot change card after reset');
SELECT public.assert_true(NOT EXISTS(SELECT 1 FROM financial_cash_facts WHERE request_id='malicious'),'service role cannot forge reconciliation fact');
DO $$ BEGIN DELETE FROM faturas_cartao; RAISE EXCEPTION 'expected_failure'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invoice_history_delete_forbidden' THEN RAISE; END IF; END $$;
SELECT public.assert_true((SELECT count(*)=1 FROM faturas_cartao WHERE id='99999999-0000-0000-0000-000000000006'),'invoice history physically preserved');