-- CANDIDATA, NÃO APLICADA. Preparação reversível, nunca DELETE físico.
-- Requer F2 integral. Não substitui a RPC de privacidade nem libera lote mensal.
-- release_enabled permanece FALSE; revisão de filas offline/vínculos antecede liberação.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.gastos'::regclass AND tgname='gastos_guard_soft_delete' AND tgenabled='O')
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.gastos'::regclass AND conname='gastos_deletion_consistent_chk' AND convalidated)
 THEN RAISE EXCEPTION 'F2_required'; END IF;
 IF current_user <> (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.gastos'::regclass)
 THEN RAISE EXCEPTION 'execute_as_gastos_owner'; END IF;
END $$;

CREATE TABLE public.whatsapp_reorganization_policy (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), release_enabled boolean NOT NULL DEFAULT false
);
GRANT SELECT ON public.whatsapp_reorganization_policy TO service_role;
ALTER TABLE public.whatsapp_reorganization_policy ENABLE ROW LEVEL SECURITY;
-- Sem row de liberação: ausência significa bloqueado. Não contém INSERT de ativação.
CREATE TABLE public.whatsapp_reorganization_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
 phone_hash text NOT NULL, request_id text NOT NULL,
 scope jsonb NOT NULL, income jsonb, code_hash text NOT NULL UNIQUE,
 failed_attempts int NOT NULL DEFAULT 0 CHECK(failed_attempts BETWEEN 0 AND 5),
 expires_at timestamptz NOT NULL, snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'preview' CHECK(status IN('preview','applied','cancelled','changed','expired','restored','partial')),
 deleted_stamp timestamptz, after_snapshot jsonb, income_id uuid,
 income_after jsonb, result jsonb, restore_result jsonb,
 restore_code_hash text, restore_expires_at timestamptz, restore_attempts int NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(user_id,request_id)
);
GRANT SELECT ON public.whatsapp_reorganization_operations TO service_role;
ALTER TABLE public.whatsapp_reorganization_operations ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.whatsapp_reorganization_operations(user_id,phone_hash,created_at DESC);

CREATE FUNCTION public.wa_reorganization_authorized(p_user uuid,p_phone text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce((SELECT release_enabled FROM public.whatsapp_reorganization_policy WHERE id),false)
 AND coalesce(public.has_feature_access(p_user,'whatsapp'),false)
 AND length(regexp_replace(coalesce(p_phone,''),'\D','','g')) BETWEEN 10 AND 15
 AND EXISTS(SELECT 1 FROM public.whatsapp_links l WHERE l.user_id=p_user AND l.ativo
 AND l.opt_in_em IS NOT NULL AND l.revogado_em IS NULL
 AND regexp_replace(l.telefone,'\D','','g')=regexp_replace(p_phone,'\D','','g'))
$$;

-- Full-row snapshot: caller never supplies IDs. Unknown/linked entries block the whole scope.
CREATE FUNCTION public.wa_reorganization_snapshot(p_user uuid,p_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rows jsonb;
BEGIN
 IF p_scope IS NULL OR NOT(p_scope ?& ARRAY['tables','start','end']) OR jsonb_typeof(p_scope->'tables') IS DISTINCT FROM 'array' OR jsonb_array_length(p_scope->'tables') NOT BETWEEN 1 AND 2
 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_scope->'tables') x WHERE x NOT IN('gastos','receitas'))
 OR (SELECT count(*) FROM jsonb_array_elements_text(p_scope->'tables'))<>(SELECT count(DISTINCT x) FROM jsonb_array_elements_text(p_scope->'tables') x)
 OR (p_scope->>'start' IS NOT NULL AND p_scope->>'end' IS NOT NULL AND (p_scope->>'start')::date >= (p_scope->>'end')::date)
 THEN RAISE EXCEPTION 'invalid_scope'; END IF;
 -- Excludes soft-deleted rows. Read markers of active rows only.
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'table',x->'row'->>'id'),'[]') INTO rows FROM (
 SELECT jsonb_build_object('table','gastos','row',to_jsonb(g)) x FROM public.gastos g
 WHERE g.user_id=p_user AND g.deleted_at IS NULL AND p_scope->'tables' ? 'gastos'
 AND (p_scope->>'start' IS NULL OR g.data >= (p_scope->>'start')::date)
 AND (p_scope->>'end' IS NULL OR g.data < (p_scope->>'end')::date)
 UNION ALL
 SELECT jsonb_build_object('table','receitas','row',to_jsonb(r)) FROM public.receitas r
 WHERE r.user_id=p_user AND r.deleted_at IS NULL AND p_scope->'tables' ? 'receitas'
 AND (p_scope->>'start' IS NULL OR r.data >= (p_scope->>'start')::date)
 AND (p_scope->>'end' IS NULL OR r.data < (p_scope->>'end')::date)
 ) q;
 IF jsonb_array_length(rows)>500 THEN RAISE EXCEPTION 'scope_too_large'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(rows) item WHERE
 item->'row'->>'cartao_id' IS NOT NULL OR item->'row'->>'recorrencia_id' IS NOT NULL
 OR item->'row'->>'bem_id' IS NOT NULL OR item->'row'->>'import_batch_id' IS NOT NULL
 OR item->'row'->>'grupo_parcelamento_id' IS NOT NULL
 OR coalesce((item->'row'->>'total_parcelas')::int,1)>1
 OR item->'row'->>'forma_pagamento'='credito'
 OR coalesce(item->'row'->>'origem','') IN('pluggy','open_finance','extrato','mercadopago','mercado_pago')
 OR EXISTS(SELECT 1 FROM public.contas_a_pagar c WHERE c.gasto_id=(item->'row'->>'id')::uuid)
 OR EXISTS(SELECT 1 FROM public.pluggy_import_entries e WHERE e.entry_id=(item->'row'->>'id')::uuid)
 ) THEN RAISE EXCEPTION 'linked_scope_blocked'; END IF;
 RETURN rows;
END $$;

CREATE FUNCTION public.wa_reorganization_prepare(p_user uuid,p_phone text,p_request text,p_scope jsonb,p_income jsonb,p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.whatsapp_reorganization_operations%ROWTYPE; snap jsonb; ph text; result jsonb;
BEGIN
 IF NOT public.wa_reorganization_authorized(p_user,p_phone) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF p_request IS NULL OR length(p_request) NOT BETWEEN 1 AND 200 OR p_code !~ '^\d{6}$' OR p_code IS NULL THEN RAISE EXCEPTION 'invalid_request'; END IF;
 IF p_income IS NOT NULL AND (jsonb_typeof(p_income)<>'object' OR p_income->>'descricao' IS NULL
 OR length(trim(p_income->>'descricao')) NOT BETWEEN 1 AND 160 OR p_income->>'valor' IS NULL
 OR (p_income->>'valor')::numeric<=0 OR (p_income->>'valor')::numeric>=1e12
 OR round((p_income->>'valor')::numeric,2)<>(p_income->>'valor')::numeric
 OR p_income->>'data' IS NULL OR p_income->>'data' !~ '^\d{4}-\d{2}-\d{2}$'
 OR coalesce(p_income->>'tipo','') NOT IN('salario','outros')) THEN RAISE EXCEPTION 'invalid_income'; END IF;
 IF p_income IS NOT NULL THEN PERFORM (p_income->>'data')::date; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 ph:=encode(sha256(convert_to(regexp_replace(p_phone,'\D','','g'),'UTF8')),'hex');
 SELECT * INTO op FROM public.whatsapp_reorganization_operations WHERE user_id=p_user AND request_id=p_request;
 IF FOUND THEN
 IF op.phone_hash<>ph OR op.scope<>p_scope OR op.income IS DISTINCT FROM p_income THEN RETURN jsonb_build_object('status','blocked'); END IF;
 RETURN jsonb_build_object('status',CASE WHEN op.status='applied' THEN 'replay' ELSE op.status END,'operationId',op.id); END IF;
 snap:=public.wa_reorganization_snapshot(p_user,p_scope);
 IF jsonb_array_length(snap)=0 THEN RETURN jsonb_build_object('status','blocked'); END IF;
 UPDATE public.whatsapp_reorganization_operations SET status='cancelled' WHERE user_id=p_user AND phone_hash=ph AND status='preview';
 INSERT INTO public.whatsapp_reorganization_operations(user_id,phone_hash,request_id,scope,income,code_hash,expires_at,snapshot)
 VALUES(p_user,ph,p_request,p_scope,p_income,encode(sha256(convert_to(p_user::text||ph||p_code,'UTF8')),'hex'),clock_timestamp()+interval '5 minutes',snap) RETURNING * INTO op;
 SELECT jsonb_build_object('status','preview','operationId',op.id,'code',p_code,'expiresAt',op.expires_at,
 'scope',p_scope,'income',p_income,
 'expenses',count(*) FILTER(WHERE x->>'table'='gastos'),'incomes',count(*) FILTER(WHERE x->>'table'='receitas'),
 'totalExpenses',coalesce(sum((x->'row'->>'valor')::numeric) FILTER(WHERE x->>'table'='gastos'),0),
 'totalIncomes',coalesce(sum((x->'row'->>'valor')::numeric) FILTER(WHERE x->>'table'='receitas'),0)) INTO result FROM jsonb_array_elements(snap) x;
 RETURN result;
END $$;

CREATE FUNCTION public.wa_reorganization_confirm(p_user uuid,p_phone text,p_code text,p_operation uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.whatsapp_reorganization_operations%ROWTYPE; stamp timestamptz; snap jsonb; after_snap jsonb; ng int; nr int; created_income jsonb;
BEGIN
 IF NOT public.wa_reorganization_authorized(p_user,p_phone) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 SELECT * INTO op FROM public.whatsapp_reorganization_operations WHERE user_id=p_user
 AND phone_hash=encode(sha256(convert_to(regexp_replace(p_phone,'\D','','g'),'UTF8')),'hex')
 AND (p_operation IS NULL AND code_hash=encode(sha256(convert_to(p_user::text||encode(sha256(convert_to(regexp_replace(p_phone,'\D','','g'),'UTF8')),'hex')||p_code,'UTF8')),'hex') OR id=p_operation)
 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN
 -- Unrecognized codes cannot charge attempts against an unrelated latest request.
 RETURN jsonb_build_object('status','wrong_code'); END IF;
 IF op.status='applied' THEN RETURN op.result||jsonb_build_object('status','replay'); END IF;
 IF op.failed_attempts>=5 THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF p_code IS NULL OR p_code !~ '^\d{6}$' OR op.code_hash<>encode(sha256(convert_to(p_user::text||op.phone_hash||p_code,'UTF8')),'hex') THEN
 UPDATE public.whatsapp_reorganization_operations SET failed_attempts=failed_attempts+1 WHERE id=op.id;
 RETURN jsonb_build_object('status','wrong_code'); END IF;
 IF op.status<>'preview' THEN RETURN jsonb_build_object('status',op.status); END IF;
 IF clock_timestamp()>=op.expires_at THEN UPDATE public.whatsapp_reorganization_operations SET status='expired' WHERE id=op.id; RETURN jsonb_build_object('status','expired'); END IF;
 -- Locks then full snapshot comparison protect edits/dependency changes before mutation.
 -- Conservative candidate serialization prevents phantoms and new dependency links.
 -- Broad locks must be load-tested before considering release.
 LOCK TABLE public.gastos,public.receitas,public.contas_a_pagar,public.pluggy_import_entries IN SHARE ROW EXCLUSIVE MODE;
 PERFORM 1 FROM public.whatsapp_links WHERE user_id=p_user FOR SHARE;
 PERFORM 1 FROM public.gastos WHERE user_id=p_user AND id IN(SELECT (x->'row'->>'id')::uuid FROM jsonb_array_elements(op.snapshot) x WHERE x->>'table'='gastos') ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.receitas WHERE user_id=p_user AND id IN(SELECT (x->'row'->>'id')::uuid FROM jsonb_array_elements(op.snapshot) x WHERE x->>'table'='receitas') ORDER BY id FOR UPDATE;
 snap:=public.wa_reorganization_snapshot(p_user,op.scope);
 IF snap<>op.snapshot THEN UPDATE public.whatsapp_reorganization_operations SET status='changed' WHERE id=op.id; RETURN jsonb_build_object('status','changed'); END IF;
 IF NOT public.wa_reorganization_authorized(p_user,p_phone) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 stamp:=clock_timestamp();
 IF to_regclass('public.financial_write_generations') IS NULL THEN RAISE EXCEPTION 'financial_generation_required'; END IF;
 PERFORM set_config('gi.reorganization_mutation','on',true);
 PERFORM set_config('gi.gastos_soft_delete','on',true);
 UPDATE public.gastos SET deleted_at=stamp,deleted_by=p_user,deletion_batch_id=op.id,deletion_source='whatsapp_periodo',updated_at=stamp
 WHERE user_id=p_user AND id IN(SELECT (x->'row'->>'id')::uuid FROM jsonb_array_elements(snap) x WHERE x->>'table'='gastos');
 GET DIAGNOSTICS ng=ROW_COUNT;
 PERFORM set_config('gi.gastos_soft_delete','off',true);
 UPDATE public.receitas SET deleted_at=stamp,deleted_source='whatsapp',deleted_reason='reorganizacao:'||op.id,updated_at=stamp
 WHERE user_id=p_user AND id IN(SELECT (x->'row'->>'id')::uuid FROM jsonb_array_elements(snap) x WHERE x->>'table'='receitas');
 GET DIAGNOSTICS nr=ROW_COUNT;
 IF ng+nr<>jsonb_array_length(snap) THEN RAISE EXCEPTION 'row_count_mismatch'; END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'table',x->'row'->>'id'),'[]') INTO after_snap FROM (
 SELECT jsonb_build_object('table','gastos','row',to_jsonb(g)) x FROM public.gastos g WHERE g.user_id=p_user AND g.deletion_batch_id=op.id
 UNION ALL SELECT jsonb_build_object('table','receitas','row',to_jsonb(r)) FROM public.receitas r WHERE r.user_id=p_user AND r.deleted_reason='reorganizacao:'||op.id) q;
 IF op.income IS NOT NULL THEN
 op.income_id:=gen_random_uuid();
 INSERT INTO public.receitas(id,user_id,descricao,valor,data,tipo,mes,ano,origem)
 VALUES(op.income_id,p_user,op.income->>'descricao',(op.income->>'valor')::numeric,(op.income->>'data')::date,op.income->>'tipo',extract(month FROM (op.income->>'data')::date),extract(year FROM (op.income->>'data')::date),'whatsapp');
 SELECT to_jsonb(r) INTO created_income FROM public.receitas r WHERE r.id=op.income_id AND r.user_id=p_user;
 END IF;
 INSERT INTO public.financial_write_generations(user_id,generation) VALUES(p_user,1) ON CONFLICT(user_id) DO UPDATE SET generation=financial_write_generations.generation+1;
 PERFORM set_config('gi.reorganization_mutation','off',true);
 op.result:=jsonb_build_object('status','applied','operationId',op.id,'expenses',ng,'incomes',nr,'incomeId',op.income_id);
 UPDATE public.whatsapp_reorganization_operations SET status='applied',deleted_stamp=stamp,after_snapshot=after_snap,
 income_id=op.income_id,income_after=created_income,result=op.result,completed_at=clock_timestamp() WHERE id=op.id;
 INSERT INTO public.audit_logs(actor_user_id,target_user_id,action,entity_type,entity_id,metadata)
 VALUES(p_user,p_user,'whatsapp_reorganization','financial_operation',op.id::text,op.result-'incomeId');
 RETURN op.result;
END $$;

CREATE FUNCTION public.wa_reorganization_restore_prepare(p_user uuid,p_phone text,p_operation uuid,p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.whatsapp_reorganization_operations%ROWTYPE; ph text;
BEGIN
 IF p_code IS NULL OR p_code !~ '^\d{6}$' THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF NOT coalesce(public.has_feature_access(p_user,'whatsapp'),false) OR NOT EXISTS(SELECT 1 FROM public.whatsapp_links l WHERE l.user_id=p_user AND l.ativo AND l.opt_in_em IS NOT NULL AND l.revogado_em IS NULL AND regexp_replace(l.telefone,'\D','','g')=regexp_replace(p_phone,'\D','','g')) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 ph:=encode(sha256(convert_to(regexp_replace(p_phone,'\D','','g'),'UTF8')),'hex');
 SELECT * INTO op FROM public.whatsapp_reorganization_operations WHERE id=p_operation AND user_id=p_user AND phone_hash=ph FOR UPDATE;
 IF NOT FOUND OR op.status NOT IN('applied','partial') THEN RETURN jsonb_build_object('status','blocked'); END IF;
 UPDATE public.whatsapp_reorganization_operations SET restore_code_hash=encode(sha256(convert_to(op.id::text||p_user::text||ph||p_code,'UTF8')),'hex'),restore_expires_at=clock_timestamp()+interval '5 minutes',restore_attempts=0 WHERE id=op.id RETURNING * INTO op;
 RETURN jsonb_build_object('status','restore_preview','operationId',op.id,'code',p_code,'expiresAt',op.restore_expires_at,
 'expenses',(SELECT count(*) FROM jsonb_array_elements(op.after_snapshot) x WHERE x->>'table'='gastos'),
 'incomes',(SELECT count(*) FROM jsonb_array_elements(op.after_snapshot) x WHERE x->>'table'='receitas'));
END $$;
REVOKE ALL ON FUNCTION public.wa_reorganization_restore_prepare(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_reorganization_restore_prepare(uuid,text,uuid,text) TO service_role;

CREATE FUNCTION public.wa_reorganization_control(p_user uuid,p_phone text,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.whatsapp_reorganization_operations%ROWTYPE; x jsonb; r jsonb; ng int:=0; nr int:=0; kept int:=0;
BEGIN
 -- Pause must not prevent inspecting or restoring an already completed own operation.
 IF NOT coalesce(public.has_feature_access(p_user,'whatsapp'),false) OR NOT EXISTS(SELECT 1 FROM public.whatsapp_links l WHERE l.user_id=p_user AND l.ativo AND l.opt_in_em IS NOT NULL AND l.revogado_em IS NULL AND regexp_replace(l.telefone,'\D','','g')=regexp_replace(p_phone,'\D','','g')) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF p_action='restore' OR (p_action LIKE 'restore:%' AND array_length(string_to_array(p_action,':'),1)<>3) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF p_action NOT IN('status','cancel') AND p_action NOT LIKE 'restore:%' AND p_action NOT LIKE 'status:%' OR p_action IS NULL THEN RAISE EXCEPTION 'invalid_action'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 SELECT * INTO op FROM public.whatsapp_reorganization_operations WHERE user_id=p_user AND phone_hash=encode(sha256(convert_to(regexp_replace(p_phone,'\D','','g'),'UTF8')),'hex')
 AND (position(':' IN p_action)=0 OR id=split_part(p_action,':',2)::uuid) ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF p_action='status' OR p_action LIKE 'status:%' THEN RETURN coalesce(op.restore_result,op.result,jsonb_build_object('status',op.status)); END IF;
 IF p_action='cancel' THEN
 IF op.status<>'preview' THEN RETURN coalesce(op.result,jsonb_build_object('status',op.status)); END IF;
 UPDATE public.whatsapp_reorganization_operations SET status='cancelled' WHERE id=op.id; RETURN jsonb_build_object('status','cancelled'); END IF;
 IF split_part(p_action,':',3) !~ '^\d{6}$' OR op.restore_code_hash IS DISTINCT FROM encode(sha256(convert_to(op.id::text||p_user::text||op.phone_hash||split_part(p_action,':',3),'UTF8')),'hex') THEN
 UPDATE public.whatsapp_reorganization_operations SET restore_attempts=least(restore_attempts+1,5) WHERE id=op.id; RETURN jsonb_build_object('status','wrong_code'); END IF;
 IF op.status='restored' THEN RETURN op.restore_result||jsonb_build_object('status','replay'); END IF;
 IF op.restore_attempts>=5 THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF op.restore_expires_at IS NULL OR clock_timestamp()>=op.restore_expires_at THEN RETURN jsonb_build_object('status','expired'); END IF;
 IF op.status NOT IN('applied','partial') THEN RETURN jsonb_build_object('status','blocked'); END IF;
 LOCK TABLE public.gastos,public.receitas,public.contas_a_pagar,public.pluggy_import_entries IN SHARE ROW EXCLUSIVE MODE;
 PERFORM 1 FROM public.whatsapp_links WHERE user_id=p_user FOR SHARE;
 IF NOT coalesce(public.has_feature_access(p_user,'whatsapp'),false) OR NOT EXISTS(SELECT 1 FROM public.whatsapp_links l WHERE l.user_id=p_user AND l.ativo AND l.opt_in_em IS NOT NULL AND l.revogado_em IS NULL AND regexp_replace(l.telefone,'\D','','g')=regexp_replace(p_phone,'\D','','g')) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 PERFORM set_config('gi.reorganization_mutation','on',true);
 -- Full after snapshots preserve edits. Only own exact deletion stamp may be reversed.
 FOR x IN SELECT value FROM jsonb_array_elements(op.after_snapshot) LOOP
 r:=NULL;
 IF EXISTS(SELECT 1 FROM public.contas_a_pagar c WHERE c.gasto_id=(x->'row'->>'id')::uuid)
 OR EXISTS(SELECT 1 FROM public.pluggy_import_entries e WHERE e.entry_id=(x->'row'->>'id')::uuid) THEN kept:=kept+1; CONTINUE; END IF;
 IF x->>'table'='gastos' THEN
 SELECT to_jsonb(g) INTO r FROM public.gastos g WHERE g.user_id=p_user AND g.id=(x->'row'->>'id')::uuid FOR UPDATE;
 IF r IS DISTINCT FROM x->'row' OR (r->>'deleted_at')::timestamptz IS DISTINCT FROM op.deleted_stamp THEN kept:=kept+1; CONTINUE; END IF;
 PERFORM set_config('gi.gastos_soft_delete','on',true);
 UPDATE public.gastos SET deleted_at=NULL,deleted_by=NULL,deletion_batch_id=NULL,deletion_source=NULL,updated_at=clock_timestamp() WHERE id=(r->>'id')::uuid AND user_id=p_user;
 PERFORM set_config('gi.gastos_soft_delete','off',true); ng:=ng+1;
 ELSE
 SELECT to_jsonb(t) INTO r FROM public.receitas t WHERE t.user_id=p_user AND t.id=(x->'row'->>'id')::uuid FOR UPDATE;
 IF r IS DISTINCT FROM x->'row' OR (r->>'deleted_at')::timestamptz IS DISTINCT FROM op.deleted_stamp THEN kept:=kept+1; CONTINUE; END IF;
 UPDATE public.receitas SET deleted_at=NULL,deleted_source=NULL,deleted_reason=NULL,updated_at=clock_timestamp() WHERE id=(r->>'id')::uuid AND user_id=p_user; nr:=nr+1;
 END IF;
 END LOOP;
 IF op.income_id IS NOT NULL THEN
 SELECT to_jsonb(t) INTO r FROM public.receitas t WHERE t.id=op.income_id AND t.user_id=p_user FOR UPDATE;
 IF r->>'deleted_reason'='reorganizacao_desfeita:'||op.id THEN NULL;
 ELSIF r=op.income_after AND NOT EXISTS(SELECT 1 FROM public.pluggy_import_entries e WHERE e.entry_id=op.income_id) AND r->>'recorrencia_id' IS NULL AND r->>'import_batch_id' IS NULL THEN UPDATE public.receitas SET deleted_at=clock_timestamp(),deleted_source='whatsapp',deleted_reason='reorganizacao_desfeita:'||op.id,updated_at=clock_timestamp() WHERE id=op.income_id AND user_id=p_user;
 ELSE kept:=kept+1; END IF;
 END IF;
 PERFORM set_config('gi.reorganization_mutation','off',true);
 op.restore_result:=jsonb_build_object('status',CASE WHEN kept>0 THEN 'partial' ELSE 'restored' END,'operationId',op.id,'expenses',ng,'incomes',nr,'kept',kept);
 UPDATE public.whatsapp_reorganization_operations SET status=CASE WHEN kept>0 THEN 'partial' ELSE 'restored' END,restore_result=op.restore_result,
 restore_expires_at=NULL,
 after_snapshot=CASE WHEN kept>0 THEN (SELECT coalesce(jsonb_agg(s),'[]') FROM jsonb_array_elements(op.after_snapshot) s WHERE
 (s->>'table'='gastos' AND EXISTS(SELECT 1 FROM gastos g WHERE g.user_id=p_user AND g.id=(s->'row'->>'id')::uuid AND g.deleted_at=op.deleted_stamp)) OR
 (s->>'table'='receitas' AND EXISTS(SELECT 1 FROM receitas r WHERE r.user_id=p_user AND r.id=(s->'row'->>'id')::uuid AND r.deleted_at=op.deleted_stamp))) ELSE after_snapshot END WHERE id=op.id;
 INSERT INTO public.audit_logs(actor_user_id,target_user_id,action,entity_type,entity_id,metadata)
 VALUES(p_user,p_user,'whatsapp_reorganization_restore','financial_operation',op.id::text,op.restore_result);
 RETURN op.restore_result;
END $$;

REVOKE ALL ON FUNCTION public.wa_reorganization_authorized(uuid,text),public.wa_reorganization_snapshot(uuid,jsonb),public.wa_reorganization_prepare(uuid,text,text,jsonb,jsonb,text),public.wa_reorganization_confirm(uuid,text,text,uuid),public.wa_reorganization_control(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_reorganization_authorized(uuid,text),public.wa_reorganization_prepare(uuid,text,text,jsonb,jsonb,text),public.wa_reorganization_confirm(uuid,text,text,uuid),public.wa_reorganization_control(uuid,text,text) TO service_role;
COMMIT;