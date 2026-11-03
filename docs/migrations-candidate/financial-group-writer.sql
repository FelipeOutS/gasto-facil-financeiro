-- CANDIDATE ONLY. No policy row; all API execution remains blocked until separately authorized.
-- Narrow expanded groups: expenses/income only. No transfer, invoice payment or metadata bypass.
CREATE TABLE public.financial_group_policy(id boolean PRIMARY KEY DEFAULT true CHECK(id), enabled boolean NOT NULL DEFAULT false);
GRANT SELECT ON public.financial_group_policy TO authenticated;
GRANT ALL ON public.financial_group_policy TO service_role;
ALTER TABLE public.financial_group_policy ENABLE ROW LEVEL SECURITY;
CREATE POLICY group_policy_read ON public.financial_group_policy FOR SELECT TO authenticated USING(true);
CREATE TABLE public.financial_group_operations(
 id uuid PRIMARY KEY, user_id uuid NOT NULL, generation bigint NOT NULL, kind text NOT NULL,
 payload jsonb NOT NULL, after_rows jsonb NOT NULL, status text NOT NULL DEFAULT 'committed' CHECK(status IN('committed','hidden','restored')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,id)
);
GRANT SELECT ON public.financial_group_operations TO authenticated;
GRANT ALL ON public.financial_group_operations TO service_role;
ALTER TABLE public.financial_group_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_group_operations ON public.financial_group_operations FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE FUNCTION public.financial_group_write(p_owner uuid,p_operation uuid,p_generation bigint,p_kind text,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.financial_group_operations%ROWTYPE; item jsonb; row_json jsonb; result jsonb:='[]'; relation_name text; ordinal int:=0; cash_count int:=0;
BEGIN
 IF auth.uid() IS NULL OR auth.uid()<>p_owner OR NOT coalesce(public.can_create_in_account(p_owner),false) THEN RAISE EXCEPTION 'financial_group_unauthorized'; END IF;
 IF NOT coalesce((SELECT enabled FROM public.financial_group_policy WHERE id),false) THEN RAISE EXCEPTION 'financial_group_release_blocked'; END IF;
 -- Paid-only candidate; never expands basic/free quotas through a SECURITY DEFINER path.
 IF NOT coalesce(public.has_active_plan_access(p_owner),false) THEN RAISE EXCEPTION 'financial_group_feature_blocked'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN('manual','installments','recurrence','csv','pdf','image') OR p_operation IS NULL OR p_generation IS NULL OR p_generation<0
 OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_financial_group'; END IF;
 -- Match reset lock ordering; no transaction-local reorganization bypass for ordinary creation.
 LOCK TABLE public.gastos,public.receitas IN SHARE ROW EXCLUSIVE MODE;
 PERFORM public.financial_assert_generation(p_owner,p_generation);
 SELECT * INTO op FROM public.financial_group_operations WHERE id=p_operation FOR UPDATE;
 IF FOUND THEN
 IF op.user_id<>p_owner OR op.generation<>p_generation OR op.kind<>p_kind OR op.payload<>p_rows THEN RAISE EXCEPTION 'financial_group_payload_conflict'; END IF;
 -- Replay is an acknowledgement, never rows to inject into an active UI after deletion/edit.
 RETURN jsonb_build_object('status','replay','operationId',op.id,'rows','[]'::jsonb);
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
 relation_name:=item->>'table'; row_json:=item->'row'; ordinal:=ordinal+1;
 IF relation_name IS NULL OR relation_name NOT IN('gastos','receitas') OR jsonb_typeof(row_json) IS DISTINCT FROM 'object' OR row_json->>'user_id' IS DISTINCT FROM p_owner::text
 OR row_json->>'id' IS NULL OR row_json->>'descricao' IS NULL OR row_json->>'data' IS NULL OR row_json->>'valor' IS NULL
 OR (row_json->>'valor')::numeric<=0 OR (row_json->>'valor')::numeric>=1e12 OR round((row_json->>'valor')::numeric,2)<>(row_json->>'valor')::numeric
 OR row_json ?| ARRAY['deleted_at','deleted_by','deleted_source','deleted_reason','deletion_batch_id','deletion_source','offline_client_id','offline_generation'] THEN RAISE EXCEPTION 'invalid_financial_group_row'; END IF;
 IF row_json->>'bem_id' IS NOT NULL OR row_json->>'origem' IN('pluggy','open_finance','mercadopago','mercado_pago') THEN RAISE EXCEPTION 'financial_group_linked_blocked'; END IF;
 -- Only writable financial fields; never accept confirmation/audit/owner-control columns by schema existence alone.
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(row_json) key WHERE key NOT IN('id','user_id','descricao','valor','data','mes','ano','estabelecimento','categoria_id','forma_pagamento','observacao','imagem_url','tipo_gasto','parcela_atual','total_parcelas','grupo_parcelamento_id','recorrencia_id','recorrente','essencial','gasto_fixo','cartao_id','invoice_month','fatura_competencia','horario','origem','import_batch_id','id_operacao_banco','fornecedor_id','cliente_id','financial_bank_id','cash_effective_at')) THEN RAISE EXCEPTION 'financial_group_forbidden_column'; END IF;
 IF row_json->>'cliente_id' IS NOT NULL OR row_json->>'fornecedor_id' IS NOT NULL THEN RAISE EXCEPTION 'financial_group_reference_adapter_pending'; END IF;
 IF row_json->>'cash_effective_at' IS NOT NULL THEN cash_count:=cash_count+1; END IF;
 -- Payload source-key duplicate proof across tombstones; never use active-only/UI heuristics.
 IF row_json->>'id_operacao_banco' IS NOT NULL THEN
 IF EXISTS(SELECT 1 FROM public.gastos g WHERE g.user_id=p_owner AND to_jsonb(g)->>'id_operacao_banco'=row_json->>'id_operacao_banco')
 OR EXISTS(SELECT 1 FROM public.receitas r WHERE r.user_id=p_owner AND to_jsonb(r)->>'id_operacao_banco'=row_json->>'id_operacao_banco') THEN RAISE EXCEPTION 'financial_source_already_recorded'; END IF;
 END IF;
 row_json:=row_json||jsonb_build_object('offline_client_id','group:'||p_operation||':'||ordinal,'offline_generation',p_generation);
 -- Populate only columns declared by the actual schema; reject unknown keys instead of silently dropping bank/link fields.
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(row_json) key WHERE NOT EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=relation_name AND c.column_name=key)) THEN RAISE EXCEPTION 'financial_group_unknown_column'; END IF;
 IF relation_name='gastos' THEN
 IF row_json->>'cartao_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cartoes WHERE id=(row_json->>'cartao_id')::uuid AND user_id=p_owner) THEN RAISE EXCEPTION 'financial_group_card_owner_mismatch'; END IF;
 IF row_json->>'categoria_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.categorias WHERE id=(row_json->>'categoria_id')::uuid AND user_id=p_owner) THEN RAISE EXCEPTION 'financial_group_category_owner_mismatch'; END IF;
 END IF;
 -- Explicit supplied columns preserve database defaults for omitted fields.
 EXECUTE (SELECT format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I,$1) RETURNING to_jsonb(%I.*)',relation_name,string_agg(format('%I',key),',' ORDER BY key),string_agg(format('%I',key),',' ORDER BY key),relation_name,relation_name) FROM jsonb_object_keys(row_json) key) INTO row_json USING row_json;
 result:=result||jsonb_build_array(jsonb_build_object('table',relation_name,'row',row_json));
 END LOOP;
 IF cash_count>0 AND (p_kind IN('installments','recurrence') OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) e WHERE e->'row'->>'grupo_parcelamento_id' IS NOT NULL OR e->'row'->>'recorrencia_id' IS NOT NULL OR coalesce((e->'row'->>'total_parcelas')::int,1)>1)) THEN RAISE EXCEPTION 'financial_group_settlements_require_single_occurrence'; END IF;
 INSERT INTO public.financial_group_operations(id,user_id,generation,kind,payload,after_rows) VALUES(p_operation,p_owner,p_generation,p_kind,p_rows,result);
 RETURN jsonb_build_object('status','committed','operationId',p_operation,'rows',result);
END $$;
REVOKE ALL ON FUNCTION public.financial_group_write(uuid,uuid,bigint,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.financial_group_write(uuid,uuid,bigint,text,jsonb) TO authenticated;
-- Reorganization of these groups is still blocked: writer compatibility is not permission to reset a linked graph.