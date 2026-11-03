-- CANDIDATE ONLY: immutable financial facts accept inserts only from trusted routines/triggers.
CREATE FUNCTION public.financial_fact_insert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_user<>(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID) THEN RAISE EXCEPTION 'financial_fact_requires_authorized_routine'; END IF;
 IF TG_TABLE_NAME='financial_cash_facts' THEN
 IF NOT EXISTS(SELECT 1 FROM public.bancos WHERE id=NEW.banco_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'bank_owner_mismatch'; END IF;
 ELSE
 IF NOT EXISTS(SELECT 1 FROM public.cartoes WHERE id=NEW.cartao_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'card_owner_mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.financial_fact_insert_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guarded_cash_fact BEFORE INSERT ON public.financial_cash_facts FOR EACH ROW EXECUTE FUNCTION public.financial_fact_insert_guard();
CREATE TRIGGER guarded_card_fact BEFORE INSERT ON public.financial_card_facts FOR EACH ROW EXECUTE FUNCTION public.financial_fact_insert_guard();
CREATE FUNCTION public.financial_invoice_payment_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE delta bigint; old_paid bigint; invoice_cycle text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'invoice_history_delete_forbidden'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cartoes WHERE id=NEW.cartao_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'invoice_card_owner_mismatch'; END IF;
 IF TG_OP='UPDATE' AND (OLD.user_id,OLD.cartao_id,OLD.mes,OLD.ano) IS DISTINCT FROM (NEW.user_id,NEW.cartao_id,NEW.mes,NEW.ano) THEN RAISE EXCEPTION 'invoice_identity_immutable'; END IF;
 IF NEW.valor_pago IS NULL OR NEW.valor_pago<0 THEN RAISE EXCEPTION 'invalid_invoice_payment'; END IF;
 old_paid:=CASE WHEN TG_OP='UPDATE' THEN round(coalesce(OLD.valor_pago,0)*100)::bigint ELSE 0 END;
 delta:=round(NEW.valor_pago*100)::bigint-old_paid;
 SELECT to_char(make_date(NEW.ano,NEW.mes,1)+make_interval(months=>CASE WHEN c.dia_vencimento<=c.dia_fechamento THEN 2 ELSE 1 END),'YYYY-MM') INTO invoice_cycle FROM public.cartoes c WHERE c.id=NEW.cartao_id AND c.user_id=NEW.user_id;
 IF TG_OP='UPDATE' AND old_paid>0 AND NOT EXISTS(SELECT 1 FROM public.financial_card_facts f WHERE f.user_id=OLD.user_id AND f.source_id=OLD.id AND f.kind IN('payment_snapshot','payment')) THEN
 INSERT INTO public.financial_card_facts(user_id,cartao_id,cycle,source_id,kind,amount_cents,request_id)
 VALUES(OLD.user_id,OLD.cartao_id,invoice_cycle,OLD.id,'payment_snapshot',old_paid,'legacy-invoice:'||OLD.id) ON CONFLICT(user_id,request_id) DO NOTHING;
 END IF;
 -- Reducing a payment requires an explicit accounting reversal workflow, never a silent UPDATE.
 IF delta<0 THEN RAISE EXCEPTION 'explicit_payment_reversal_required'; END IF;
 IF delta>0 THEN
 INSERT INTO public.financial_card_facts(user_id,cartao_id,cycle,source_id,kind,amount_cents,request_id)
 VALUES(NEW.user_id,NEW.cartao_id,invoice_cycle,NEW.id,'payment',delta,'invoice-payment:'||NEW.id||':'||gen_random_uuid());
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.financial_invoice_payment_capture() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER invoice_payment_capture BEFORE INSERT OR UPDATE OR DELETE ON public.faturas_cartao FOR EACH ROW EXECUTE FUNCTION public.financial_invoice_payment_capture();