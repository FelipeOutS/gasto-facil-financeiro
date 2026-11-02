-- Testes HOSTIS (dados fictícios): cliente tenta "se passar" pela RPC
-- setando a GUC gi.gastos_soft_delete. Deve ser recusado SEMPRE.
\set ON_ERROR_STOP on
CREATE TEMP TABLE IF NOT EXISTS h (k text PRIMARY KEY);
SET ROLE authenticated;

-- A (titular) — GUC local na mesma transação, UPDATE de marcadores em linha ativa
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
DO $$ BEGIN
  PERFORM set_config('gi.gastos_soft_delete','on',true);
  UPDATE public.gastos SET deleted_at = now(), deleted_by = auth.uid(),
         deletion_batch_id = gen_random_uuid(), deletion_source = 'site'
   WHERE id = '10000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FALHOU: H1 GUC local liberou marcação direta';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: H1 GUC local (dono) não libera marcar'; END $$;

-- A — GUC de sessão (is_local=false)
SELECT set_config('gi.gastos_soft_delete','on',false);
DO $$ BEGIN
  UPDATE public.gastos SET deleted_at = now(), deleted_by = auth.uid(),
         deletion_batch_id = gen_random_uuid(), deletion_source = 'site'
   WHERE id = '10000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FALHOU: H2 GUC de sessão liberou marcação';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: H2 GUC de sessão não libera marcar'; END $$;

-- A — com GUC: restaurar/editar linha já excluída (lote b de T28 segue marcado)
DO $$ BEGIN
  UPDATE public.gastos SET deleted_at = NULL, deleted_by = NULL, deletion_batch_id = NULL, deletion_source = NULL
   WHERE id = '10000000-0000-0000-0000-000000000005';
  RAISE EXCEPTION 'FALHOU: H3 restauração direta com GUC';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: H3 restauração direta recusada'; END $$;
DO $$ BEGIN
  UPDATE public.gastos SET descricao = 'hack', valor = 1 WHERE id = '10000000-0000-0000-0000-000000000005';
  RAISE EXCEPTION 'FALHOU: H4 edição de linha excluída com GUC';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: H4 edição de linha excluída recusada'; END $$;
DO $$ BEGIN
  UPDATE public.gastos SET deleted_at = now() - interval '1 day' WHERE id = '10000000-0000-0000-0000-000000000005';
  RAISE EXCEPTION 'FALHOU: H5 alterar data de exclusão (prazo) com GUC';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: H5 adulterar prazo recusado'; END $$;

-- A — INSERT já marcado com GUC
DO $$ BEGIN
  INSERT INTO public.gastos (user_id, valor, data, deleted_at, deleted_by, deletion_batch_id, deletion_source)
  VALUES (auth.uid(), 1, '2026-09-02', now(), auth.uid(), gen_random_uuid(), 'site');
  RAISE EXCEPTION 'FALHOU: H6 INSERT marcado com GUC';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: H6 INSERT marcado recusado com GUC'; END $$;

-- C (colaborador com RLS de escrita na conta de A) com GUC
SELECT set_config('request.jwt.claim.sub','cccccccc-0000-0000-0000-000000000003',false);
DO $$ BEGIN
  PERFORM set_config('gi.gastos_soft_delete','on',true);
  UPDATE public.gastos SET deleted_at = now(), deleted_by = auth.uid(),
         deletion_batch_id = gen_random_uuid(), deletion_source = 'site'
   WHERE id = '10000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FALHOU: H7 colaborador marcou com GUC';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: H7 colaborador com GUC recusado'; END $$;

-- Operação comum continua funcionando mesmo com a GUC ligada
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
UPDATE public.gastos SET descricao = 'Mercado' WHERE id = '10000000-0000-0000-0000-000000000001';
INSERT INTO public.gastos (id, user_id, valor, data) VALUES ('60000000-0000-0000-0000-000000000001', auth.uid(), 2, '2026-12-10');
DO $$ BEGIN RAISE NOTICE 'PASSOU: H8 UPDATE/INSERT comuns preservados com GUC ligada'; END $$;

-- RPC legítima ainda funciona (marca e restaura) com GUC do cliente em qualquer valor
SELECT set_config('gi.gastos_soft_delete','off',false);
DO $$ DECLARE p jsonb; d jsonb; r jsonb; BEGIN
  p := public.gastos_preview_exclusao_periodo('2026-12-01','2027-01-01');
  d := public.gastos_soft_delete_periodo('2026-12-01','2027-01-01',false,1,2,p->>'snapshot','50000000-0000-0000-0000-00000000000d');
  IF d->>'status' <> 'ok' THEN RAISE EXCEPTION 'FALHOU: H9 RPC soft-delete %', d; END IF;
  r := public.gastos_restaurar_lote('50000000-0000-0000-0000-00000000000d');
  IF (r->>'count')::int <> 1 THEN RAISE EXCEPTION 'FALHOU: H9 RPC restaurar %', r; END IF;
  RAISE NOTICE 'PASSOU: H9 RPCs confiáveis seguem marcando/restaurando';
END $$;

-- anon também não
RESET ROLE; SET ROLE anon;
DO $$ BEGIN
  PERFORM set_config('gi.gastos_soft_delete','on',true);
  UPDATE public.gastos SET deleted_at = now() WHERE true;
  RAISE NOTICE 'PASSOU: H10 anon sem efeito (sem GRANT de UPDATE)';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: H10 anon recusado'; END $$;
RESET ROLE;

-- service_role (BYPASSRLS) com GUC também não grava marcadores diretamente
SET ROLE service_role;
DO $$ BEGIN
  PERFORM set_config('gi.gastos_soft_delete','on',true);
  UPDATE public.gastos SET deleted_at = NULL, deleted_by = NULL, deletion_batch_id = NULL, deletion_source = NULL
   WHERE id = '10000000-0000-0000-0000-000000000005';
  RAISE EXCEPTION 'FALHOU: H11 service_role restaurou direto';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASSOU: H11 service_role direto recusado'; END $$;
RESET ROLE;

-- Integridade final
DO $$ BEGIN
  IF (SELECT deleted_at IS NULL FROM public.gastos WHERE id='10000000-0000-0000-0000-000000000001')
     AND (SELECT deleted_at IS NOT NULL AND descricao='Agosto' AND valor=7 FROM public.gastos WHERE id='10000000-0000-0000-0000-000000000005')
  THEN RAISE NOTICE 'PASSOU: H12 nenhuma marcação/edição hostil persistiu';
  ELSE RAISE EXCEPTION 'FALHOU: H12 estado adulterado'; END IF;
END $$;

-- Auditoria de privilégios declarados
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='tg_gastos_guard_soft_delete' AND prosecdef)
  THEN RAISE EXCEPTION 'FALHOU: H13 trigger não pode ser SECURITY DEFINER'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prosecdef AND NOT ('search_path=public' = ANY(coalesce(p.proconfig,'{}'))))
  THEN RAISE EXCEPTION 'FALHOU: H13 SECURITY DEFINER sem search_path fixo'; END IF;
  IF has_function_privilege('anon','public.gastos_soft_delete_periodo(date,date,boolean,int,numeric,text,uuid,text)','EXECUTE')
     OR has_function_privilege('authenticated','public._gastos_periodo_selecao(uuid,date,date,boolean)','EXECUTE')
  THEN RAISE EXCEPTION 'FALHOU: H13 EXECUTE indevido'; END IF;
  IF has_schema_privilege('authenticated','public','CREATE') OR has_schema_privilege('anon','public','CREATE')
  THEN RAISE EXCEPTION 'FALHOU: H13 CREATE em public para cliente'; END IF;
  RAISE NOTICE 'PASSOU: H13 privilégios declarados (definer/search_path/EXECUTE/CREATE)';
END $$;
