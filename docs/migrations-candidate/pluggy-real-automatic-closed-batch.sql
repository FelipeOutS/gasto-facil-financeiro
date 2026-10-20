-- Preferencia real independente do Sandbox; desligada por padrao.
ALTER TABLE public.pluggy_settings ADD COLUMN real_auto_import boolean NOT NULL DEFAULT false;
ALTER TABLE public.pluggy_settings ADD COLUMN real_auto_consented_at timestamptz;
-- CANDIDATA: nao ativa automacao, nao cria grants e nao altera trava global.
-- Requer pluggy-real-batch-import.sql verificado. Restricao Felipe permanece na RPC interna.
CREATE FUNCTION public.pluggy_import_apply_real_automatic(p_user_id uuid, p_batch_id uuid, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.pluggy_assert_owner(p_user_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('pluggy-import:' || p_user_id::text,0));
  PERFORM 1 FROM public.pluggy_settings WHERE user_id=p_user_id AND real_auto_import=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_automatico_nao_autorizado' USING ERRCODE='42501'; END IF;
  RETURN public.pluggy_import_apply_real_batch(p_user_id,p_batch_id,p_rows);
END $$;
REVOKE ALL ON FUNCTION public.pluggy_import_apply_real_automatic(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pluggy_import_apply_real_automatic(uuid,uuid,jsonb) TO service_role;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sandbox_exec') THEN
EXECUTE 'REVOKE ALL ON FUNCTION public.pluggy_import_apply_real_automatic(uuid,uuid,jsonb) FROM sandbox_exec';
END IF; END $$;

CREATE FUNCTION public.pluggy_set_real_automatic(p_user_id uuid,p_enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_user_id IS DISTINCT FROM '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid OR p_enabled IS NULL THEN RAISE EXCEPTION 'pluggy_nao_autorizado' USING ERRCODE='42501'; END IF;
 PERFORM public.pluggy_assert_owner(p_user_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('pluggy-import:'||p_user_id::text,0));
 UPDATE public.pluggy_settings SET real_auto_import=p_enabled,real_auto_consented_at=CASE WHEN p_enabled THEN now() ELSE real_auto_consented_at END WHERE user_id=p_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'historico_nao_escolhido'; END IF;
 RETURN p_enabled;
END $$;
REVOKE ALL ON FUNCTION public.pluggy_set_real_automatic(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pluggy_set_real_automatic(uuid,boolean) TO service_role;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sandbox_exec') THEN EXECUTE 'REVOKE ALL ON FUNCTION public.pluggy_set_real_automatic(uuid,boolean) FROM sandbox_exec'; END IF; END $$;
