-- CANDIDATE ONLY. Requires F2 and whatsapp-reorganizacao.sql. Never changes payments.
-- Unpaid, uniquely mapped single purchases only. Paid/partial/unknown states fail closed.
CREATE FUNCTION public.wa_reorganization_card_supported(p_user uuid,p_row jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p_row->>'forma_pagamento'='credito'
 AND p_row->>'fatura_competencia' ~ '^\d{4}-(0[1-9]|1[0-2])$'
 AND coalesce((p_row->>'confirmado')::boolean,true)
 AND EXISTS(SELECT 1 FROM public.cartoes c WHERE c.user_id=p_user AND c.id=(p_row->>'cartao_id')::uuid)
 AND NOT EXISTS(SELECT 1 FROM public.faturas_cartao f JOIN public.cartoes c ON c.id=f.cartao_id AND c.user_id=f.user_id
 WHERE f.user_id=p_user AND f.cartao_id=(p_row->>'cartao_id')::uuid
 AND to_char(make_date(f.ano,f.mes,1)+make_interval(months=>CASE WHEN c.dia_vencimento<=c.dia_fechamento THEN 2 ELSE 1 END),'YYYY-MM')=p_row->>'fatura_competencia'
 AND (f.status NOT IN('aberta','fechada','vencida') OR f.valor_pago<>0 OR f.data_pagamento IS NOT NULL))
$$;
CREATE FUNCTION public.wa_reorganization_card_snapshot(p_user uuid,p_entries jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('cards',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.cartoes c
 WHERE c.user_id=p_user AND c.id IN(SELECT (x->'row'->>'cartao_id')::uuid FROM jsonb_array_elements(p_entries) x WHERE x->'row'->>'cartao_id' IS NOT NULL)),'[]'),
 'invoices',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM public.faturas_cartao f
 WHERE f.user_id=p_user AND f.cartao_id IN(SELECT (x->'row'->>'cartao_id')::uuid FROM jsonb_array_elements(p_entries) x WHERE x->'row'->>'cartao_id' IS NOT NULL)),'[]'))
$$;
REVOKE ALL ON FUNCTION public.wa_reorganization_card_supported(uuid,jsonb),public.wa_reorganization_card_snapshot(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;