-- CANDIDATO (não aplicado). Trava "somente prévia" da limpeza por WhatsApp.
-- Com preview_only=TRUE (padrão, e também quando a linha de política não existe)
-- a prévia funciona, mas NENHUMA execução/restauração grava, nem por chamada
-- direta às RPCs com código correto: o banco recusa (1) qualquer operação que
-- vire applied/partial/restored e (2) qualquer escrita financeira feita sob a
-- marca de mutação da reorganização. Desligar exige UPDATE explícito da política.
-- Dependências: whatsapp-reorganizacao, owner-allowlist, full-reset, post-reset-writers.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.whatsapp_reorganization_policy ADD COLUMN IF NOT EXISTS preview_only boolean NOT NULL DEFAULT true;
UPDATE public.whatsapp_reorganization_policy SET preview_only=true;

CREATE FUNCTION public.wa_reorganization_preview_only() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce((SELECT preview_only FROM public.whatsapp_reorganization_policy WHERE id),true)
$$;
REVOKE ALL ON FUNCTION public.wa_reorganization_preview_only() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.tg_wa_reorganization_preview_only_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.status IN('applied','partial','restored') AND public.wa_reorganization_preview_only() THEN
  RAISE EXCEPTION 'reorganization_preview_only'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.tg_wa_reorganization_preview_only_rows() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_setting('gi.reorganization_mutation',true)='on' AND public.wa_reorganization_preview_only() THEN
  RAISE EXCEPTION 'reorganization_preview_only'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_wa_reorganization_preview_only_status(),public.tg_wa_reorganization_preview_only_rows() FROM PUBLIC,anon,authenticated;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['whatsapp_reorganization_operations','whatsapp_reorganization_full_operations'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('CREATE TRIGGER wa_reorganization_preview_only BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_wa_reorganization_preview_only_status()',t);
  END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['gastos','receitas','faturas_cartao','contas_a_pagar','contas_a_receber','transferencias_internas','recorrencias'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('CREATE TRIGGER wa_reorganization_preview_only BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_wa_reorganization_preview_only_rows()',t);
  END IF;
 END LOOP;
END $$;
COMMIT;
