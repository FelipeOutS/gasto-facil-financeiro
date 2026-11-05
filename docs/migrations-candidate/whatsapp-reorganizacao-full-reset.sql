-- CANDIDATO (não aplicado). "Zerar tudo" com blocos vinculados.
-- Inclui: todos os gastos (cartão, parcelas inclusive futuras, recorrentes,
-- importados, ligados a contas), todas as receitas, faturas de cartão,
-- contas a pagar/receber, transferências internas e regras de recorrência
-- (pausadas para não recriar lançamentos). Preserva cadastros de bancos,
-- cartões, metas, investimentos, bens e a conta de acesso.
-- Lançamentos ligados a bens/financiamentos ficam DE FORA e são listados:
-- a prévia só diz "limpeza total" quando nada fica de fora.
-- Nada é apagado fisicamente: gastos/receitas viram exclusão reversível e os
-- demais blocos são arquivados (ocultos por política RESTRITIVA), com diário
-- completo antes/depois. Restauração é tudo-ou-nada.
-- Dependências: whatsapp-reorganizacao.sql, partial-scope, owner-allowlist,
-- gastos-soft-delete-f2, financial-offline-generation. release_enabled segue FALSE.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regprocedure('public.wa_reorganization_authorized(uuid,text)') IS NULL
 OR to_regclass('public.whatsapp_reorganization_allowlist') IS NULL
 OR to_regclass('public.financial_write_generations') IS NULL
 THEN RAISE EXCEPTION 'full_reset_prerequisites_missing'; END IF;
END $$;

-- Arquivamento reversível dos blocos sem coluna de exclusão.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['faturas_cartao','contas_a_pagar','contas_a_receber','transferencias_internas','recorrencias'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS reorg_archived_at timestamptz, ADD COLUMN IF NOT EXISTS reorg_batch_id uuid',t);
   EXECUTE format('DROP POLICY IF EXISTS reorg_hide_archived ON public.%I',t);
   -- RESTRITIVA: soma-se (AND) às políticas existentes; arquivado some do site e não pode ser editado.
   EXECUTE format('CREATE POLICY reorg_hide_archived ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (reorg_archived_at IS NULL) WITH CHECK (reorg_archived_at IS NULL)',t);
  END IF;
 END LOOP;
END $$;

-- Unicidade só entre registros ativos: depois de zerar, nova fatura do mesmo
-- cartão/mês e nova recorrência detectada podem ser criadas normalmente.
DO $$ BEGIN
 IF to_regclass('public.faturas_cartao') IS NOT NULL THEN
  ALTER TABLE public.faturas_cartao DROP CONSTRAINT IF EXISTS faturas_cartao_unique;
  DROP INDEX IF EXISTS public.faturas_cartao_unique;
  CREATE UNIQUE INDEX faturas_cartao_unique ON public.faturas_cartao(user_id,cartao_id,mes,ano) WHERE reorg_archived_at IS NULL;
 END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='recorrencias' AND column_name='detection_key') THEN
  DROP INDEX IF EXISTS public.idx_recorrencias_detection_key;
  CREATE UNIQUE INDEX idx_recorrencias_detection_key ON public.recorrencias(user_id,detection_key) WHERE detection_key IS NOT NULL AND reorg_archived_at IS NULL;
 END IF;
END $$;

CREATE TABLE public.whatsapp_reorganization_full_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL,
 phone_hash text NOT NULL,
 request_id text NOT NULL,
 status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','applied','restored','cancelled','expired','changed')),
 code_hash text NOT NULL,
 expires_at timestamptz NOT NULL,
 failed_attempts int NOT NULL DEFAULT 0,
 fingerprint text NOT NULL,
 summary jsonb NOT NULL,
 left_out jsonb NOT NULL DEFAULT '[]',
 deleted_stamp timestamptz,
 result jsonb,
 restore_code_hash text,
 restore_expires_at timestamptz,
 restore_attempts int NOT NULL DEFAULT 0,
 restore_result jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz,
 restored_at timestamptz,
 UNIQUE (user_id, request_id)
);
CREATE TABLE public.whatsapp_reorganization_full_journal (
 operation_id uuid NOT NULL REFERENCES public.whatsapp_reorganization_full_operations(id),
 table_name text NOT NULL,
 row_id uuid NOT NULL,
 before_row jsonb NOT NULL,
 after_row jsonb,
 PRIMARY KEY (operation_id, table_name, row_id)
);
CREATE TABLE public.financial_import_tombstones (
 user_id uuid NOT NULL,
 operation_key text NOT NULL,
 batch_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (user_id, operation_key)
);
GRANT SELECT ON public.whatsapp_reorganization_full_operations, public.whatsapp_reorganization_full_journal, public.financial_import_tombstones TO service_role;
ALTER TABLE public.whatsapp_reorganization_full_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_reorganization_full_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_import_tombstones ENABLE ROW LEVEL SECURITY;
-- Sem políticas: só funções SECURITY DEFINER escrevem; diário é imutável fora delas.

CREATE TRIGGER wa_reorganization_full_allowlist_guard BEFORE INSERT ON public.whatsapp_reorganization_full_operations
 FOR EACH ROW EXECUTE FUNCTION public.tg_wa_reorganization_allowlist();

CREATE FUNCTION public.tg_wa_full_journal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (OLD.after_row IS NOT NULL OR NEW.before_row IS DISTINCT FROM OLD.before_row OR NEW.row_id IS DISTINCT FROM OLD.row_id)) THEN
  RAISE EXCEPTION 'full_journal_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wa_full_journal_immutable BEFORE UPDATE OR DELETE ON public.whatsapp_reorganization_full_journal
 FOR EACH ROW EXECUTE FUNCTION public.tg_wa_full_journal_immutable();

-- Reimportação de lançamento zerado é recusada (o import inteiro falha) até a restauração.
CREATE FUNCTION public.financial_import_signature(p_table text,p_row jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT 'sig:'||p_table||':'||(p_row->>'data')||':'||round((p_row->>'valor')::numeric,2)::text||':'||lower(btrim(coalesce(p_row->>'descricao','')))
$$;
CREATE FUNCTION public.tg_financial_import_tombstone() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j jsonb:=to_jsonb(NEW); k text:=nullif(lower(btrim(j->>'id_operacao_banco')),''); sig text;
BEGIN
 -- Sem identificador bancário, importados usam a mesma assinatura exata da deduplicação do extrato.
 IF j->>'import_batch_id' IS NOT NULL THEN sig:=public.financial_import_signature(TG_TABLE_NAME,j); END IF;
 IF EXISTS(SELECT 1 FROM public.financial_import_tombstones t WHERE t.user_id=NEW.user_id AND (t.operation_key=k OR t.operation_key=sig)) THEN
  RAISE EXCEPTION 'reimport_blocked_reorganized_entry'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_financial_import_tombstone() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['gastos','receitas','transferencias_internas'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('CREATE TRIGGER financial_import_tombstone BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_financial_import_tombstone()',t);
  END IF;
 END LOOP;
END $$;

-- Linha ligada a bem/financiamento: fora do escopo (contrato contábil próprio).
CREATE FUNCTION public.wa_full_reset_bem_linked(p_item jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rel text; col text; linked boolean;
BEGIN
 IF p_item->'row'->>'bem_id' IS NOT NULL THEN RETURN true; END IF;
 col:=CASE p_item->>'table' WHEN 'gastos' THEN 'gasto_id' WHEN 'receitas' THEN 'receita_id' ELSE NULL END;
 IF col IS NULL THEN RETURN false; END IF;
 FOREACH rel IN ARRAY ARRAY['bens_pagamentos','bens_custos_aquisicao','bens_amortizacoes'] LOOP
  IF EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=rel AND c.column_name=col) THEN
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE %I=$1)',rel,col) INTO linked USING (p_item->'row'->>'id')::uuid;
   IF linked THEN RETURN true; END IF;
  END IF;
 END LOOP;
 RETURN false;
END $$;

CREATE FUNCTION public.wa_full_reset_rows(p_user uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE acc jsonb:='[]'; part jsonb; t text;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('table','gastos','row',to_jsonb(g)) ORDER BY g.id),'[]') INTO part FROM public.gastos g WHERE g.user_id=p_user AND g.deleted_at IS NULL;
 acc:=acc||part;
 SELECT coalesce(jsonb_agg(jsonb_build_object('table','receitas','row',to_jsonb(r)) ORDER BY r.id),'[]') INTO part FROM public.receitas r WHERE r.user_id=p_user AND r.deleted_at IS NULL;
 acc:=acc||part;
 FOREACH t IN ARRAY ARRAY['faturas_cartao','contas_a_pagar','contas_a_receber','transferencias_internas','recorrencias'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('SELECT coalesce(jsonb_agg(jsonb_build_object(''table'',%L,''row'',to_jsonb(x)) ORDER BY x.id),''[]'') FROM public.%I x WHERE x.user_id=$1 AND x.reorg_archived_at IS NULL',t,t) INTO part USING p_user;
   acc:=acc||part;
  END IF;
 END LOOP;
 RETURN acc;
END $$;

CREATE FUNCTION public.wa_full_reset_summary(p_rows jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 WITH x AS (SELECT e->>'table' t, e->'row' r FROM jsonb_array_elements(p_rows) e),
 g AS (SELECT * FROM x WHERE t='gastos')
 SELECT jsonb_build_object(
  'expenses',(SELECT count(*) FROM g)::int,
  'totalExpenses',(SELECT coalesce(sum((r->>'valor')::numeric),0) FROM g),
  'incomes',(SELECT count(*) FROM x WHERE t='receitas')::int,
  'totalIncomes',(SELECT coalesce(sum((r->>'valor')::numeric),0) FROM x WHERE t='receitas'),
  'card',(SELECT count(*) FROM g WHERE r->>'cartao_id' IS NOT NULL OR r->>'forma_pagamento'='credito')::int,
  'installments',(SELECT count(*) FROM g WHERE r->>'grupo_parcelamento_id' IS NOT NULL OR coalesce((r->>'total_parcelas')::int,1)>1)::int,
  'futureInstallments',(SELECT count(*) FROM g WHERE (r->>'grupo_parcelamento_id' IS NOT NULL OR coalesce((r->>'total_parcelas')::int,1)>1) AND (r->>'data')::date>current_date)::int,
  'recurringEntries',(SELECT count(*) FROM x WHERE t IN('gastos','receitas') AND r->>'recorrencia_id' IS NOT NULL)::int,
  'imported',(SELECT count(*) FROM x WHERE t IN('gastos','receitas') AND (r->>'import_batch_id' IS NOT NULL OR coalesce(r->>'origem','') IN('pluggy','open_finance','extrato','mercadopago','mercado_pago') OR coalesce(r->>'origem','') LIKE 'extrato%'))::int,
  'invoices',(SELECT count(*) FROM x WHERE t='faturas_cartao')::int,
  'payables',(SELECT count(*) FROM x WHERE t='contas_a_pagar')::int,
  'receivables',(SELECT count(*) FROM x WHERE t='contas_a_receber')::int,
  'transfers',(SELECT count(*) FROM x WHERE t='transferencias_internas')::int,
  'recurrenceRules',(SELECT count(*) FROM x WHERE t='recorrencias')::int)
$$;

CREATE FUNCTION public.wa_full_reset_prepare(p_user uuid,p_phone text,p_request text,p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rows jsonb; eligible jsonb; lo jsonb; ph text; op public.whatsapp_reorganization_full_operations%ROWTYPE; s jsonb;
BEGIN
 IF NOT public.wa_reorganization_authorized(p_user,p_phone) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF p_request IS NULL OR length(p_request) NOT BETWEEN 1 AND 200 OR p_code IS NULL OR p_code !~ '^\d{6}$' THEN RAISE EXCEPTION 'invalid_request'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 ph:=encode(sha256(convert_to(regexp_replace(p_phone,'\D','','g'),'UTF8')),'hex');
 SELECT * INTO op FROM public.whatsapp_reorganization_full_operations WHERE user_id=p_user AND request_id=p_request;
 IF FOUND THEN
  IF op.phone_hash<>ph THEN RETURN jsonb_build_object('status','blocked'); END IF;
  RETURN jsonb_build_object('status',CASE WHEN op.status='applied' THEN 'replay' ELSE op.status END,'operationId',op.id);
 END IF;
 rows:=public.wa_full_reset_rows(p_user);
 IF jsonb_array_length(rows)>5000 THEN RAISE EXCEPTION 'scope_too_large'; END IF;
 SELECT coalesce(jsonb_agg(e),'[]') INTO eligible FROM jsonb_array_elements(rows) e WHERE NOT public.wa_full_reset_bem_linked(e);
 SELECT coalesce(jsonb_agg(jsonb_build_object('table',t,'motivo','bem','n',n,'total',total)),'[]') INTO lo FROM (
  SELECT e->>'table' t,count(*) n,coalesce(sum((e->'row'->>'valor')::numeric),0) total FROM jsonb_array_elements(rows) e WHERE public.wa_full_reset_bem_linked(e) GROUP BY 1) q;
 IF jsonb_array_length(eligible)=0 THEN RETURN jsonb_build_object('status','nothing_eligible','leftOut',lo,'expenses',0,'incomes',0); END IF;
 s:=public.wa_full_reset_summary(eligible);
 UPDATE public.whatsapp_reorganization_full_operations SET status='cancelled' WHERE user_id=p_user AND status='preview';
 UPDATE public.whatsapp_reorganization_operations SET status='cancelled' WHERE user_id=p_user AND phone_hash=ph AND status='preview';
 INSERT INTO public.whatsapp_reorganization_full_operations(user_id,phone_hash,request_id,code_hash,expires_at,fingerprint,summary,left_out)
 VALUES(p_user,ph,p_request,encode(sha256(convert_to(p_user::text||ph||p_code,'UTF8')),'hex'),clock_timestamp()+interval '5 minutes',md5(rows::text),s,lo)
 RETURNING * INTO op;
 RETURN s||jsonb_build_object('status','preview','mode','full','operationId',op.id,'code',p_code,'expiresAt',op.expires_at,'leftOut',lo,'complete',jsonb_array_length(lo)=0,
  'scope',jsonb_build_object('tables',jsonb_build_array('gastos','receitas'),'start',NULL,'end',NULL));
END $$;

CREATE FUNCTION public.wa_full_reset_confirm(p_user uuid,p_phone text,p_code text,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.whatsapp_reorganization_full_operations%ROWTYPE; rows jsonb; eligible jsonb; stamp timestamptz; t text; n int; total int:=0; ph text;
BEGIN
 ph:=encode(sha256(convert_to(regexp_replace(coalesce(p_phone,''),'\D','','g'),'UTF8')),'hex');
 -- Voz/texto sem identificador: só a prévia pendente deste titular+número cujo código confere.
 IF p_operation IS NULL THEN
  SELECT o.id INTO p_operation FROM public.whatsapp_reorganization_full_operations o WHERE o.user_id=p_user AND o.phone_hash=ph AND o.status='preview'
   AND p_code ~ '^\d{6}$' AND o.code_hash=encode(sha256(convert_to(p_user::text||ph||p_code,'UTF8')),'hex') ORDER BY o.created_at DESC LIMIT 1;
  IF p_operation IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_reorganization_full_operations WHERE id=p_operation AND user_id=p_user) THEN RETURN jsonb_build_object('status','not_found'); END IF;
 IF NOT public.wa_reorganization_authorized(p_user,p_phone) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 LOCK TABLE public.gastos,public.receitas IN SHARE ROW EXCLUSIVE MODE;
 FOREACH t IN ARRAY ARRAY['faturas_cartao','contas_a_pagar','contas_a_receber','transferencias_internas','recorrencias','cartoes','bancos'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',t); END IF;
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 ph:=encode(sha256(convert_to(regexp_replace(p_phone,'\D','','g'),'UTF8')),'hex');
 SELECT * INTO op FROM public.whatsapp_reorganization_full_operations WHERE id=p_operation AND user_id=p_user AND phone_hash=ph FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','wrong_code'); END IF;
 IF op.status='applied' THEN RETURN op.result||jsonb_build_object('status','replay'); END IF;
 IF op.failed_attempts>=5 THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF p_code IS NULL OR p_code !~ '^\d{6}$' OR op.code_hash<>encode(sha256(convert_to(p_user::text||ph||p_code,'UTF8')),'hex') THEN
  UPDATE public.whatsapp_reorganization_full_operations SET failed_attempts=failed_attempts+1 WHERE id=op.id;
  RETURN jsonb_build_object('status','wrong_code'); END IF;
 IF op.status<>'preview' THEN RETURN jsonb_build_object('status',op.status); END IF;
 IF clock_timestamp()>=op.expires_at THEN UPDATE public.whatsapp_reorganization_full_operations SET status='expired' WHERE id=op.id; RETURN jsonb_build_object('status','expired'); END IF;
 rows:=public.wa_full_reset_rows(p_user);
 IF md5(rows::text)<>op.fingerprint THEN UPDATE public.whatsapp_reorganization_full_operations SET status='changed' WHERE id=op.id; RETURN jsonb_build_object('status','changed'); END IF;
 SELECT coalesce(jsonb_agg(e),'[]') INTO eligible FROM jsonb_array_elements(rows) e WHERE NOT public.wa_full_reset_bem_linked(e);
 stamp:=clock_timestamp();
 PERFORM set_config('gi.reorganization_mutation','on',true);
 INSERT INTO public.whatsapp_reorganization_full_journal(operation_id,table_name,row_id,before_row)
  SELECT op.id,e->>'table',(e->'row'->>'id')::uuid,e->'row' FROM jsonb_array_elements(eligible) e;
 IF to_regprocedure('public.financial_capture_card_history(uuid,jsonb)') IS NOT NULL THEN
  PERFORM public.financial_capture_card_history(p_user,(SELECT coalesce(jsonb_agg(e),'[]') FROM jsonb_array_elements(eligible) e WHERE e->>'table'='gastos'));
 END IF;
 PERFORM set_config('gi.gastos_soft_delete','on',true);
 UPDATE public.gastos g SET deleted_at=stamp,deleted_by=p_user,deletion_batch_id=op.id,deletion_source='whatsapp_periodo',updated_at=stamp
  FROM public.whatsapp_reorganization_full_journal j WHERE j.operation_id=op.id AND j.table_name='gastos' AND g.id=j.row_id AND g.user_id=p_user;
 GET DIAGNOSTICS n=ROW_COUNT; total:=total+n;
 PERFORM set_config('gi.gastos_soft_delete','off',true);
 UPDATE public.receitas r SET deleted_at=stamp,deleted_source='whatsapp',deleted_reason='reorganizacao_total:'||op.id,updated_at=stamp
  FROM public.whatsapp_reorganization_full_journal j WHERE j.operation_id=op.id AND j.table_name='receitas' AND r.id=j.row_id AND r.user_id=p_user;
 GET DIAGNOSTICS n=ROW_COUNT; total:=total+n;
 FOREACH t IN ARRAY ARRAY['faturas_cartao','contas_a_pagar','contas_a_receber','transferencias_internas','recorrencias'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('UPDATE public.%I x SET reorg_archived_at=$2,reorg_batch_id=$1,updated_at=$2%s FROM public.whatsapp_reorganization_full_journal j WHERE j.operation_id=$1 AND j.table_name=%L AND x.id=j.row_id AND x.user_id=$3',
    t,CASE WHEN t='recorrencias' THEN ',status=''pausada''' ELSE '' END,t) USING op.id,stamp,p_user;
   GET DIAGNOSTICS n=ROW_COUNT; total:=total+n;
  END IF;
 END LOOP;
 IF total<>jsonb_array_length(eligible) THEN RAISE EXCEPTION 'row_count_mismatch'; END IF;
 -- Diário "depois": base para detectar qualquer alteração antes da restauração.
 FOREACH t IN ARRAY ARRAY['gastos','receitas','faturas_cartao','contas_a_pagar','contas_a_receber','transferencias_internas','recorrencias'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('UPDATE public.whatsapp_reorganization_full_journal j SET after_row=to_jsonb(x) FROM public.%I x WHERE j.operation_id=$1 AND j.table_name=%L AND x.id=j.row_id',t,t) USING op.id;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.whatsapp_reorganization_full_journal WHERE operation_id=op.id AND after_row IS NULL) THEN RAISE EXCEPTION 'journal_incomplete'; END IF;
 INSERT INTO public.financial_import_tombstones(user_id,operation_key,batch_id)
  SELECT DISTINCT p_user,lower(btrim(e->'row'->>'id_operacao_banco')),op.id FROM jsonb_array_elements(eligible) e
  WHERE e->>'table' IN('gastos','receitas','transferencias_internas') AND nullif(btrim(e->'row'->>'id_operacao_banco'),'') IS NOT NULL
  ON CONFLICT DO NOTHING;
 INSERT INTO public.financial_import_tombstones(user_id,operation_key,batch_id)
  SELECT DISTINCT p_user,public.financial_import_signature(e->>'table',e->'row'),op.id FROM jsonb_array_elements(eligible) e
  WHERE e->>'table' IN('gastos','receitas','transferencias_internas') AND e->'row'->>'import_batch_id' IS NOT NULL AND nullif(btrim(e->'row'->>'id_operacao_banco'),'') IS NULL
  ON CONFLICT DO NOTHING;
 INSERT INTO public.financial_write_generations(user_id,generation) VALUES(p_user,1) ON CONFLICT(user_id) DO UPDATE SET generation=financial_write_generations.generation+1;
 PERFORM set_config('gi.reorganization_mutation','off',true);
 op.result:=op.summary||jsonb_build_object('status','applied','mode','full','operationId',op.id,'leftOut',op.left_out,'complete',jsonb_array_length(op.left_out)=0);
 UPDATE public.whatsapp_reorganization_full_operations SET status='applied',deleted_stamp=stamp,result=op.result,completed_at=clock_timestamp() WHERE id=op.id;
 IF to_regclass('public.audit_logs') IS NOT NULL THEN
  INSERT INTO public.audit_logs(actor_user_id,target_user_id,action,entity_type,entity_id,metadata) VALUES(p_user,p_user,'whatsapp_full_reset','financial_operation',op.id::text,op.result);
 END IF;
 RETURN op.result;
END $$;

CREATE FUNCTION public.wa_full_reset_restore_prepare(p_user uuid,p_phone text,p_operation uuid,p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.whatsapp_reorganization_full_operations%ROWTYPE; ph text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_reorganization_full_operations WHERE id=p_operation AND user_id=p_user) THEN RETURN jsonb_build_object('status','not_found'); END IF;
 IF p_code IS NULL OR p_code !~ '^\d{6}$' THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF NOT public.wa_reorganization_authorized(p_user,p_phone) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 ph:=encode(sha256(convert_to(regexp_replace(p_phone,'\D','','g'),'UTF8')),'hex');
 SELECT * INTO op FROM public.whatsapp_reorganization_full_operations WHERE id=p_operation AND user_id=p_user AND phone_hash=ph FOR UPDATE;
 IF NOT FOUND OR op.status<>'applied' THEN RETURN jsonb_build_object('status','blocked'); END IF;
 UPDATE public.whatsapp_reorganization_full_operations SET restore_code_hash=encode(sha256(convert_to(op.id::text||p_user::text||ph||p_code,'UTF8')),'hex'),
  restore_expires_at=clock_timestamp()+interval '5 minutes',restore_attempts=0 WHERE id=op.id RETURNING * INTO op;
 RETURN op.summary||jsonb_build_object('status','restore_preview','mode','full','operationId',op.id,'code',p_code,'expiresAt',op.restore_expires_at);
END $$;

CREATE FUNCTION public.wa_full_reset_restore_confirm(p_user uuid,p_phone text,p_operation uuid,p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.whatsapp_reorganization_full_operations%ROWTYPE; ph text; t text; cols text; n int; total int:=0; conflicts int:=0; expected int; superseded uuid[]:='{}'; dups int:=0;
BEGIN
 ph:=encode(sha256(convert_to(regexp_replace(coalesce(p_phone,''),'\D','','g'),'UTF8')),'hex');
 IF p_operation IS NULL THEN
  SELECT o.id INTO p_operation FROM public.whatsapp_reorganization_full_operations o WHERE o.user_id=p_user AND o.phone_hash=ph AND o.status='applied'
   AND p_code ~ '^\d{6}$' AND o.restore_code_hash=encode(sha256(convert_to(o.id::text||p_user::text||ph||p_code,'UTF8')),'hex') ORDER BY o.completed_at DESC LIMIT 1;
  IF p_operation IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_reorganization_full_operations WHERE id=p_operation AND user_id=p_user) THEN RETURN jsonb_build_object('status','not_found'); END IF;
 -- Restauração não exige release ativo (pausar não pode impedir desfazer), mas exige titular e vínculo.
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_reorganization_allowlist a WHERE a.user_id=p_user)
 OR NOT coalesce(public.has_feature_access(p_user,'whatsapp'),false)
 OR NOT EXISTS(SELECT 1 FROM public.whatsapp_links l WHERE l.user_id=p_user AND l.ativo AND l.opt_in_em IS NOT NULL AND l.revogado_em IS NULL AND regexp_replace(l.telefone,'\D','','g')=regexp_replace(p_phone,'\D','','g'))
 THEN RETURN jsonb_build_object('status','blocked'); END IF;
 LOCK TABLE public.gastos,public.receitas IN SHARE ROW EXCLUSIVE MODE;
 FOREACH t IN ARRAY ARRAY['faturas_cartao','contas_a_pagar','contas_a_receber','transferencias_internas','recorrencias'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',t); END IF;
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 ph:=encode(sha256(convert_to(regexp_replace(p_phone,'\D','','g'),'UTF8')),'hex');
 SELECT * INTO op FROM public.whatsapp_reorganization_full_operations WHERE id=p_operation AND user_id=p_user AND phone_hash=ph FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF op.status='restored' THEN RETURN op.restore_result||jsonb_build_object('status','replay'); END IF;
 IF op.restore_attempts>=5 THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF p_code IS NULL OR p_code !~ '^\d{6}$' OR op.restore_code_hash IS DISTINCT FROM encode(sha256(convert_to(op.id::text||p_user::text||ph||p_code,'UTF8')),'hex') THEN
  UPDATE public.whatsapp_reorganization_full_operations SET restore_attempts=restore_attempts+1 WHERE id=op.id; RETURN jsonb_build_object('status','wrong_code'); END IF;
 IF op.restore_expires_at IS NULL OR clock_timestamp()>=op.restore_expires_at THEN RETURN jsonb_build_object('status','expired'); END IF;
 IF op.status<>'applied' THEN RETURN jsonb_build_object('status','blocked'); END IF;
 -- Tudo-ou-nada: qualquer linha alterada depois da limpeza impede a restauração inteira.
 FOREACH t IN ARRAY ARRAY['gastos','receitas','faturas_cartao','contas_a_pagar','contas_a_receber','transferencias_internas','recorrencias'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('SELECT count(*) FROM public.whatsapp_reorganization_full_journal j WHERE j.operation_id=$1 AND j.table_name=%L AND NOT EXISTS(SELECT 1 FROM public.%I x WHERE x.id=j.row_id AND to_jsonb(x)=j.after_row)',t,t) INTO n USING op.id;
   conflicts:=conflicts+n;
  END IF;
 END LOOP;
 IF conflicts>0 THEN RETURN jsonb_build_object('status','changed','conflicts',conflicts); END IF;
 -- Movimentações feitas depois da limpeza nunca são apagadas nem duplicadas:
-- fatura do mesmo cartão/mês ou recorrência com a mesma chave criada depois
-- prevalece; a antiga continua arquivada e é informada como "mantida a atual".
 SELECT coalesce(array_agg(j.row_id),'{}') INTO superseded FROM public.whatsapp_reorganization_full_journal j
  WHERE j.operation_id=op.id AND (
   (j.table_name='faturas_cartao' AND EXISTS(SELECT 1 FROM public.faturas_cartao f WHERE f.user_id=p_user AND f.reorg_archived_at IS NULL AND f.id<>j.row_id
     AND f.cartao_id::text=j.before_row->>'cartao_id' AND f.mes::text=j.before_row->>'mes' AND f.ano::text=j.before_row->>'ano'))
   OR (j.table_name='recorrencias' AND j.before_row->>'detection_key' IS NOT NULL AND EXISTS(SELECT 1 FROM public.recorrencias r WHERE r.user_id=p_user AND r.reorg_archived_at IS NULL AND r.id<>j.row_id
     AND to_jsonb(r)->>'detection_key'=j.before_row->>'detection_key')));
 -- Lançamento igual digitado de novo depois da limpeza: não é fundido, só sinalizado.
 SELECT count(*) INTO dups FROM public.whatsapp_reorganization_full_journal j
  WHERE j.operation_id=op.id AND j.table_name IN('gastos','receitas') AND EXISTS(
   SELECT 1 FROM (SELECT 'gastos' tn,to_jsonb(g) r FROM public.gastos g WHERE g.user_id=p_user AND g.deleted_at IS NULL
                  UNION ALL SELECT 'receitas',to_jsonb(x) FROM public.receitas x WHERE x.user_id=p_user AND x.deleted_at IS NULL) a
   WHERE a.tn=j.table_name AND (a.r->>'id')::uuid<>j.row_id AND public.financial_import_signature(a.tn,a.r)=public.financial_import_signature(j.table_name,j.before_row));
 PERFORM set_config('gi.reorganization_mutation','on',true);
 PERFORM set_config('gi.gastos_soft_delete','on',true);
 FOREACH t IN ARRAY ARRAY['gastos','receitas','faturas_cartao','contas_a_pagar','contas_a_receber','transferencias_internas','recorrencias'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   SELECT string_agg(quote_ident(c.column_name),',' ORDER BY c.ordinal_position) INTO cols FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name=t AND c.column_name<>'id' AND c.is_generated='NEVER' AND c.is_updatable='YES';
   EXECUTE format('UPDATE public.%I x SET (%s)=(SELECT %s FROM jsonb_populate_record(NULL::public.%I,j.before_row)) FROM public.whatsapp_reorganization_full_journal j WHERE j.operation_id=$1 AND j.table_name=%L AND x.id=j.row_id AND x.user_id=$2 AND NOT (x.id=ANY($3))',
    t,cols,cols,t,t) USING op.id,p_user,superseded;
   GET DIAGNOSTICS n=ROW_COUNT; total:=total+n;
  END IF;
 END LOOP;
 PERFORM set_config('gi.gastos_soft_delete','off',true);
 SELECT count(*)-cardinality(superseded) INTO expected FROM public.whatsapp_reorganization_full_journal WHERE operation_id=op.id;
 IF total<>expected THEN RAISE EXCEPTION 'restore_row_count_mismatch'; END IF;
 DELETE FROM public.financial_import_tombstones WHERE user_id=p_user AND batch_id=op.id;
 INSERT INTO public.financial_write_generations(user_id,generation) VALUES(p_user,1) ON CONFLICT(user_id) DO UPDATE SET generation=financial_write_generations.generation+1;
 PERFORM set_config('gi.reorganization_mutation','off',true);
 op.restore_result:=op.summary||jsonb_build_object('status','restored','mode','full','operationId',op.id,'kept',0,'supersededByNewer',cardinality(superseded),'possibleDuplicates',dups);
 UPDATE public.whatsapp_reorganization_full_operations SET status='restored',restore_result=op.restore_result,restored_at=clock_timestamp() WHERE id=op.id;
 IF to_regclass('public.audit_logs') IS NOT NULL THEN
  INSERT INTO public.audit_logs(actor_user_id,target_user_id,action,entity_type,entity_id,metadata) VALUES(p_user,p_user,'whatsapp_full_reset_restore','financial_operation',op.id::text,op.restore_result);
 END IF;
 RETURN op.restore_result;
END $$;

CREATE FUNCTION public.wa_full_reset_last_applied(p_user uuid,p_phone text) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_reorganization_allowlist a WHERE a.user_id=p_user) THEN RETURN NULL; END IF;
 RETURN (SELECT o.id FROM public.whatsapp_reorganization_full_operations o
  WHERE o.user_id=p_user AND o.status='applied' AND o.phone_hash=encode(sha256(convert_to(regexp_replace(p_phone,'\D','','g'),'UTF8')),'hex')
  ORDER BY o.completed_at DESC LIMIT 1);
END $$;

REVOKE ALL ON FUNCTION public.financial_import_signature(text,jsonb),public.wa_full_reset_bem_linked(jsonb),public.wa_full_reset_rows(uuid),public.wa_full_reset_summary(jsonb),
 public.wa_full_reset_prepare(uuid,text,text,text),public.wa_full_reset_confirm(uuid,text,text,uuid),
 public.wa_full_reset_restore_prepare(uuid,text,uuid,text),public.wa_full_reset_restore_confirm(uuid,text,uuid,text),
 public.wa_full_reset_last_applied(uuid,text),public.tg_wa_full_journal_immutable() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_full_reset_prepare(uuid,text,text,text),public.wa_full_reset_confirm(uuid,text,text,uuid),
 public.wa_full_reset_restore_prepare(uuid,text,uuid,text),public.wa_full_reset_restore_confirm(uuid,text,uuid,text),
 public.wa_full_reset_last_applied(uuid,text) TO service_role;
COMMIT;
