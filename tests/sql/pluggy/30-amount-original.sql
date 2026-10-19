-- Migração candidata amount_original aplicada sobre a Revisão 4 com dados já existentes.
\set F '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'
\set M '7f1c0d1e-0000-4000-8000-0000000000aa'
CREATE FUNCTION pg_temp.ok(c boolean, n text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF c THEN RAISE NOTICE 'PASSOU: %', n; ELSE RAISE EXCEPTION 'FALHOU: %', n; END IF; END $$;
RESET ROLE;
SELECT count(*) AS n_before, md5(string_agg(t::text, ',' ORDER BY id)) AS h_before FROM public.pluggy_transactions t \gset
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pluggy_transactions' AND column_name='amount_original'), 'coluna ainda não existe antes');
