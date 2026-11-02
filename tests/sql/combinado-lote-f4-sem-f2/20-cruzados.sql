-- Interação lote mensal x F4 x exclusão individual SEM F2 (banco descartável).
\set ON_ERROR_STOP 1
CREATE FUNCTION pg_temp.ok(c boolean, n text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF c IS TRUE THEN RAISE NOTICE 'PASSOU: %', n; ELSE RAISE EXCEPTION 'FALHOU: %', n; END IF; END $$;
TRUNCATE public.gastos, public.receitas, public.extratos_importados, public.contas_a_pagar;
-- U: extrato X com 2 gastos simples de 08/2027; Y sem exclusões.
INSERT INTO public.extratos_importados VALUES ('e0000000-0000-0000-0000-00000000000a','11111111-0000-0000-0000-000000000001','importado'),('e0000000-0000-0000-0000-00000000000b','11111111-0000-0000-0000-000000000001','importado');
INSERT INTO public.gastos(id,user_id,valor,data,forma_pagamento,import_batch_id) VALUES
 ('e1000000-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001',10,'2027-08-02','pix','e0000000-0000-0000-0000-00000000000a'),
 ('e1000000-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000001',20,'2027-08-03','pix','e0000000-0000-0000-0000-00000000000a'),
 ('e1000000-0000-0000-0000-000000000003','11111111-0000-0000-0000-000000000001',30,'2027-08-04','pix',NULL),
 ('e1000000-0000-0000-0000-000000000004','11111111-0000-0000-0000-000000000001',40,'2027-07-04','pix','e0000000-0000-0000-0000-00000000000b');

-- 1) Exclusão individual (UPDATE deleted_at pelo servidor) continua funcionando sem F2.
SET ROLE service_role;
UPDATE public.gastos SET deleted_at = now() WHERE id='e1000000-0000-0000-0000-000000000003' AND user_id='11111111-0000-0000-0000-000000000001' AND deleted_at IS NULL;
UPDATE public.gastos SET deleted_at = NULL WHERE id='e1000000-0000-0000-0000-000000000003';
RESET ROLE;
SELECT pg_temp.ok((SELECT deleted_at IS NULL FROM public.gastos WHERE id='e1000000-0000-0000-0000-000000000003'), 'individual excluir/restaurar sem F2');

-- 2) Lote do mês 08/2027 (inclui itens do extrato X — importação NÃO é elegível pelo lote).
SET ROLE service_role;
SELECT pg_temp.ok((public.wa_lote_mes_excluir('11111111-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000001','gastos',2027,8,
   ARRAY['e1000000-0000-0000-0000-000000000001']::uuid[], ARRAY[(SELECT updated_at FROM public.gastos WHERE id='e1000000-0000-0000-0000-000000000001')])->>'status')='changed',
   'lote recusa conjunto com item de importação (changed)');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE deleted_at IS NOT NULL)=0, 'nenhum deleted_at após recusa');

-- 3) Lote só com o simples (id 3) funciona com F4 instalada.
SET ROLE service_role;
SELECT public.wa_lote_mes_excluir('11111111-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000002','gastos',2027,8,
   ARRAY['e1000000-0000-0000-0000-000000000003']::uuid[], ARRAY[(SELECT updated_at FROM public.gastos WHERE id='e1000000-0000-0000-0000-000000000003')]) AS r \gset
RESET ROLE;
SELECT pg_temp.ok((SELECT deleted_at IS NOT NULL FROM public.gastos WHERE id='e1000000-0000-0000-0000-000000000003'), 'lote exclui simples sem F2');

-- 4) F4 sem F2: extrato Y revertido apaga só o lote Y.
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','11111111-0000-0000-0000-000000000001',false);
SELECT public.reverter_extrato_atomic('e0000000-0000-0000-0000-00000000000b') AS rv \gset
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE import_batch_id='e0000000-0000-0000-0000-00000000000b')=0
  AND (SELECT count(*) FROM public.gastos)=3, 'F4 reverte só o próprio extrato');

-- 5) F4: extrato X com gasto excluído individualmente -> bloqueia tudo.
SET ROLE service_role; UPDATE public.gastos SET deleted_at=now() WHERE id='e1000000-0000-0000-0000-000000000001'; RESET ROLE;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','11111111-0000-0000-0000-000000000001',false);
DO $$ BEGIN PERFORM public.reverter_extrato_atomic('e0000000-0000-0000-0000-00000000000a'); RAISE EXCEPTION 'FALHOU: F4 apagou lote com excluído';
EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF; RAISE NOTICE 'PASSOU: F4 bloqueia lote com gasto soft-excluído (%)', SQLERRM; END $$;
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE import_batch_id='e0000000-0000-0000-0000-00000000000a')=2, 'nada apagado no bloqueio');

-- 6) Outro usuário não reverte extrato alheio.
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','22222222-0000-0000-0000-000000000002',false);
DO $$ BEGIN PERFORM public.reverter_extrato_atomic('e0000000-0000-0000-0000-00000000000a'); RAISE EXCEPTION 'FALHOU: outro usuário';
EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF; RAISE NOTICE 'PASSOU: extrato alheio recusado (%)', SQLERRM; END $$;
-- 7) authenticated não executa as RPCs de lote.
DO $$ BEGIN PERFORM public.wa_lote_mes_restaurar('11111111-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000002',1); RAISE EXCEPTION 'FALHOU: authenticated restaurou';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: authenticated sem EXECUTE no restaurar'; END $$;
RESET ROLE;
-- 8) Restauração do lote volta somente o item 3; o item 1 (excluído individualmente) continua excluído.
SET ROLE service_role;
SELECT public.wa_lote_mes_restaurar('11111111-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000002',1) AS rs \gset
RESET ROLE;
SELECT pg_temp.ok((SELECT deleted_at IS NULL FROM public.gastos WHERE id='e1000000-0000-0000-0000-000000000003')
  AND (SELECT deleted_at IS NOT NULL FROM public.gastos WHERE id='e1000000-0000-0000-0000-000000000001'), 'restauração do lote não revive exclusão individual');
