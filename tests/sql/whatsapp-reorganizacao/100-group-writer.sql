-- Fictitious isolated fixtures; no credentials or production calls.
CREATE FUNCTION public.can_create_in_account(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT $1=auth.uid() $$;
CREATE FUNCTION public.has_active_plan_access(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT $1='aaaaaaaa-0000-0000-0000-000000000001'::uuid $$;
CREATE OR REPLACE FUNCTION public.has_feature_access(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='aaaaaaaa-0000-0000-0000-000000000001'::uuid $$;
CREATE TABLE public.categorias(id uuid PRIMARY KEY,user_id uuid NOT NULL);
GRANT SELECT ON public.categorias TO authenticated;
GRANT ALL ON public.categorias TO service_role;
ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_test_category ON public.categorias FOR SELECT TO authenticated USING(user_id=auth.uid());
INSERT INTO public.financial_group_policy VALUES(true,false);
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
DO $$ BEGIN PERFORM public.financial_group_write('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',2,'csv','[]'); RAISE EXCEPTION 'expected_failure'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'financial_group_release_blocked' THEN RAISE; END IF; END $$;
SELECT public.assert_true(NOT EXISTS(SELECT 1 FROM financial_group_operations),'group release default blocked');
UPDATE public.financial_group_policy SET enabled=true;
-- Fixture generation is read explicitly; never production reset or activation.
CREATE TEMP TABLE group_fixture AS SELECT public.financial_current_generation('aaaaaaaa-0000-0000-0000-000000000001') generation;
SELECT public.financial_group_write('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',(SELECT generation FROM group_fixture),'installments',
'[{"table":"gastos","row":{"id":"eeeeeeee-0000-0000-0000-000000000010","user_id":"aaaaaaaa-0000-0000-0000-000000000001","descricao":"Parcela 1","valor":35,"data":"2026-12-01","total_parcelas":2,"grupo_parcelamento_id":"eeeeeeee-0000-0000-0000-000000000090"}},{"table":"gastos","row":{"id":"eeeeeeee-0000-0000-0000-000000000011","user_id":"aaaaaaaa-0000-0000-0000-000000000001","descricao":"Parcela 2","valor":35,"data":"2027-01-01","total_parcelas":2,"grupo_parcelamento_id":"eeeeeeee-0000-0000-0000-000000000090"}}]');
SELECT public.assert_true((SELECT count(*)=2 FROM gastos WHERE grupo_parcelamento_id='eeeeeeee-0000-0000-0000-000000000090'),'installments atomic group retains links');
SELECT public.assert_true((SELECT count(*)=1 FROM financial_group_operations),'durable single operation');
SELECT public.assert_true((SELECT public.financial_group_write(user_id,id,generation,kind,payload)->>'status'='replay' FROM financial_group_operations),'identical group replay once');
DO $$ BEGIN PERFORM public.financial_group_write('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',(SELECT generation FROM group_fixture),'csv','[{"table":"gastos","row":{}}]'); RAISE EXCEPTION 'expected_failure'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'financial_group_payload_conflict' THEN RAISE; END IF; END $$;
SELECT public.assert_true((SELECT count(*)=1 FROM financial_group_operations),'conflicting operation payload rejected');
DO $$ BEGIN PERFORM public.financial_group_write('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000002',(SELECT generation FROM group_fixture),'recurrence',
'[{"table":"receitas","row":{"id":"eeeeeeee-0000-0000-0000-000000000020","user_id":"aaaaaaaa-0000-0000-0000-000000000001","descricao":"Primeira válida","valor":50,"data":"2026-12-01","recorrencia_id":"eeeeeeee-0000-0000-0000-000000000091"}},{"table":"receitas","row":{"id":"eeeeeeee-0000-0000-0000-000000000021","user_id":"aaaaaaaa-0000-0000-0000-000000000001","descricao":"Falha segunda","valor":-5,"data":"2027-01-01"}}]'); RAISE EXCEPTION 'expected_failure'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_financial_group_row' THEN RAISE; END IF; END $$;
SELECT public.assert_true(NOT EXISTS(SELECT 1 FROM receitas WHERE id='eeeeeeee-0000-0000-0000-000000000020'),'failure second occurrence rolls back first and journal');
DO $$ BEGIN PERFORM public.financial_group_write('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000003',(SELECT generation FROM group_fixture)+1,'image','[{"table":"gastos","row":{}}]'); RAISE EXCEPTION 'expected_failure'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'financial_generation_stale_review_required' THEN RAISE; END IF; END $$;
SELECT public.assert_true((SELECT count(*)=1 FROM financial_group_operations),'stale review no partial operation');
SELECT set_config('request.jwt.claim.sub','cccccccc-0000-0000-0000-000000000003',false);
DO $$ BEGIN PERFORM public.financial_group_write('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000004',0,'pdf','[]'); RAISE EXCEPTION 'expected_failure'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'financial_group_unauthorized' THEN RAISE; END IF; END $$;
SELECT public.assert_true((SELECT count(*)=1 FROM financial_group_operations),'other owner cannot mutate authorized group');
SELECT set_config('request.jwt.claim.sub','',false);
DO $$ BEGIN PERFORM public.financial_group_write('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000004',0,'pdf','[]'); RAISE EXCEPTION 'expected_failure'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'financial_group_unauthorized' THEN RAISE; END IF; END $$;
SELECT public.assert_true((SELECT count(*)=1 FROM financial_group_operations),'no caller JWT is denied even privileged call');
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
SET ROLE authenticated;
SELECT public.financial_group_write(user_id,id,generation,kind,payload) FROM public.financial_group_operations;
RESET ROLE;
SELECT public.assert_true((SELECT count(*)=1 FROM financial_group_operations),'authenticated own replay respects RLS and safe RPC');
SET ROLE service_role;
DO $$ BEGIN PERFORM public.financial_group_write('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',8,'csv','[]'); RAISE EXCEPTION 'expected_failure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
SELECT public.assert_true((SELECT count(*)=1 FROM financial_group_operations),'service role denied candidate ordinary writer');