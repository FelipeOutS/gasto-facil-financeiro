-- SOMENTE LEITURA. Interrompe se algum objeto do pacote já existir ou se houver dado que o pacote não espera.
DO $$ DECLARE bad text[]:='{}'; BEGIN
 IF to_regclass('public.financial_write_generations') IS NOT NULL THEN bad:=bad||'financial_write_generations'; END IF;
 IF to_regclass('public.whatsapp_reorganization_policy') IS NOT NULL THEN bad:=bad||'whatsapp_reorganization_policy'; END IF;
 IF to_regclass('public.whatsapp_reorganization_full_operations') IS NOT NULL THEN bad:=bad||'whatsapp_reorganization_full_operations'; END IF;
 IF to_regprocedure('public.whatsapp_entry_mutate_v2(uuid,text,text,uuid,timestamptz,text,jsonb)') IS NOT NULL THEN bad:=bad||'whatsapp_entry_mutate_v2'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gastos' AND column_name IN('deletion_batch_id','offline_generation')) THEN bad:=bad||'gastos_columns'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='faturas_cartao' AND column_name='reorg_archived_at') THEN bad:=bad||'reorg_archived_at'; END IF;
 IF EXISTS(SELECT 1 FROM public.gastos WHERE user_id IS NULL) OR EXISTS(SELECT 1 FROM public.receitas WHERE user_id IS NULL) THEN bad:=bad||'rows_without_owner'; END IF;
 IF cardinality(bad)>0 THEN RAISE EXCEPTION 'preflight_failed: %',bad; END IF;
 RAISE NOTICE 'PASS: preflight: nothing from the package exists yet';
END $$;
