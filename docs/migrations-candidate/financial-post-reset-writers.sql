-- CANDIDATO (não aplicado). Uso normal depois de "zerar tudo".
-- Substitui a quarentena das travas universal/vinculada: após a limpeza o
-- titular volta a lançar gastos, receitas, cartões, faturas, contas e
-- movimentações pelo site e pelo WhatsApp, sem erro.
--  * Escritor online (sem offline_client_id) recebe a geração atual carimbada:
--    é um lançamento novo, nunca confundido com os ocultados (id próprio,
--    sem marca de exclusão/arquivamento, fora do diário da limpeza).
--  * Fila offline continua precisando da geração vigente (fila antiga à limpeza
--    é recusada para revisão).
--  * Registros ocultados/arquivados pela limpeza seguem imutáveis fora das
--    funções confiáveis, e nada que esteja numa limpeza aplicada pode ser
--    apagado fisicamente (a restauração depende deles).
--  * Reimportação de lançamento zerado continua barrada pelas lápides.
-- Dependências: financial-universal-fence, financial-linked-writer-fence,
-- whatsapp-reorganizacao-full-reset.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regclass('public.whatsapp_reorganization_full_journal') IS NULL
 OR to_regprocedure('public.financial_universal_fence()') IS NULL
 OR to_regprocedure('public.financial_linked_writer_fence()') IS NULL
 THEN RAISE EXCEPTION 'post_reset_prerequisites_missing'; END IF;
END $$;

CREATE FUNCTION public.financial_row_in_applied_reset(p_table text,p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.whatsapp_reorganization_full_journal j
  JOIN public.whatsapp_reorganization_full_operations o ON o.id=j.operation_id
  WHERE j.table_name=p_table AND j.row_id=p_id AND o.status='applied')
$$;
REVOKE ALL ON FUNCTION public.financial_row_in_applied_reset(text,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.financial_offline_generation_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.offline_client_id IS NULL THEN RETURN NEW; END IF;
 IF current_setting('gi.reorganization_mutation',true)='on' AND current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID) THEN RETURN NEW; END IF;
 -- Edição online de um lançamento que nasceu offline (mesma geração gravada): não é replay de fila.
 IF TG_OP='UPDATE' AND NEW.offline_client_id IS NOT DISTINCT FROM OLD.offline_client_id AND NEW.offline_generation IS NOT DISTINCT FROM OLD.offline_generation THEN
  IF OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'offline_cannot_restore_deleted_entry'; END IF;
  RETURN NEW;
 END IF;
 PERFORM public.financial_assert_generation(NEW.user_id,NEW.offline_generation);
 IF TG_OP='UPDATE' AND OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'offline_cannot_restore_deleted_entry'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.financial_universal_fence()
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
  IF OLD.deleted_at IS NOT NULL OR public.financial_row_in_applied_reset(TG_TABLE_NAME,OLD.id) THEN RAISE EXCEPTION 'financial_physical_delete_forbidden'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'financial_tombstone_immutable'; END IF;
 IF TG_OP='UPDATE' AND OLD.offline_client_id IS DISTINCT FROM NEW.offline_client_id THEN RAISE EXCEPTION 'financial_writer_requires_operation_context'; END IF;
 IF NEW.offline_client_id IS NULL THEN
  -- Lançamento/edição online: pertence à geração vigente.
  NEW.offline_generation:=version; RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND NEW.offline_generation IS NOT DISTINCT FROM OLD.offline_generation THEN RETURN NEW; END IF;
 PERFORM public.financial_assert_generation(owner_id,NEW.offline_generation);
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.financial_linked_writer_fence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE owner_id uuid; trusted boolean;
BEGIN
 owner_id:=CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
 IF TG_OP='UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'financial_owner_reassignment_forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||owner_id::text,0));
 trusted:=current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID) AND current_setting('gi.reorganization_mutation',true)='on';
 IF trusted THEN IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
 -- Arquivado pela limpeza: só a restauração mexe (vale também para service role).
 IF TG_OP IN('UPDATE','DELETE') AND to_jsonb(OLD)->>'reorg_archived_at' IS NOT NULL THEN RAISE EXCEPTION 'archived_by_reset_immutable'; END IF;
 IF TG_OP IN('INSERT','UPDATE') AND (to_jsonb(NEW)->>'reorg_archived_at' IS NOT NULL OR to_jsonb(NEW)->>'reorg_batch_id' IS NOT NULL) THEN RAISE EXCEPTION 'archived_by_reset_immutable'; END IF;
 IF TG_OP='DELETE' AND public.financial_row_in_applied_reset(TG_TABLE_NAME,OLD.id) THEN RAISE EXCEPTION 'financial_physical_delete_forbidden'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
COMMIT;
