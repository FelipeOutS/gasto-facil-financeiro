-- CANDIDATA, nao aplicada. Depois de real-batch-import; sem autorizacao financeira.
ALTER TABLE public.pluggy_transactions ADD COLUMN IF NOT EXISTS bill_id text;
ALTER TABLE public.pluggy_transactions ADD COLUMN IF NOT EXISTS bill_due_date date;
-- Trigger separado: nao substitui a validacao financeira instalada pelo lote fechado.
CREATE FUNCTION public.pluggy_validate_real_card_link()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.pluggy_assert_owner(NEW.user_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('pluggy-import:'||NEW.user_id::text,0));
 IF TG_OP='UPDATE' AND (NEW.user_id,NEW.account_id) IS DISTINCT FROM (OLD.user_id,OLD.account_id) THEN RAISE EXCEPTION 'pluggy_identidade_imutavel'; END IF;
 -- Desativar vinculo antigo e permitido mesmo depois de desconectar a instituicao.
 IF TG_OP='UPDATE' AND NOT NEW.active AND NEW.cartao_id=OLD.cartao_id THEN RETURN NEW; END IF;
 PERFORM 1 FROM public.pluggy_accounts a JOIN public.pluggy_items i ON i.user_id=a.user_id AND i.item_id=a.item_id WHERE a.user_id=NEW.user_id AND a.account_id=NEW.account_id AND a.type='CREDIT' AND NOT a.is_sandbox AND NOT i.is_sandbox AND i.connector_id=606 AND i.deleted_at IS NULL FOR SHARE OF a,i;
 IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_conta_cartao_invalida'; END IF;
 PERFORM 1 FROM public.cartoes WHERE id=NEW.cartao_id AND user_id=NEW.user_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_cartao_invalido'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER pluggy_card_links_relationship ON public.pluggy_card_links;
CREATE TRIGGER pluggy_card_links_relationship BEFORE INSERT OR UPDATE ON public.pluggy_card_links FOR EACH ROW EXECUTE FUNCTION public.pluggy_validate_real_card_link();
CREATE FUNCTION public.pluggy_link_real_card(p_user_id uuid, p_account_id text, p_cartao_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.pluggy_assert_owner(p_user_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('pluggy-import:' || p_user_id::text, 0));
  IF p_cartao_id IS NULL THEN
    UPDATE public.pluggy_card_links SET active=false WHERE user_id=p_user_id AND account_id=p_account_id AND active;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pluggy_accounts a WHERE a.user_id = p_user_id AND a.account_id = p_account_id AND a.type = 'CREDIT' AND NOT a.is_sandbox AND EXISTS (SELECT 1 FROM public.pluggy_items i WHERE i.user_id=a.user_id AND i.item_id=a.item_id AND NOT i.is_sandbox AND i.connector_id=606 AND i.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'pluggy_conta_cartao_invalida' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cartoes c WHERE c.user_id = p_user_id AND c.id = p_cartao_id) THEN
    RAISE EXCEPTION 'pluggy_cartao_invalido' USING ERRCODE = '22023';
  END IF;
  -- Trocar o vínculo não move lançamentos já importados (continuam no cartão original).
  INSERT INTO public.pluggy_card_links (user_id, account_id, cartao_id) VALUES (p_user_id, p_account_id, p_cartao_id)
  ON CONFLICT (user_id, account_id) DO UPDATE SET cartao_id = EXCLUDED.cartao_id, active=true, confirmed_at = now();
END $$;
REVOKE ALL ON FUNCTION public.pluggy_validate_real_card_link(), public.pluggy_link_real_card(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pluggy_validate_real_card_link(), public.pluggy_link_real_card(uuid,text,uuid) TO service_role;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sandbox_exec') THEN EXECUTE 'REVOKE ALL ON FUNCTION public.pluggy_validate_real_card_link(), public.pluggy_link_real_card(uuid,text,uuid) FROM sandbox_exec'; END IF; END $$;
