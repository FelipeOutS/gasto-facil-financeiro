-- CANDIDATE ONLY. Apply before reorganization; never migrate financial facts in development.
-- Expense visibility does not reverse issuer charges or bank cash facts.
CREATE TABLE public.financial_card_facts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, cartao_id uuid NOT NULL REFERENCES public.cartoes(id) ON DELETE RESTRICT,
 cycle text NOT NULL, source_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN('charge','payment_snapshot','payment','accounting_reversal','bank_refund','charge_refund')),
 amount_cents bigint NOT NULL CHECK(amount_cents>=0), request_id text NOT NULL, effective_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,request_id)
);
GRANT SELECT ON public.financial_card_facts TO authenticated;
GRANT ALL ON public.financial_card_facts TO service_role;
ALTER TABLE public.financial_card_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_card_facts ON public.financial_card_facts FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE TABLE public.financial_cash_facts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, banco_id uuid NOT NULL REFERENCES public.bancos(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN('opening','income_received','expense_paid','adjustment','refund','accounting_reversal')),
 amount_cents bigint NOT NULL, request_id text NOT NULL, source_id uuid, effective_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,request_id)
);
GRANT SELECT ON public.financial_cash_facts TO authenticated;
GRANT ALL ON public.financial_cash_facts TO service_role;
ALTER TABLE public.financial_cash_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_cash_facts ON public.financial_cash_facts FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE FUNCTION public.financial_fact_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'financial_fact_immutable_append_compensation'; END $$;
REVOKE ALL ON FUNCTION public.financial_fact_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_card_facts BEFORE UPDATE OR DELETE ON public.financial_card_facts FOR EACH ROW EXECUTE FUNCTION public.financial_fact_immutable();
CREATE TRIGGER immutable_cash_facts BEFORE UPDATE OR DELETE ON public.financial_cash_facts FOR EACH ROW EXECUTE FUNCTION public.financial_fact_immutable();
CREATE FUNCTION public.financial_capture_card_history(p_user uuid,p_entries jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 -- Explicit snapshot provenance, NOT invented bank payment events.
 INSERT INTO public.financial_card_facts(user_id,cartao_id,cycle,source_id,kind,amount_cents,request_id)
 SELECT g.user_id,g.cartao_id,g.fatura_competencia,g.id,'charge',round(g.valor*100)::bigint,'charge:'||g.id
 FROM public.gastos g WHERE g.user_id=p_user AND g.cartao_id IN(SELECT (e->'row'->>'cartao_id')::uuid FROM jsonb_array_elements(p_entries) e)
 AND g.deleted_at IS NULL AND g.fatura_competencia IS NOT NULL ON CONFLICT(user_id,request_id) DO NOTHING;
 INSERT INTO public.financial_card_facts(user_id,cartao_id,cycle,source_id,kind,amount_cents,request_id)
 SELECT f.user_id,f.cartao_id,to_char(make_date(f.ano,f.mes,1)+make_interval(months=>CASE WHEN c.dia_vencimento<=c.dia_fechamento THEN 2 ELSE 1 END),'YYYY-MM'),f.id,'payment_snapshot',round(coalesce(f.valor_pago,0)*100)::bigint,'legacy-invoice:'||f.id
 FROM public.faturas_cartao f JOIN public.cartoes c ON c.id=f.cartao_id AND c.user_id=f.user_id WHERE f.user_id=p_user AND f.cartao_id IN(SELECT (e->'row'->>'cartao_id')::uuid FROM jsonb_array_elements(p_entries) e)
 AND coalesce(f.valor_pago,0)>0 ON CONFLICT(user_id,request_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.financial_capture_card_history(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.financial_cash_balance(p_user uuid,p_bank uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(sum(amount_cents),0)::bigint FROM public.financial_cash_facts WHERE user_id=p_user AND banco_id=p_bank
$$;
REVOKE ALL ON FUNCTION public.financial_cash_balance(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.financial_reconcile_current(p_user uuid,p_bank uuid,p_observed bigint,p_request text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE fact public.financial_cash_facts%ROWTYPE;
BEGIN
 IF p_observed IS NULL OR abs(p_observed)>=100000000000000 OR p_request IS NULL THEN RAISE EXCEPTION 'invalid_reconciliation'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.bancos WHERE user_id=p_user AND id=p_bank FOR SHARE) THEN RAISE EXCEPTION 'bank_owner_mismatch'; END IF;
 SELECT * INTO fact FROM public.financial_cash_facts WHERE user_id=p_user AND request_id=p_request;
 IF FOUND THEN IF fact.banco_id<>p_bank THEN RAISE EXCEPTION 'reconciliation_request_conflict'; END IF; RETURN fact.id; END IF;
 INSERT INTO public.financial_cash_facts(user_id,banco_id,kind,amount_cents,request_id)
 VALUES(p_user,p_bank,'adjustment',p_observed-public.financial_cash_balance(p_user,p_bank),p_request) RETURNING * INTO fact;
 RETURN fact.id;
END $$;
REVOKE ALL ON FUNCTION public.financial_reconcile_current(uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated,service_role;