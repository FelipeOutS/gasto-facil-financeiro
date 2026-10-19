-- Exact deployment candidate, still blocked; invoke directly as service_role.
\set F '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'
CREATE FUNCTION pg_temp.blocked(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN SQLERRM='pluggy_gravacao_financeira_bloqueada'; END $$;
CREATE FUNCTION pg_temp.ok(c boolean,n text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF c THEN RAISE NOTICE 'PASSOU: %',n; ELSE RAISE EXCEPTION 'FALHOU: %',n; END IF; END $$;
SELECT md5(string_agg(to_jsonb(g)::text,'' ORDER BY id)) AS hg FROM public.gastos g \gset
SELECT md5(string_agg(to_jsonb(r)::text,'' ORDER BY id)) AS hr FROM public.receitas r \gset
SET ROLE service_role;
SELECT pg_temp.ok(pg_temp.blocked(format('SELECT public.pluggy_import_apply(%L,gen_random_uuid(),''[]'')',:'F')), 'candidate: direct service apply blocked before even creating a batch');
SELECT pg_temp.ok(pg_temp.blocked(format('SELECT public.pluggy_import_revert(%L,gen_random_uuid())',:'F')), 'candidate: direct service revert blocked');
SELECT pg_temp.ok(pg_temp.blocked(format('SELECT public.pluggy_import_apply(%L,gen_random_uuid(),''[{"op":"update"}]'')',:'F')), 'candidate: direct service update blocked');
SELECT pg_temp.ok(pg_temp.blocked(format('SELECT public.pluggy_import_apply(%L,gen_random_uuid(),''[{"op":"remove"}]'')',:'F')), 'candidate: direct service soft delete blocked');
SELECT pg_temp.ok(NOT has_schema_privilege('service_role','public','CREATE'),'service role cannot create a substitute release helper');
SELECT set_config('pluggy.financial_release','true',false);
SELECT pg_temp.ok(pg_temp.blocked(format('SELECT public.pluggy_import_apply(%L,gen_random_uuid(),''[]'')',:'F')), 'candidate: forged session setting cannot release writes');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated','public.pluggy_assert_financial_release()','EXECUTE') AND NOT has_function_privilege('sandbox_exec','public.pluggy_assert_financial_release()','EXECUTE'), 'release helper ACL closed');
RESET ROLE;
SELECT pg_temp.ok(md5(string_agg(to_jsonb(g)::text,'' ORDER BY id))=:'hg','blocked candidate preserves expenses byte-for-byte') FROM public.gastos g;
SELECT pg_temp.ok(md5(string_agg(to_jsonb(r)::text,'' ORDER BY id))=:'hr','blocked candidate preserves income byte-for-byte') FROM public.receitas r;
SELECT pg_temp.ok((SELECT count(*) FROM public.extratos_importados)=0 AND (SELECT count(*) FROM public.pluggy_import_entries)=0,'no financial batch or entries after rejected calls');