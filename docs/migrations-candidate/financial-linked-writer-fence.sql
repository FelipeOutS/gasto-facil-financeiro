-- CANDIDATE ONLY. All discovered mutable linked financial tables are quarantined after reset.
-- This protects data but deliberately does NOT make unversioned legacy writers compatible.
CREATE FUNCTION public.financial_linked_writer_fence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE owner_id uuid; trusted boolean;
BEGIN
 owner_id:=CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
 IF TG_OP='UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'financial_owner_reassignment_forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||owner_id::text,0));
 trusted:=current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID) AND current_setting('gi.reorganization_mutation',true)='on';
 IF public.financial_current_generation(owner_id)>0 AND NOT trusted THEN RAISE EXCEPTION 'linked_writer_requires_transaction_context'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.financial_linked_writer_fence() FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE relation_name text; BEGIN
 FOREACH relation_name IN ARRAY ARRAY['cartoes','faturas_cartao','transferencias_internas','contas_a_pagar','contas_a_receber','recorrencias','bens','bens_pagamentos','bens_financiamentos','bens_amortizacoes','bens_custos_aquisicao','dinheiro_guardado','movimentacoes_meta','investimentos_movimentacoes','investimentos_rendimentos','extratos_importados'] LOOP
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=relation_name AND column_name='user_id') THEN
 EXECUTE format('CREATE TRIGGER financial_linked_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.financial_linked_writer_fence()',relation_name);
 END IF;
 END LOOP;
END $$;