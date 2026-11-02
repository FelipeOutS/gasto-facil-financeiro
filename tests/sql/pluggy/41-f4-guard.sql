CREATE FUNCTION pg_temp.f4err(q text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
CREATE FUNCTION pg_temp.ok(c boolean,n text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF c THEN RAISE NOTICE 'PASSOU: %',n; ELSE RAISE EXCEPTION 'FALHOU: %',n; END IF; END $$;
SELECT md5(string_agg(to_jsonb(g)::text,'' ORDER BY id)) AS hg FROM public.gastos g \gset
SELECT md5(string_agg(to_jsonb(r)::text,'' ORDER BY id)) AS hr FROM public.receitas r \gset
SET ROLE service_role;
SELECT set_config('request.jwt.claim.sub','3324b9f8-ea68-465c-8e1e-ab1cc8caebf1',false);
SELECT pg_temp.ok(pg_temp.f4err('SELECT public.reverter_extrato_atomic(''00000000-0000-0000-0000-0000000000f1'')')='pluggy_reversao_generica_bloqueada','F4 direct call rejects persisted Pluggy batch before replay');
-- Simulated stale/forged batch type: persisted row origin remains authoritative.
BEGIN;
UPDATE public.extratos_importados SET tipo_origem='pdf' WHERE id='00000000-0000-0000-0000-0000000000f1';
SELECT pg_temp.ok(pg_temp.f4err('SELECT public.reverter_extrato_atomic(''00000000-0000-0000-0000-0000000000f1'')')='pluggy_reversao_generica_bloqueada','F4 forged batch type cannot erase Pluggy rows');
ROLLBACK;
RESET ROLE;
SELECT pg_temp.ok(md5(string_agg(to_jsonb(g)::text,'' ORDER BY id))=:'hg','F4 expense data unchanged') FROM public.gastos g;
SELECT pg_temp.ok(md5(string_agg(to_jsonb(r)::text,'' ORDER BY id))=:'hr','F4 income data unchanged') FROM public.receitas r;