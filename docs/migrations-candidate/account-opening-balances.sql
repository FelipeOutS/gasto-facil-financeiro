-- CANDIDATE ONLY: account baseline at end of reference day, NEVER income or reserve.
-- Not wired/released. Reorganization+balance must eventually share the same transaction.
CREATE TABLE public.account_opening_balances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
 banco_id uuid NOT NULL REFERENCES public.bancos(id) ON DELETE RESTRICT,
 amount_cents bigint NOT NULL CHECK(amount_cents>=0), effective_date date NOT NULL,
 request_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,banco_id), UNIQUE(user_id,request_id)
);
GRANT SELECT ON public.account_opening_balances TO authenticated;
GRANT ALL ON public.account_opening_balances TO service_role;
ALTER TABLE public.account_opening_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_opening_balance ON public.account_opening_balances FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE FUNCTION public.account_opening_balance_candidate(p_user uuid,p_bank uuid,p_amount bigint,p_date date,p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE existing public.account_opening_balances%ROWTYPE;
BEGIN
 IF p_amount IS NULL OR p_amount<0 OR p_amount>=100000000000000 OR p_date IS NULL OR p_request IS NULL OR length(p_request) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid_baseline'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.bancos WHERE id=p_bank AND user_id=p_user FOR SHARE) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 SELECT * INTO existing FROM public.account_opening_balances WHERE user_id=p_user AND (banco_id=p_bank OR request_id=p_request) FOR UPDATE;
 IF FOUND THEN
 IF existing.banco_id=p_bank AND existing.amount_cents=p_amount AND existing.effective_date=p_date AND existing.request_id=p_request THEN RETURN jsonb_build_object('status','replay','id',existing.id); END IF;
 RETURN jsonb_build_object('status','changed'); END IF;
 -- No replacement of an existing baseline, no INSERT into receitas, no guessed bank.
 INSERT INTO public.account_opening_balances(user_id,banco_id,amount_cents,effective_date,request_id) VALUES(p_user,p_bank,p_amount,p_date,p_request) RETURNING * INTO existing;
 RETURN jsonb_build_object('status','created','id',existing.id);
END $$;
-- Helper is not directly callable by any API role. Future authorized atomic executor only.
REVOKE ALL ON FUNCTION public.account_opening_balance_candidate(uuid,uuid,bigint,date,text) FROM PUBLIC,anon,authenticated,service_role;
