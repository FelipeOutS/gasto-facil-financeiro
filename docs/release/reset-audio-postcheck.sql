-- SOMENTE LEITURA. Confirma que tudo nasceu desligado e restrito.
DO $$ BEGIN
 IF coalesce((SELECT release_enabled FROM public.whatsapp_reorganization_policy WHERE id),false) THEN RAISE EXCEPTION 'postcheck: release_enabled is on'; END IF;
 IF NOT public.wa_reorganization_preview_only() THEN RAISE EXCEPTION 'postcheck: preview_only is off'; END IF;
 IF EXISTS(SELECT 1 FROM public.whatsapp_reorganization_allowlist) THEN RAISE EXCEPTION 'postcheck: allowlist not empty'; END IF;
 IF EXISTS(SELECT 1 FROM public.whatsapp_reorganization_operations) OR EXISTS(SELECT 1 FROM public.whatsapp_reorganization_full_operations) THEN RAISE EXCEPTION 'postcheck: operations exist'; END IF;
 IF EXISTS(SELECT 1 FROM public.financial_write_generations WHERE generation>0) THEN RAISE EXCEPTION 'postcheck: generation advanced'; END IF;
 IF has_function_privilege('authenticated','public.wa_full_reset_confirm(uuid,text,text,uuid)','EXECUTE')
 OR has_function_privilege('anon','public.wa_full_reset_confirm(uuid,text,text,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.wa_reorganization_confirm(uuid,text,text,uuid)','EXECUTE') THEN RAISE EXCEPTION 'postcheck: confirm callable by app users'; END IF;
 RAISE NOTICE 'PASS: postcheck: release off, preview-only on, allowlist empty, no operations, confirm callable only by server';
END $$;
