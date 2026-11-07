-- CANDIDATE ONLY. No activation. Quarantine legacy writers after the first reset.
-- Deliberately denies non-offline unversioned writers, including service-role writers.
-- This is NOT automatic reversioning of old provider jobs into new operations.
CREATE FUNCTION public.financial_current_generation(p_user uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce((SELECT generation FROM public.financial_write_generations WHERE user_id=p_user),0)
$$;
REVOKE ALL ON FUNCTION public.financial_current_generation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.financial_current_generation(uuid) TO authenticated,service_role;
CREATE FUNCTION public.financial_universal_fence()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE owner_id uuid; version bigint; privileged boolean;
BEGIN
 owner_id:=CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
 IF TG_OP='UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'financial_owner_reassignment_forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||owner_id::text,0));
 version:=public.financial_current_generation(owner_id);
 privileged:=current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
 AND current_setting('gi.reorganization_mutation',true)='on';
 IF privileged THEN IF TG_OP='DELETE' THEN RAISE EXCEPTION 'reorganization_physical_delete_forbidden'; END IF; RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN
 IF OLD.deleted_at IS NOT NULL OR coalesce(version,0)>0 THEN RAISE EXCEPTION 'financial_physical_delete_forbidden'; END IF;
 RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'financial_tombstone_immutable'; END IF;
 IF coalesce(version,0)>0 AND (NEW.offline_client_id IS NULL OR (TG_OP='UPDATE' AND OLD.offline_client_id IS DISTINCT FROM NEW.offline_client_id)) THEN
 RAISE EXCEPTION 'financial_writer_requires_operation_context'; END IF;
 PERFORM public.financial_assert_generation(owner_id,NEW.offline_generation);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.financial_universal_fence() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER financial_universal_fence BEFORE INSERT OR UPDATE OR DELETE ON public.gastos FOR EACH ROW EXECUTE FUNCTION public.financial_universal_fence();
CREATE TRIGGER financial_universal_fence BEFORE INSERT OR UPDATE OR DELETE ON public.receitas FOR EACH ROW EXECUTE FUNCTION public.financial_universal_fence();
-- Guard executes with caller identity, generation lookup uses a narrow definer helper.
-- A dedicated full writer registry is required before releasing linked modules.