-- CANDIDATE ONLY. Apply/review together with reorganization, never independently activate reset.
-- Versioned writes serialize with reset. Old clients lacking a version fail closed after reset.
CREATE TABLE public.financial_write_generations (
 user_id uuid PRIMARY KEY, generation bigint NOT NULL DEFAULT 0 CHECK(generation>=0)
);
GRANT SELECT ON public.financial_write_generations TO authenticated;
GRANT ALL ON public.financial_write_generations TO service_role;
ALTER TABLE public.financial_write_generations ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_generation ON public.financial_write_generations FOR SELECT TO authenticated USING(user_id=auth.uid());
ALTER TABLE public.gastos ADD COLUMN offline_generation bigint;
ALTER TABLE public.receitas ADD COLUMN offline_generation bigint;
CREATE FUNCTION public.financial_assert_generation(p_user uuid,p_generation bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE stored bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 SELECT generation INTO stored FROM public.financial_write_generations WHERE user_id=p_user;
 IF coalesce(p_generation,0)<>coalesce(stored,0) THEN RAISE EXCEPTION 'financial_generation_stale_review_required'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.financial_assert_generation(uuid,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.financial_assert_generation(uuid,bigint) TO authenticated,service_role;
CREATE FUNCTION public.financial_offline_generation_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.offline_client_id IS NULL THEN RETURN NEW; END IF;
 -- Only trusted security-definer reset functions set this transaction-local marker.
 IF current_setting('gi.reorganization_mutation',true)='on' AND current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID) THEN RETURN NEW; END IF;
 PERFORM public.financial_assert_generation(NEW.user_id,NEW.offline_generation);
 IF TG_OP='UPDATE' AND OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'offline_cannot_restore_deleted_entry'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.financial_offline_generation_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER financial_offline_generation_guard BEFORE INSERT OR UPDATE ON public.gastos FOR EACH ROW EXECUTE FUNCTION public.financial_offline_generation_guard();
CREATE TRIGGER financial_offline_generation_guard BEFORE INSERT OR UPDATE ON public.receitas FOR EACH ROW EXECUTE FUNCTION public.financial_offline_generation_guard();