-- Fase 1E-B2E-B — Limite de itens por lista para free_ads
-- Trigger BEFORE INSERT OR UPDATE em mercado_listas que bloqueia
-- listas com mais de 30 itens (entries jsonb) APENAS para plano free_ads.
-- Demais planos (pago, admin, sem assinatura) seguem inalterados.

CREATE OR REPLACE FUNCTION public.tg_free_ads_quota_mercado_listas_itens()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.current_plan(NEW.user_id) <> 'free_ads'::public.plan_tier THEN
    RETURN NEW;
  END IF;
  IF NEW.entries IS NULL THEN
    RETURN NEW;
  END IF;
  v_count := jsonb_array_length(NEW.entries);
  IF v_count > 30 THEN
    RAISE EXCEPTION 'free_ads_quota_exceeded:mercado_itens_lista'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS free_ads_quota_mercado_listas_itens ON public.mercado_listas;
CREATE TRIGGER free_ads_quota_mercado_listas_itens
BEFORE INSERT OR UPDATE OF entries ON public.mercado_listas
FOR EACH ROW
EXECUTE FUNCTION public.tg_free_ads_quota_mercado_listas_itens();