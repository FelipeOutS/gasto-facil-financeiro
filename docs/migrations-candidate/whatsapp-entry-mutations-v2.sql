-- CANDIDATA, NAO APLICADA. Requer F2 integral e leitores F3 homologados.
-- Não instala F2, não habilita exclusão mensal, não modifica dados existentes.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES
 ('gastos','deleted_at'),('gastos','deleted_by'),('gastos','deletion_batch_id'),('gastos','deletion_source'),('gastos','updated_at'),('gastos','import_batch_id'),
 ('receitas','deleted_at'),('receitas','deleted_source'),('receitas','deleted_reason'),('receitas','updated_at'),('receitas','import_batch_id')
 ) required(tbl,col) WHERE NOT EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=required.tbl AND c.column_name=required.col))
 THEN RAISE EXCEPTION 'F2_required: incomplete financial schema'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.gastos'::regclass AND tgname='gastos_guard_soft_delete' AND tgenabled='O')
 OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.gastos'::regclass AND conname='gastos_deletion_consistent_chk' AND convalidated)
 THEN RAISE EXCEPTION 'F2_required'; END IF;
 IF current_user <> (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.gastos'::regclass)
 THEN RAISE EXCEPTION 'execute_as_gastos_owner'; END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='receitas' AND column_name='deleted_source')
 THEN RAISE EXCEPTION 'receitas_soft_delete_required'; END IF;
END $$;
-- Acrescenta a origem explícita sem alterar o guard nem a consistência F2.
ALTER TABLE public.gastos DROP CONSTRAINT gastos_deletion_source_chk;
ALTER TABLE public.gastos ADD CONSTRAINT gastos_deletion_source_chk CHECK
 (deletion_source IS NULL OR deletion_source IN ('whatsapp_periodo','site','whatsapp'));
CREATE TABLE IF NOT EXISTS public.whatsapp_entry_mutations (
 user_id uuid NOT NULL, request_id text NOT NULL, entity_table text NOT NULL,
 entity_id uuid NOT NULL, operation text NOT NULL, expected_at timestamptz NOT NULL,
 before_row jsonb NOT NULL, after_row jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,request_id), CHECK(entity_table IN ('gastos','receitas')),
 CHECK(operation IN ('delete','restore'))
);
ALTER TABLE public.whatsapp_entry_mutations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_entry_mutations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.whatsapp_entry_mutations TO service_role;
CREATE OR REPLACE FUNCTION public.whatsapp_entry_mutate_v2(
 p_user_id uuid,p_phone text,p_table text,p_id uuid,p_expected_at timestamptz,
 p_operation text,p_request_id text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r jsonb; after_r jsonb; previous public.whatsapp_entry_mutations%ROWTYPE;
 stamp timestamptz; batch uuid := gen_random_uuid(); result text;
BEGIN
 IF p_phone IS NULL OR regexp_replace(p_phone,'\D','','g')='' OR p_table IS NULL OR p_operation IS NULL
 OR p_user_id IS NULL OR p_id IS NULL OR p_expected_at IS NULL OR p_request_id IS NULL
 OR length(p_request_id) NOT BETWEEN 1 AND 200 OR p_table NOT IN ('gastos','receitas')
 OR p_operation NOT IN ('delete','restore') THEN RETURN 'blocked'; END IF;
 -- Lock matches F2's namespace and serializes retries across processes.
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user_id::text,0));
 PERFORM 1 FROM public.whatsapp_links WHERE user_id=p_user_id AND ativo
 AND opt_in_em IS NOT NULL AND revogado_em IS NULL
 AND regexp_replace(telefone,'\D','','g')=regexp_replace(p_phone,'\D','','g') FOR SHARE;
 IF NOT FOUND OR NOT coalesce(public.has_feature_access(p_user_id,'whatsapp'),false) THEN RETURN 'blocked'; END IF;
 SELECT * INTO previous FROM public.whatsapp_entry_mutations WHERE user_id=p_user_id AND request_id=p_request_id;
 IF FOUND THEN
   IF previous.entity_table<>p_table OR previous.entity_id<>p_id OR previous.operation<>p_operation OR previous.expected_at<>p_expected_at THEN RETURN 'blocked'; END IF;
   RETURN CASE WHEN p_operation='delete' THEN 'gone' ELSE 'already' END;
 END IF;
 -- Identifiers are a closed list; values are bound, never interpolated.
 EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 AND user_id=$2 FOR UPDATE',p_table) INTO r USING p_id,p_user_id;
 IF r IS NULL THEN RETURN 'gone'; END IF;
 IF p_operation='delete' AND r->>'deleted_at' IS NOT NULL THEN RETURN 'gone'; END IF;
 IF p_operation='restore' AND r->>'deleted_at' IS NULL THEN RETURN 'already'; END IF;
 IF (r->>'updated_at')::timestamptz IS DISTINCT FROM p_expected_at THEN RETURN 'changed'; END IF;
 IF r->>'import_batch_id' IS NOT NULL OR r->>'recorrencia_id' IS NOT NULL OR r->>'bem_id' IS NOT NULL
 OR r->>'cartao_id' IS NOT NULL OR r->>'grupo_parcelamento_id' IS NOT NULL
 OR coalesce((r->>'total_parcelas')::int,1)>1 OR r->>'forma_pagamento'='credito'
 OR coalesce(r->>'origem','') IN ('pluggy','open_finance','extrato') THEN RETURN 'blocked'; END IF;
 IF p_table='gastos' AND EXISTS(SELECT 1 FROM public.contas_a_pagar WHERE gasto_id=p_id) THEN RETURN 'blocked'; END IF;
 -- Restaura apenas uma exclusão desta RPC, com snapshot inteiro intacto.
 IF p_operation='restore' AND NOT EXISTS(SELECT 1 FROM public.whatsapp_entry_mutations m
 WHERE m.user_id=p_user_id AND m.entity_table=p_table AND m.entity_id=p_id AND m.operation='delete' AND m.after_row=r
 AND m.created_at>now()-interval '30 days') THEN RETURN 'blocked'; END IF;
 IF NOT coalesce(public.has_feature_access(p_user_id,'whatsapp'),false) THEN RETURN 'blocked'; END IF;
 stamp:=greatest(clock_timestamp(),p_expected_at+interval '1 microsecond');
 IF p_table='gastos' THEN
   PERFORM set_config('gi.gastos_soft_delete','on',true);
   UPDATE public.gastos SET deleted_at=CASE WHEN p_operation='delete' THEN stamp ELSE NULL END,
     deleted_by=CASE WHEN p_operation='delete' THEN p_user_id ELSE NULL END,
     deletion_batch_id=CASE WHEN p_operation='delete' THEN batch ELSE NULL END,
     deletion_source=CASE WHEN p_operation='delete' THEN 'whatsapp' ELSE NULL END, updated_at=stamp
   WHERE id=p_id AND user_id=p_user_id;
   PERFORM set_config('gi.gastos_soft_delete','off',true);
 ELSE
   UPDATE public.receitas SET deleted_at=CASE WHEN p_operation='delete' THEN stamp ELSE NULL END,
     deleted_source=CASE WHEN p_operation='delete' THEN 'whatsapp' ELSE NULL END,
     deleted_reason=CASE WHEN p_operation='delete' THEN 'exclusao_usuario' ELSE NULL END, updated_at=stamp
   WHERE id=p_id AND user_id=p_user_id;
 END IF;
 EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 AND user_id=$2',p_table) INTO after_r USING p_id,p_user_id;
 INSERT INTO public.whatsapp_entry_mutations VALUES(p_user_id,p_request_id,p_table,p_id,p_operation,p_expected_at,r,after_r,now());
 RETURN CASE WHEN p_operation='delete' THEN 'deleted' ELSE 'restored' END;
END $$;
REVOKE ALL ON FUNCTION public.whatsapp_entry_mutate_v2(uuid,text,text,uuid,timestamptz,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_entry_mutate_v2(uuid,text,text,uuid,timestamptz,text,text) TO service_role;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='whatsapp_entry_mutate_v2' AND p.proowner<>(SELECT relowner FROM pg_class WHERE oid='public.gastos'::regclass)) THEN RAISE EXCEPTION 'rpc_owner_mismatch'; END IF;
END $$;
COMMIT;
