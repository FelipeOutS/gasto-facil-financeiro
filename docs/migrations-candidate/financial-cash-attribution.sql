-- CANDIDATE ONLY. Bank assignment is explicit, never guessed from text/provider labels.
-- Existing rows remain unassigned; no historical income/payment provenance is invented.
ALTER TABLE public.gastos ADD COLUMN financial_bank_id uuid REFERENCES public.bancos(id) ON DELETE RESTRICT, ADD COLUMN cash_effective_at timestamptz;
ALTER TABLE public.receitas ADD COLUMN financial_bank_id uuid REFERENCES public.bancos(id) ON DELETE RESTRICT, ADD COLUMN cash_effective_at timestamptz;
CREATE FUNCTION public.financial_cash_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old_amount bigint; new_amount bigint; sign_value int; request_key text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||NEW.user_id::text,0));
 IF TG_OP='UPDATE' AND (OLD.user_id IS DISTINCT FROM NEW.user_id OR (OLD.cash_effective_at IS NOT NULL AND (OLD.financial_bank_id IS DISTINCT FROM NEW.financial_bank_id OR OLD.cash_effective_at IS DISTINCT FROM NEW.cash_effective_at))) THEN RAISE EXCEPTION 'cash_owner_or_account_immutable'; END IF;
 IF TG_TABLE_NAME='gastos' AND NEW.cash_effective_at IS NOT NULL AND to_jsonb(NEW)->>'forma_pagamento'='credito' THEN RAISE EXCEPTION 'credit_purchase_not_bank_payment'; END IF;
 -- Logical deletion/restoration changes display only, never real cash paid/received.
 IF TG_OP='UPDATE' AND OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
 IF (OLD.valor,OLD.financial_bank_id,OLD.cash_effective_at) IS DISTINCT FROM (NEW.valor,NEW.financial_bank_id,NEW.cash_effective_at) THEN RAISE EXCEPTION 'cash_visibility_cannot_change_payment'; END IF;
 RETURN NEW; END IF;
 IF NEW.cash_effective_at IS NULL AND NEW.financial_bank_id IS NULL THEN RETURN NEW; END IF;
 IF NEW.cash_effective_at IS NULL OR NEW.financial_bank_id IS NULL THEN RAISE EXCEPTION 'cash_bank_and_payment_date_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.bancos WHERE id=NEW.financial_bank_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'bank_owner_mismatch'; END IF;
 IF TG_TABLE_NAME='gastos' AND to_jsonb(NEW)->>'forma_pagamento'='credito' THEN RAISE EXCEPTION 'credit_purchase_not_bank_payment'; END IF;
 sign_value:=CASE WHEN TG_TABLE_NAME='receitas' THEN 1 ELSE -1 END;
 old_amount:=CASE WHEN TG_OP='UPDATE' AND OLD.cash_effective_at IS NOT NULL THEN round(OLD.valor*100)::bigint ELSE 0 END;
 new_amount:=round(NEW.valor*100)::bigint;
 IF old_amount=new_amount THEN RETURN NEW; END IF;
 request_key:=TG_TABLE_NAME||':'||NEW.id||':'||gen_random_uuid();
 INSERT INTO public.financial_cash_facts(user_id,banco_id,kind,amount_cents,request_id,source_id,effective_at)
 VALUES(NEW.user_id,NEW.financial_bank_id,CASE WHEN old_amount<>0 THEN 'accounting_reversal' WHEN TG_TABLE_NAME='receitas' THEN 'income_received' ELSE 'expense_paid' END,sign_value*(new_amount-old_amount),request_key,NEW.id,NEW.cash_effective_at);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.financial_cash_capture() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER financial_cash_capture BEFORE INSERT OR UPDATE ON public.gastos FOR EACH ROW EXECUTE FUNCTION public.financial_cash_capture();
CREATE TRIGGER financial_cash_capture BEFORE INSERT OR UPDATE ON public.receitas FOR EACH ROW EXECUTE FUNCTION public.financial_cash_capture();