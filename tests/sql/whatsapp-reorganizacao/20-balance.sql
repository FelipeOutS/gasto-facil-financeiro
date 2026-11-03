CREATE TABLE public.bancos(id uuid PRIMARY KEY,user_id uuid NOT NULL);
\ir ../../../docs/migrations-candidate/account-opening-balances.sql
INSERT INTO bancos VALUES('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001');
SELECT public.assert_true(public.account_opening_balance_candidate('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',500000,'2026-11-03','balance-one')->>'status'='created','5000 baseline stored separately');
SELECT public.assert_true((SELECT amount_cents=500000 FROM account_opening_balances),'exact 5000 baseline cents');
SELECT public.assert_true(public.account_opening_balance_candidate('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',500000,'2026-11-03','balance-one')->>'status'='replay','baseline webhook replay idempotent');
SELECT public.assert_true(public.account_opening_balance_candidate('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',500001,'2026-11-03','balance-two')->>'status'='changed','baseline cannot silently be recalculated');
SELECT public.assert_true(public.account_opening_balance_candidate('cccccccc-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000001',500000,'2026-11-03','foreign')->>'status'='blocked','foreign bank baseline blocked');
SELECT public.assert_true(NOT has_function_privilege('service_role','public.account_opening_balance_candidate(uuid,uuid,bigint,date,text)','EXECUTE'),'baseline helper unreleased even for service role');
SELECT public.assert_true(NOT EXISTS(SELECT 1 FROM receitas WHERE valor=5000),'baseline never creates 5000 income');
