-- Testes da F2 (dados fictícios). Cada bloco falha com RAISE se a regra quebrar.
\set ON_ERROR_STOP on
-- A = titular, B = outro usuário, C = acesso compartilhado à conta de A.
INSERT INTO public.gastos (id, user_id, descricao, valor, data, origem, grupo_parcelamento_id) VALUES
 ('10000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Mercado',100.10,'2026-09-01',NULL,NULL),
 ('10000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Uber',20.05,'2026-09-30','whatsapp',NULL),
 ('10000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','Extrato',5.00,'2026-09-15','extrato_pdf',NULL),
 ('10000000-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','Outubro',9.99,'2026-10-01',NULL,NULL),
 ('10000000-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','Agosto',7.00,'2026-08-31',NULL,NULL),
 ('20000000-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','De B',999,'2026-09-10',NULL,NULL),
 -- parcelado 3x: set, out, nov (grupo G)
 ('30000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','TV 1/3',100,'2026-09-05',NULL,'99999999-0000-0000-0000-000000000009'),
 ('30000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','TV 2/3',100,'2026-10-05',NULL,'99999999-0000-0000-0000-000000000009'),
 ('30000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','TV 3/3',100,'2026-11-05',NULL,'99999999-0000-0000-0000-000000000009');
INSERT INTO public.faturas_cartao VALUES ('40000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',300);

CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb);
GRANT ALL ON r TO authenticated;
CREATE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF NOT coalesce(c,false) THEN RAISE EXCEPTION 'FALHOU: %', msg; END IF; RAISE NOTICE 'PASSOU: %', msg; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(boolean, text) TO authenticated;

-- T1 não autenticado
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','',false);
DO $$ BEGIN PERFORM public.gastos_preview_exclusao_periodo('2026-09-01','2026-10-01');
  RAISE EXCEPTION 'FALHOU: T1 sem login aceitou'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: T1 sem login recusado'; END $$;
RESET ROLE;

-- T2 anon não executa
SET ROLE anon;
DO $$ BEGIN PERFORM public.gastos_preview_exclusao_periodo('2026-09-01','2026-10-01');
  RAISE EXCEPTION 'FALHOU: T2 anon executou'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: T2 anon sem permissão'; END $$;
RESET ROLE;

-- T3 internas não expostas
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002',false);
DO $$ BEGIN PERFORM * FROM public._gastos_periodo_selecao('aaaaaaaa-0000-0000-0000-000000000001','2026-09-01','2026-10-01',false);
  RAISE EXCEPTION 'FALHOU: T3 interna exposta'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: T3 seleção interna inacessível'; END $$;

-- T4 prévia de A: parcela cortada bloqueia; fronteiras [01/09, 01/10)
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
INSERT INTO r SELECT 'p', public.gastos_preview_exclusao_periodo('2026-09-01','2026-10-01',false);
SELECT pg_temp.ok((SELECT (v->>'bloqueado')::boolean AND (v->>'grupos_cortados')::int = 1 FROM r WHERE k='p'), 'T4 série cortada bloqueia');
SELECT pg_temp.ok((SELECT (v->>'count')::int = 4 AND (v->>'sum')::numeric = 225.15 FROM r WHERE k='p'), 'T5 contagem/soma exatas com centavos e bordas do mês (exclui 31/08 e 01/10, sem gasto de B)');
SELECT pg_temp.ok((SELECT v->'origens' = '{"manual":2,"whatsapp":1,"extrato_pdf":1}'::jsonb FROM r WHERE k='p'), 'T6 origens informadas');

-- T7 soft-delete bloqueado por parcelas sem série completa
INSERT INTO r SELECT 'd0', public.gastos_soft_delete_periodo('2026-09-01','2026-10-01',false,4,225.15,(SELECT v->>'snapshot' FROM r WHERE k='p'),'50000000-0000-0000-0000-000000000000');
SELECT pg_temp.ok((SELECT v->>'status'='bloqueado_parcelas' FROM r WHERE k='d0'), 'T7 execução bloqueada sem série completa');

-- T8 série completa: nova prévia inclui 2/3 e 3/3
INSERT INTO r SELECT 's', public.gastos_preview_exclusao_periodo('2026-09-01','2026-10-01',true);
SELECT pg_temp.ok((SELECT (v->>'count')::int = 6 AND (v->>'itens_fora_do_periodo')::int = 2 AND NOT (v->>'bloqueado')::boolean FROM r WHERE k='s'), 'T8 série completa explícita');

-- T9 snapshot forjado
INSERT INTO r SELECT 'f', public.gastos_soft_delete_periodo('2026-09-01','2026-10-01',true,6,425.15,'forjado','50000000-0000-0000-0000-000000000001');
SELECT pg_temp.ok((SELECT v->>'status'='divergente' FROM r WHERE k='f'), 'T9 snapshot forjado recusado');

-- T10 dado muda entre prévia e execução
RESET ROLE; UPDATE public.gastos SET valor = 101 WHERE id='10000000-0000-0000-0000-000000000001'; SET ROLE authenticated;
INSERT INTO r SELECT 'm', public.gastos_soft_delete_periodo('2026-09-01','2026-10-01',true,6,425.15,(SELECT v->>'snapshot' FROM r WHERE k='s'),'50000000-0000-0000-0000-000000000002');
SELECT pg_temp.ok((SELECT v->>'status'='divergente' FROM r WHERE k='m'), 'T10 alteração após prévia aborta');
RESET ROLE; UPDATE public.gastos SET valor = 100.10 WHERE id='10000000-0000-0000-0000-000000000001'; SET ROLE authenticated;

-- T11 B não exclui gastos de A (só os próprios); C compartilhado também não
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002',false);
SELECT pg_temp.ok((public.gastos_preview_exclusao_periodo('2026-09-01','2026-10-01')->>'count')::int = 1, 'T11 B só vê o próprio gasto');
SELECT set_config('request.jwt.claim.sub','cccccccc-0000-0000-0000-000000000003',false);
SELECT pg_temp.ok((public.gastos_preview_exclusao_periodo('2026-09-01','2026-10-01')->>'count')::int = 0, 'T12 compartilhado não exclui dados do titular');

-- T13 compartilhado/cliente não grava deleted_* por UPDATE comum
DO $$ BEGIN UPDATE public.gastos SET deleted_at = now(), deleted_by = auth.uid(), deletion_batch_id = gen_random_uuid(), deletion_source='site'
  WHERE id='10000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FALHOU: T13 update direto aceito'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: T13 marcadores protegidos contra UPDATE comum'; END $$;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
DO $$ BEGIN INSERT INTO public.gastos (user_id, valor, data, deleted_at, deleted_by, deletion_batch_id, deletion_source)
  VALUES (auth.uid(), 1, '2026-09-02', now(), auth.uid(), gen_random_uuid(), 'site');
  RAISE EXCEPTION 'FALHOU: T14 insert marcado aceito'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: T14 INSERT já marcado recusado'; END $$;
-- update comum de outras colunas continua funcionando
UPDATE public.gastos SET descricao = 'Mercado' WHERE id='10000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok(true, 'T15 UPDATE comum de outras colunas preservado');

-- T16 execução válida (série completa) + idempotência
INSERT INTO r SELECT 's2', public.gastos_preview_exclusao_periodo('2026-09-01','2026-10-01',true);
INSERT INTO r SELECT 'ok', public.gastos_soft_delete_periodo('2026-09-01','2026-10-01',true,6,425.15,(SELECT v->>'snapshot' FROM r WHERE k='s2'),'50000000-0000-0000-0000-00000000000a');
SELECT pg_temp.ok((SELECT v->>'status'='ok' AND (v->>'count')::int=6 FROM r WHERE k='ok'), 'T16 lote marcado (6 itens)');
INSERT INTO r SELECT 'ok2', public.gastos_soft_delete_periodo('2026-09-01','2026-10-01',true,6,425.15,(SELECT v->>'snapshot' FROM r WHERE k='s2'),'50000000-0000-0000-0000-00000000000a');
SELECT pg_temp.ok((SELECT v->>'status'='ja_aplicado' FROM r WHERE k='ok2'), 'T17 repetição idempotente');
SELECT pg_temp.ok((public.gastos_preview_exclusao_periodo('2026-09-01','2026-10-01')->>'count')::int = 0, 'T18 prévia não inclui itens já excluídos');
DO $$ BEGIN UPDATE public.gastos SET descricao='x' WHERE id='10000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FALHOU: T19'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: T19 gasto marcado não editável por UPDATE comum'; END $$;
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos) = 9, 'T20 nenhuma linha apagada fisicamente');
SELECT pg_temp.ok((SELECT valor_pago FROM public.faturas_cartao) = 300, 'T21 faturas intocadas');
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE user_id='bbbbbbbb-0000-0000-0000-000000000002' AND deleted_at IS NULL) = 1, 'T22 gasto de B intocado');
SELECT pg_temp.ok((SELECT count(*) FROM public.audit_logs WHERE action='gastos_soft_delete_periodo' AND metadata ? 'count' AND NOT metadata ? 'descricao') = 1, 'T23 auditoria sem descrições');

-- T24 restaurar: B não restaura lote de A
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002',false);
SELECT pg_temp.ok(public.gastos_restaurar_lote('50000000-0000-0000-0000-00000000000a')->>'status' = 'nao_encontrado', 'T24 outro usuário não restaura');
-- T25 restauração exata pelo titular
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
SELECT pg_temp.ok((public.gastos_restaurar_lote('50000000-0000-0000-0000-00000000000a')->>'count')::int = 6, 'T25 restaura os 6');
SELECT pg_temp.ok((public.gastos_preview_exclusao_periodo('2026-09-01','2026-10-01',true)->>'sum')::numeric = 425.15, 'T26 valores idênticos após restaurar');
SELECT pg_temp.ok(public.gastos_restaurar_lote('50000000-0000-0000-0000-00000000000a')->>'status' = 'nao_encontrado', 'T27 restaurar de novo é inofensivo');

-- T28 fora do prazo de 30 dias: preserva marcados, não apaga
INSERT INTO r SELECT 'p3', public.gastos_preview_exclusao_periodo('2026-08-01','2026-09-01');
INSERT INTO r SELECT 'd3', public.gastos_soft_delete_periodo('2026-08-01','2026-09-01',false,1,7.00,(SELECT v->>'snapshot' FROM r WHERE k='p3'),'50000000-0000-0000-0000-00000000000b');
RESET ROLE;
SELECT set_config('gi.gastos_soft_delete','on',false);
UPDATE public.gastos SET deleted_at = now() - interval '31 days' WHERE deletion_batch_id='50000000-0000-0000-0000-00000000000b';
SELECT set_config('gi.gastos_soft_delete','off',false);
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
SELECT pg_temp.ok(public.gastos_restaurar_lote('50000000-0000-0000-0000-00000000000b')->>'status' = 'fora_do_prazo', 'T28 fora do prazo recusa restaurar');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE deletion_batch_id='50000000-0000-0000-0000-00000000000b') = 1, 'T29 após prazo continua marcado e preservado');

-- T30 período inválido / longo demais
SET ROLE authenticated;
DO $$ BEGIN PERFORM public.gastos_preview_exclusao_periodo('2026-10-01','2026-09-01');
  RAISE EXCEPTION 'FALHOU: T30'; EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASSOU: T30 período invertido recusado'; END $$;
DO $$ BEGIN PERFORM public.gastos_preview_exclusao_periodo('2025-01-01','2026-06-01');
  RAISE EXCEPTION 'FALHOU: T31'; EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASSOU: T31 período > 366 dias recusado'; END $$;
-- T32 virada de ano [2026-12-01, 2027-01-01) com zero itens → vazio, nada muda
SELECT pg_temp.ok(public.gastos_soft_delete_periodo('2026-12-01','2027-01-01',false,0,0,'x','50000000-0000-0000-0000-00000000000c')->>'status' = 'vazio', 'T32 período vazio encerra sem mudança');
RESET ROLE;
