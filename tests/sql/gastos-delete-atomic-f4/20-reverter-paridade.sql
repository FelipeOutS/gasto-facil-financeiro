-- Paridade com revertExtratoImportadoSeguro + atomicidade. Dados fictícios.
-- Chamadas de RPC rodam como 'authenticated' (não superuser), com RLS ativo.
\set ON_ERROR_STOP on
CREATE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF NOT coalesce(c,false) THEN RAISE EXCEPTION 'FALHOU: %', msg; END IF; RAISE NOTICE 'PASSOU: %', msg; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(boolean, text) TO authenticated;
-- Falha injetada (somente teste): DELETE em transferências (3ª tabela) ou UPDATE do status.
CREATE FUNCTION public.t_falha() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF current_setting('gi.falha', true) = TG_TABLE_NAME THEN RAISE EXCEPTION 'falha_injetada_%', TG_TABLE_NAME; END IF;
  RETURN coalesce(NEW, OLD); END $$;
CREATE TRIGGER t_falha BEFORE DELETE ON public.transferencias_internas FOR EACH ROW EXECUTE FUNCTION public.t_falha();
CREATE TRIGGER t_falha BEFORE UPDATE ON public.extratos_importados FOR EACH ROW EXECUTE FUNCTION public.t_falha();

-- A = aaaa..1. P = lote misto (edições). L = lote limpo nas 5 tabelas.
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set P '''d0000000-0000-0000-0000-000000000001'''
\set L '''d0000000-0000-0000-0000-000000000002'''
INSERT INTO public.extratos_importados VALUES (:P, :A, 'importado'), (:L, :A, 'importado');
INSERT INTO public.gastos (id, user_id, descricao, valor, data, import_batch_id, created_at, updated_at) VALUES
 ('d1000000-0000-0000-0000-000000000001', :A, 'P nao editado', 10, '2026-09-01', :P, now(), now()),
 ('d1000000-0000-0000-0000-000000000002', :A, 'P editado', 20, '2026-09-01', :P, now() - interval '1 day', now()),
 ('d1000000-0000-0000-0000-000000000003', :A, 'P editado 4s', 30, '2026-09-01', :P, now() - interval '4 seconds', now()),
 ('d1000000-0000-0000-0000-000000000004', :A, 'L', 40, '2026-09-01', :L, now(), now());
INSERT INTO public.receitas (id, user_id, import_batch_id, created_at, updated_at, deleted_at) VALUES
 ('d2000000-0000-0000-0000-000000000001', :A, :P, now(), now(), NULL),
 ('d2000000-0000-0000-0000-000000000002', :A, :P, now() - interval '1 day', now(), NULL),
 ('d2000000-0000-0000-0000-000000000003', :A, :P, now(), now(), now()),
 ('d2000000-0000-0000-0000-000000000004', :A, :L, now(), now(), NULL);
INSERT INTO public.transferencias_internas (id, user_id, import_batch_id, created_at, updated_at) VALUES
 ('d3000000-0000-0000-0000-000000000001', :A, :P, now(), now()),
 ('d3000000-0000-0000-0000-000000000002', :A, :P, now() - interval '1 day', now()),
 ('d3000000-0000-0000-0000-000000000003', :A, :L, now(), now());
-- guardado e movimentações: sempre removidos, mesmo editados (igual ao fluxo seguro).
INSERT INTO public.dinheiro_guardado (id, user_id, import_batch_id, created_at, updated_at) VALUES
 ('d4000000-0000-0000-0000-000000000001', :A, :P, now() - interval '1 day', now()),
 ('d4000000-0000-0000-0000-000000000002', :A, :L, now(), now());
INSERT INTO public.movimentacoes_meta (id, user_id, import_batch_id, created_at, updated_at) VALUES
 ('d5000000-0000-0000-0000-000000000001', :A, :P, now(), now()),
 ('d5000000-0000-0000-0000-000000000002', :A, :L, now(), now());
-- Linha de OUTRO lote / OUTRO usuário que nunca pode ser tocada.
INSERT INTO public.gastos (id, user_id, descricao, valor, data, import_batch_id) VALUES
 ('d1000000-0000-0000-0000-000000000009', 'bbbbbbbb-0000-0000-0000-000000000002', 'B', 1, '2026-09-01', :P);

CREATE TEMP VIEW snap AS SELECT
 (SELECT count(*) FROM public.gastos) g, (SELECT count(*) FROM public.receitas) r,
 (SELECT count(*) FROM public.transferencias_internas) t, (SELECT count(*) FROM public.dinheiro_guardado) d,
 (SELECT count(*) FROM public.movimentacoes_meta) m,
 (SELECT string_agg(status, ',' ORDER BY id) FROM public.extratos_importados) s;
CREATE TEMP TABLE antes AS SELECT * FROM snap;
GRANT SELECT ON snap, antes TO authenticated;

SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);

-- (1) falha na 3ª tabela → zero mudanças em todas, status intacto
SET gi.falha = 'transferencias_internas';
DO $$ BEGIN PERFORM public.reverter_extrato_atomic('d0000000-0000-0000-0000-000000000002');
  RAISE EXCEPTION 'FALHOU: não abortou'; EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF; RAISE NOTICE 'PASSOU: falha na 3ª tabela aborta'; END $$;
RESET gi.falha;
RESET ROLE;
SELECT pg_temp.ok((SELECT row(s.*) = row(a.*) FROM snap s, antes a), '(1) rollback total, nada mudou em nenhuma tabela');
SET ROLE authenticated;

-- (2) falha no UPDATE do status → rollback total
SET gi.falha = 'extratos_importados';
DO $$ BEGIN PERFORM public.reverter_extrato_atomic('d0000000-0000-0000-0000-000000000002');
  RAISE EXCEPTION 'FALHOU: não abortou'; EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF; RAISE NOTICE 'PASSOU: falha no status aborta'; END $$;
RESET gi.falha;
RESET ROLE;
SELECT pg_temp.ok((SELECT row(s.*) = row(a.*) FROM snap s, antes a), '(2) rollback total após falha do status');

-- (8) outro usuário não enxerga nem reverte o lote de A
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002',false);
DO $$ BEGIN PERFORM public.reverter_extrato_atomic('d0000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'FALHOU: B reverteu'; EXCEPTION WHEN no_data_found THEN RAISE NOTICE 'PASSOU: (8) B não reverte lote de A'; END $$;
SELECT set_config('request.jwt.claim.sub','',false);
DO $$ BEGIN PERFORM public.reverter_extrato_atomic('d0000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'FALHOU: sem login'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: sem login recusado'; END $$;
RESET ROLE;
SELECT pg_temp.ok((SELECT row(s.*) = row(a.*) FROM snap s, antes a), '(8) nada mudou');

-- (4)(5) lote misto → apaga só não editados; guardado/mov sempre; parcial
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
CREATE TEMP TABLE r4 AS SELECT public.reverter_extrato_atomic('d0000000-0000-0000-0000-000000000001') j;
SELECT pg_temp.ok((SELECT j->>'status' FROM r4) = 'parcial', '(4) status parcial');
SELECT pg_temp.ok((SELECT (j->>'removidos')::int FROM r4) = 6, '(4) removidos = 2 gastos + 1 receita + 1 transf + 1 guardado + 1 mov');
SELECT pg_temp.ok((SELECT (j->>'mantidos')::int FROM r4) = 3, '(4) mantidos = gasto editado + receita editada + transf editada');
RESET ROLE;
SELECT pg_temp.ok((SELECT array_agg(id ORDER BY id)::text FROM public.gastos WHERE import_batch_id = 'd0000000-0000-0000-0000-000000000001')
  = '{d1000000-0000-0000-0000-000000000002,d1000000-0000-0000-0000-000000000009}', '(5) gasto editado de A e gasto de B preservados');
SELECT pg_temp.ok((SELECT array_agg(id ORDER BY id)::text FROM public.receitas WHERE import_batch_id = 'd0000000-0000-0000-0000-000000000001')
  = '{d2000000-0000-0000-0000-000000000002,d2000000-0000-0000-0000-000000000003}', '(5) receita editada e receita soft-excluída preservadas');
SELECT pg_temp.ok((SELECT array_agg(id)::text FROM public.transferencias_internas WHERE import_batch_id = 'd0000000-0000-0000-0000-000000000001')
  = '{d3000000-0000-0000-0000-000000000002}', '(5) transferência editada preservada');
SELECT pg_temp.ok((SELECT count(*) FROM public.dinheiro_guardado WHERE import_batch_id = 'd0000000-0000-0000-0000-000000000001') = 0
  AND (SELECT count(*) FROM public.movimentacoes_meta WHERE import_batch_id = 'd0000000-0000-0000-0000-000000000001') = 0, '(5) guardado/mov removidos');
SELECT pg_temp.ok((SELECT reverted_at IS NOT NULL FROM public.extratos_importados WHERE id = 'd0000000-0000-0000-0000-000000000001'), '(4) reverted_at gravado');

-- (12) repetir após parcial → nada novo, continua parcial
SET ROLE authenticated;
CREATE TEMP TABLE r12 AS SELECT public.reverter_extrato_atomic('d0000000-0000-0000-0000-000000000001') j;
SELECT pg_temp.ok((SELECT j->>'status' = 'parcial' AND (j->>'removidos')::int = 0 AND (j->>'mantidos')::int = 3 FROM r12), '(12) repetição após parcial: 0 removidos, mantém parcial');

-- (6) lote limpo nas 5 tabelas → revertido
CREATE TEMP TABLE r6 AS SELECT public.reverter_extrato_atomic('d0000000-0000-0000-0000-000000000002') j;
SELECT pg_temp.ok((SELECT j->>'status' = 'revertido' AND (j->>'removidos')::int = 5 AND (j->>'mantidos')::int = 0 FROM r6), '(6) lote limpo: 5 removidos, revertido');
-- (7) já revertido → idempotente
SELECT pg_temp.ok((public.reverter_extrato_atomic('d0000000-0000-0000-0000-000000000002')->>'idempotent') = 'true', '(7) replay idempotente');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.gastos WHERE id = 'd1000000-0000-0000-0000-000000000009') = 1, 'gasto de outro usuário intacto');
