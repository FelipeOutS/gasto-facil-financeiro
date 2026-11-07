-- CANDIDATA, NÃO APLICADA. Aplicar depois de whatsapp-reorganizacao.sql (e dos candidatos financeiros).
-- Escopo parcial explícito: lançamentos vinculados (cartão sem suporte, parcelas, recorrência, bem,
-- importação, conta a pagar/receber, Pluggy) deixam de bloquear o pedido inteiro e passam a ficar
-- DE FORA, intactos, listados na prévia e no resultado com contagem e soma por motivo.
-- Não altera dados existentes; release_enabled continua FALSE.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regprocedure('public.wa_reorganization_prepare(uuid,text,text,jsonb,jsonb,text,jsonb)') IS NULL
 OR to_regprocedure('public.wa_reorganization_confirm(uuid,text,text,uuid)') IS NULL
 THEN RAISE EXCEPTION 'reorganization_base_required'; END IF;
END $$;

ALTER TABLE public.whatsapp_reorganization_operations ADD COLUMN IF NOT EXISTS left_out jsonb;

-- Motivo pelo qual a linha fica fora; NULL = elegível. Mesmos critérios do bloqueio anterior.
CREATE OR REPLACE FUNCTION public.wa_reorganization_left_out_reason(p_user uuid,p_item jsonb)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r jsonb:=p_item->'row';
BEGIN
 IF r->>'grupo_parcelamento_id' IS NOT NULL OR coalesce((r->>'total_parcelas')::int,1)>1 THEN RETURN 'parcelado'; END IF;
 IF r->>'recorrencia_id' IS NOT NULL THEN RETURN 'recorrente'; END IF;
 IF r->>'bem_id' IS NOT NULL THEN RETURN 'bem'; END IF;
 IF r->>'import_batch_id' IS NOT NULL OR coalesce(r->>'origem','') IN('pluggy','open_finance','extrato','mercadopago','mercado_pago') THEN RETURN 'importado'; END IF;
 IF (r->>'cartao_id' IS NOT NULL OR r->>'forma_pagamento'='credito') AND NOT public.wa_reorganization_card_supported(p_user,r) THEN RETURN 'cartao'; END IF;
 IF (p_item->>'table'='gastos' AND EXISTS(SELECT 1 FROM public.contas_a_pagar c WHERE c.gasto_id=(r->>'id')::uuid))
 OR public.wa_reorganization_has_dependency((r->>'id')::uuid,p_item->>'table') THEN RETURN 'vinculado'; END IF;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.wa_reorganization_scope_rows(p_user uuid,p_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rows jsonb;
BEGIN
 IF p_scope IS NULL OR NOT(p_scope ?& ARRAY['tables','start','end']) OR jsonb_typeof(p_scope->'tables') IS DISTINCT FROM 'array' OR jsonb_array_length(p_scope->'tables') NOT BETWEEN 1 AND 2
 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_scope->'tables') x WHERE x NOT IN('gastos','receitas'))
 OR (SELECT count(*) FROM jsonb_array_elements_text(p_scope->'tables'))<>(SELECT count(DISTINCT x) FROM jsonb_array_elements_text(p_scope->'tables') x)
 OR (p_scope->>'start' IS NOT NULL AND p_scope->>'end' IS NOT NULL AND (p_scope->>'start')::date >= (p_scope->>'end')::date)
 THEN RAISE EXCEPTION 'invalid_scope'; END IF;
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
 RETURN rows;
END $$;

-- Snapshot passa a conter só elegíveis; prepare/confirm existentes comparam este conjunto.
CREATE OR REPLACE FUNCTION public.wa_reorganization_snapshot(p_user uuid,p_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rows jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'table',x->'row'->>'id'),'[]') INTO rows
 FROM jsonb_array_elements(public.wa_reorganization_scope_rows(p_user,p_scope)) x
 WHERE public.wa_reorganization_left_out_reason(p_user,x) IS NULL;
 IF jsonb_array_length(rows)>500 THEN RAISE EXCEPTION 'scope_too_large'; END IF;
 RETURN rows;
END $$;

CREATE OR REPLACE FUNCTION public.wa_reorganization_left_out(p_user uuid,p_scope jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('table',t,'motivo',m,'n',n,'total',total) ORDER BY t,m),'[]') FROM (
  SELECT x->>'table' t,public.wa_reorganization_left_out_reason(p_user,x) m,count(*) n,sum((x->'row'->>'valor')::numeric) total
  FROM jsonb_array_elements(public.wa_reorganization_scope_rows(p_user,p_scope)) x
  WHERE public.wa_reorganization_left_out_reason(p_user,x) IS NOT NULL GROUP BY 1,2) q
$$;

-- Wrappers: mesma autorização/locks das RPCs base; acrescentam o que fica de fora.
CREATE OR REPLACE FUNCTION public.wa_reorganization_prepare_v2(p_user uuid,p_phone text,p_request text,p_scope jsonb,p_income jsonb,p_code text,p_balance jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE res jsonb; lo jsonb;
BEGIN
 res:=public.wa_reorganization_prepare(p_user,p_phone,p_request,p_scope,p_income,p_code,p_balance);
 IF NOT public.wa_reorganization_authorized(p_user,p_phone) THEN RETURN res; END IF;
 lo:=CASE WHEN p_scope->'tables'='[]'::jsonb THEN '[]'::jsonb ELSE public.wa_reorganization_left_out(p_user,p_scope) END;
 IF res->>'status'='preview' THEN
  UPDATE public.whatsapp_reorganization_operations SET left_out=lo WHERE id=(res->>'operationId')::uuid AND user_id=p_user;
  RETURN res||jsonb_build_object('leftOut',lo);
 END IF;
 IF res->>'status'='blocked' AND jsonb_array_length(lo)>0 AND p_balance IS NULL THEN
  RETURN jsonb_build_object('status','nothing_eligible','leftOut',lo);
 END IF;
 RETURN res;
END $$;

CREATE OR REPLACE FUNCTION public.wa_reorganization_confirm_v2(p_user uuid,p_phone text,p_code text,p_operation uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE res jsonb; lo jsonb;
BEGIN
 res:=public.wa_reorganization_confirm(p_user,p_phone,p_code,p_operation);
 IF res->>'status' IN('applied','replay') THEN
  SELECT left_out INTO lo FROM public.whatsapp_reorganization_operations WHERE id=p_operation AND user_id=p_user;
  RETURN res||jsonb_build_object('leftOut',coalesce(lo,'[]'::jsonb));
 END IF;
 RETURN res;
END $$;

-- Restauração por voz: devolve o ID da limpeza aplicada mais recente do
-- titular ("restaurar última limpeza"). NÃO restaura nada — a restauração
-- segue o fluxo normal de prévia + código exclusivo (restore_prepare/control).
CREATE OR REPLACE FUNCTION public.wa_reorganization_last_applied(p_user uuid,p_phone text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op uuid;
BEGIN
 IF NOT public.wa_reorganization_authorized(p_user,p_phone) THEN RETURN NULL; END IF;
 SELECT o.id INTO op FROM public.whatsapp_reorganization_operations o
  WHERE o.user_id=p_user AND o.status='applied'
  ORDER BY o.completed_at DESC NULLS LAST, o.created_at DESC LIMIT 1;
 RETURN op;
END $$;

REVOKE ALL ON FUNCTION public.wa_reorganization_left_out_reason(uuid,jsonb),public.wa_reorganization_scope_rows(uuid,jsonb),public.wa_reorganization_snapshot(uuid,jsonb),public.wa_reorganization_left_out(uuid,jsonb),public.wa_reorganization_prepare_v2(uuid,text,text,jsonb,jsonb,text,jsonb),public.wa_reorganization_confirm_v2(uuid,text,text,uuid),public.wa_reorganization_last_applied(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_reorganization_prepare_v2(uuid,text,text,jsonb,jsonb,text,jsonb),public.wa_reorganization_confirm_v2(uuid,text,text,uuid),public.wa_reorganization_last_applied(uuid,text) TO service_role;
COMMIT;
