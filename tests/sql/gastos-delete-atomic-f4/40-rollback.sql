\set ON_ERROR_STOP on
CREATE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF NOT coalesce(c,false) THEN RAISE EXCEPTION 'FALHOU: %', msg; END IF; RAISE NOTICE 'PASSOU: %', msg; END $$;
-- Rollback do banco (só se necessário): remover a função não toca dados.
DROP FUNCTION public.reverter_extrato_atomic(uuid);
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'reverter_extrato_atomic'), 'rollback DROP FUNCTION ok');
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND origem IN ('manual','cartao')) = 3, 'rollback: dados preservados');
