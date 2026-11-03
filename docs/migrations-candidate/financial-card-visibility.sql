-- CANDIDATE ONLY. Requires financial-fact-ledger + base card helper.
-- Lifecycle hiding preserves creditor liability; never simulates a charge refund.
CREATE OR REPLACE FUNCTION public.wa_reorganization_card_supported(p_user uuid,p_row jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p_row->>'forma_pagamento'='credito'
 AND p_row->>'fatura_competencia' ~ '^\d{4}-(0[1-9]|1[0-2])$'
 AND coalesce((p_row->>'confirmado')::boolean,true)
 AND EXISTS(SELECT 1 FROM public.cartoes c WHERE c.user_id=p_user AND c.id=(p_row->>'cartao_id')::uuid)
 AND NOT EXISTS(SELECT 1 FROM public.faturas_cartao f WHERE f.user_id=p_user AND f.cartao_id=(p_row->>'cartao_id')::uuid AND (f.valor_pago<0 OR f.status NOT IN('aberta','fechada','vencida','paga')))
$$;
-- Existing base helper's ACL remains revoked. Only verified reset routines may call it.
CREATE FUNCTION public.financial_invoice_positions(p_user uuid)
RETURNS TABLE(cartao_id uuid,cycle text,charged_cents bigint,paid_cents bigint,pending_cents bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT f.cartao_id,f.cycle,
 sum(CASE WHEN f.kind='charge' THEN f.amount_cents WHEN f.kind='charge_refund' THEN -f.amount_cents ELSE 0 END)::bigint,
 sum(CASE WHEN f.kind IN('payment','payment_snapshot') THEN f.amount_cents WHEN f.kind IN('accounting_reversal','bank_refund') THEN -f.amount_cents ELSE 0 END)::bigint,
 greatest(0,sum(CASE WHEN f.kind='charge' THEN f.amount_cents WHEN f.kind='charge_refund' THEN -f.amount_cents WHEN f.kind IN('payment','payment_snapshot') THEN -f.amount_cents WHEN f.kind IN('accounting_reversal','bank_refund') THEN f.amount_cents ELSE 0 END))::bigint
 FROM public.financial_card_facts f WHERE f.user_id=p_user AND (auth.uid()=p_user OR current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.financial_card_facts'::regclass)) GROUP BY f.cartao_id,f.cycle
$$;
REVOKE ALL ON FUNCTION public.financial_invoice_positions(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.financial_invoice_positions(uuid) TO authenticated,service_role;