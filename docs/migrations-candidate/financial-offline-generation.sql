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
CREATE FUNCTION public.financial_offline_generation_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE current_generation bigint;
BEGIN
 IF NEW.offline_client_id IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||NEW.user_id::text,0));
 SELECT generation INTO current_generation FROM public.financial_write_generations WHERE user_id=NEW.user_id;
 IF coalesce(NEW.offline_generation,0)<>coalesce(current_generation,0) THEN RAISE EXCEPTION 'financial_generation_stale_review_required'; END IF;
 IF TG_OP='UPDATE' AND OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'offline_cannot_restore_deleted_entry'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.financial_offline_generation_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER financial_offline_generation_guard BEFORE INSERT OR UPDATE ON public.gastos FOR EACH ROW EXECUTE FUNCTION public.financial_offline_generation_guard();
CREATE TRIGGER financial_offline_generation_guard BEFORE INSERT OR UPDATE ON public.receitas FOR EACH ROW EXECUTE FUNCTION public.financial_offline_generation_guard();