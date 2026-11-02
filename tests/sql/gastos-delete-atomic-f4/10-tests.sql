-- Testes F4 (dados fictícios). A=aaaa..1, B=bbbb..2.
\set ON_ERROR_STOP on
CREATE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF NOT coalesce(c,false) THEN RAISE EXCEPTION 'FALHOU: %', msg; END IF; RAISE NOTICE 'PASSOU: %', msg; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(boolean, text) TO authenticated;
INSERT INTO public.gastos (id, user_id, descricao, valor, data, import_batch_id) VALUES
 ('a1000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','pg conta 1',10,'2026-09-01',NULL),
 ('a1000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','pg conta 2',10,'2026-09-01',NULL),
 ('a2000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','ext ativo',5,'2026-09-02','e0000000-0000-0000-0000-000000000001'),
 ('a2000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','ext excluido',5,'2026-09-02','e0000000-0000-0000-0000-000000000001'),
 ('a3000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','ext2',5,'2026-09-02','e0000000-0000-0000-0000-000000000002'),
 ('b1000000-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','de B',99,'2026-09-01',NULL);
SET gi.gastos_soft_delete = 'on'; UPDATE public.gastos SET deleted_at = now(), deleted_by = user_id, deletion_batch_id = gen_random_uuid(), deletion_source = 'site' WHERE id = 'a2000000-0000-0000-0000-000000000002'; RESET gi.gastos_soft_delete;
INSERT INTO public.contas_a_pagar VALUES
 ('c0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','pago','2026-09-01','a1000000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','pago','2026-09-01',NULL);
INSERT INTO public.extratos_importados VALUES
 ('e0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','importado'),
 ('e0000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','importado');
INSERT INTO public.receitas (user_id, import_batch_id) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001'),
 ('aaaaaaaa-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002');

SET ROLE anon;
DO $$ BEGIN PERFORM public.reverter_extrato_atomic('e0000000-0000-0000-0000-000000000002');
  RAISE EXCEPTION 'FALHOU: anon executou'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: anon recusado'; END $$;
RESET ROLE;

SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002',false);
DO $$ BEGIN PERFORM public.estornar_conta_gastos_atomic('c0000000-0000-0000-0000-000000000001', ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[]);
  RAISE EXCEPTION 'FALHOU: B estornou conta de A'; EXCEPTION WHEN no_data_found THEN RAISE NOTICE 'PASSOU: B não estorna conta de A'; END $$;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
-- gasto de B na lista → tudo recusado
DO $$ BEGIN PERFORM public.estornar_conta_gastos_atomic('c0000000-0000-0000-0000-000000000001',
  ARRAY['a1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001']::uuid[]);
  RAISE EXCEPTION 'FALHOU'; EXCEPTION WHEN no_data_found THEN RAISE NOTICE 'PASSOU: gasto alheio recusa tudo'; END $$;
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE id='a1000000-0000-0000-0000-000000000001')=1, 'nada apagado após recusa');
-- mistura ativo + excluído → tudo-ou-nada
DO $$ BEGIN PERFORM public.estornar_conta_gastos_atomic('c0000000-0000-0000-0000-000000000001',
  ARRAY['a1000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000002']::uuid[]);
  RAISE EXCEPTION 'FALHOU'; EXCEPTION WHEN raise_exception THEN RAISE NOTICE 'PASSOU: mistura ativo/excluído bloqueada'; END $$;
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE id IN ('a1000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000002'))=2, 'mistura: nenhum apagado');
SELECT pg_temp.ok((SELECT status FROM public.contas_a_pagar WHERE id='c0000000-0000-0000-0000-000000000001')='pago', 'mistura: conta intacta');
-- estorno válido + replay idempotente
SELECT pg_temp.ok((public.estornar_conta_gastos_atomic('c0000000-0000-0000-0000-000000000001', ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[])->>'removidos')='1', 'estorno válido remove 1');
SELECT pg_temp.ok((SELECT status='pendente' AND gasto_id IS NULL FROM public.contas_a_pagar WHERE id='c0000000-0000-0000-0000-000000000001'), 'conta volta a pendente');
SELECT pg_temp.ok((public.estornar_conta_gastos_atomic('c0000000-0000-0000-0000-000000000001', ARRAY['a1000000-0000-0000-0000-000000000001']::uuid[])->>'idempotent')='true', 'replay idempotente');
-- extrato com gasto excluído → bloqueado, nada apagado (inclusive receitas)
DO $$ BEGIN PERFORM public.reverter_extrato_atomic('e0000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'FALHOU'; EXCEPTION WHEN raise_exception THEN RAISE NOTICE 'PASSOU: extrato com excluído bloqueado'; END $$;
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE import_batch_id='e0000000-0000-0000-0000-000000000001')=2
  AND (SELECT count(*) FROM public.receitas WHERE import_batch_id='e0000000-0000-0000-0000-000000000001')=1, 'extrato bloqueado: tudo preservado');
SELECT pg_temp.ok((public.reverter_extrato_atomic('e0000000-0000-0000-0000-000000000002')->>'removidos')='2', 'extrato limpo revertido (gasto+receita)');
SELECT pg_temp.ok((public.reverter_extrato_atomic('e0000000-0000-0000-0000-000000000002')->>'idempotent')='true', 'extrato replay idempotente');
RESET ROLE;
