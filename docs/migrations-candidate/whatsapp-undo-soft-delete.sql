-- CANDIDATO INATIVO — revisão 2026-10-25. Não aplicar sem aprovação específica.
-- Pré-requisitos: F2/F3 (deleted_at), updated_at em gastos/receitas,
-- whatsapp_recent_actions, whatsapp_links, has_feature_access, recorrencias e contas_a_pagar.
-- Mantém identidade, consentimento e plano; bloqueia edição posterior à ação.
-- Soft-delete preserva a linha; não apaga registros financeiros fisicamente.
-- RPC v2 evita que código novo invoque silenciosamente o SQL antigo inseguro.
-- Aplicar integralmente em uma transação; grants somente service_role.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.whatsapp_entry_mutate_v2(uuid,text,text,uuid,timestamptz,text,text)') IS NULL THEN RAISE EXCEPTION 'entry_mutations_v2_required'; END IF;
 IF current_user <> (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.gastos'::regclass) THEN RAISE EXCEPTION 'execute_as_gastos_owner'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.whatsapp_undo_recent_action_v2(
  p_user_id uuid, p_phone text, p_action_id uuid, p_scope text DEFAULT 'single'
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_action public.whatsapp_recent_actions%ROWTYPE;
  v_gasto public.gastos%ROWTYPE;
  v_receita public.receitas%ROWTYPE;
  v_recorrencia public.recorrencias%ROWTYPE;
  v_count integer;
BEGIN
  IF p_user_id IS NULL OR nullif(p_phone, '') IS NULL OR p_action_id IS NULL THEN
    RETURN 'unavailable';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user_id::text,0));
  PERFORM 1 FROM public.whatsapp_links WHERE user_id=p_user_id FOR SHARE;
  IF NOT EXISTS(SELECT 1 FROM public.whatsapp_links l WHERE l.user_id=p_user_id
    AND regexp_replace(l.telefone,'\D','','g')=regexp_replace(p_phone,'\D','','g')
    AND l.ativo AND l.opt_in_em IS NOT NULL AND l.revogado_em IS NULL)
    OR NOT coalesce(public.has_feature_access(p_user_id,'whatsapp'),false) THEN RETURN 'unavailable'; END IF;
  SELECT * INTO v_action FROM public.whatsapp_recent_actions
  WHERE id = p_action_id AND user_id = p_user_id AND telefone = p_phone
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unavailable'; END IF;
  IF v_action.state = 'undone' THEN RETURN 'already_undone'; END IF;
  IF v_action.expires_at <= now() THEN RETURN 'expired'; END IF;

  IF v_action.entity_kind IN ('expense', 'installment') THEN
    SELECT * INTO v_gasto FROM public.gastos
    WHERE id = v_action.entity_id AND user_id = p_user_id AND origem = 'whatsapp'
    FOR UPDATE;
    IF NOT FOUND THEN RETURN 'unavailable'; END IF;
    -- P0 soft-delete: gasto marcado nunca sofre DELETE físico; a ação continua 'active'.
    IF to_jsonb(v_gasto)->>'import_batch_id' IS NOT NULL OR to_jsonb(v_gasto)->>'bem_id' IS NOT NULL THEN RETURN 'unavailable'; END IF;
    IF v_gasto.deleted_at IS NOT NULL THEN RETURN 'soft_deleted'; END IF;
    IF (to_jsonb(v_gasto)->>'updated_at') IS NULL OR (to_jsonb(v_gasto)->>'updated_at')::timestamptz > v_action.created_at THEN RETURN 'modified'; END IF;
    IF v_action.entity_kind = 'expense' THEN
      IF v_gasto.grupo_parcelamento_id IS NOT NULL OR v_gasto.recorrencia_id IS NOT NULL
         OR coalesce(v_gasto.total_parcelas, 1) > 1 THEN RETURN 'unavailable'; END IF;
      IF NOT coalesce(public.has_feature_access(p_user_id,'whatsapp'),false) THEN RETURN 'unavailable'; END IF;
      UPDATE public.contas_a_pagar SET status = 'pendente', data_pagamento = NULL, gasto_id = NULL
      WHERE user_id = p_user_id AND gasto_id = v_gasto.id;
      PERFORM set_config('gi.gastos_soft_delete','on',true);
      UPDATE public.gastos SET deleted_at = now(), deleted_by=p_user_id, deletion_batch_id=p_action_id, deletion_source='whatsapp', updated_at=clock_timestamp() WHERE id = v_gasto.id AND user_id = p_user_id
        AND deleted_at IS NULL;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      PERFORM set_config('gi.gastos_soft_delete','off',true);
      IF v_count <> 1 THEN RAISE EXCEPTION 'expense reversal mismatch'; END IF;
    ELSE
      IF v_action.related_id IS NULL OR v_gasto.grupo_parcelamento_id IS DISTINCT FROM v_action.related_id THEN
        RETURN 'unavailable';
      END IF;
      -- Trava a série inteira antes de contar (serializa com o soft-delete F2).
      PERFORM 1 FROM public.gastos
      WHERE user_id = p_user_id AND grupo_parcelamento_id = v_action.related_id
      FOR UPDATE;
      IF EXISTS (SELECT 1 FROM public.gastos WHERE user_id = p_user_id
        AND grupo_parcelamento_id = v_action.related_id AND deleted_at IS NOT NULL) THEN
        RETURN 'soft_deleted';
      END IF;
      IF EXISTS (SELECT 1 FROM public.gastos g WHERE g.user_id = p_user_id
        AND g.grupo_parcelamento_id = v_action.related_id
        AND ((to_jsonb(g)->>'updated_at') IS NULL OR (to_jsonb(g)->>'updated_at')::timestamptz > v_action.created_at)) THEN RETURN 'modified'; END IF;
      IF EXISTS(SELECT 1 FROM public.gastos g WHERE g.user_id=p_user_id AND g.grupo_parcelamento_id=v_action.related_id AND (to_jsonb(g)->>'import_batch_id' IS NOT NULL OR to_jsonb(g)->>'bem_id' IS NOT NULL)) THEN RETURN 'unavailable'; END IF;
      SELECT count(*) INTO v_count FROM public.gastos
      WHERE user_id = p_user_id AND grupo_parcelamento_id = v_action.related_id
        AND origem = 'whatsapp';
      IF v_count <> v_gasto.total_parcelas OR v_count < 2 THEN RETURN 'unavailable'; END IF;
      IF NOT coalesce(public.has_feature_access(p_user_id,'whatsapp'),false) THEN RETURN 'unavailable'; END IF;
      UPDATE public.contas_a_pagar SET status = 'pendente', data_pagamento = NULL, gasto_id = NULL
      WHERE user_id = p_user_id AND gasto_id IN (
        SELECT id FROM public.gastos WHERE user_id = p_user_id
          AND grupo_parcelamento_id = v_action.related_id);
      PERFORM set_config('gi.gastos_soft_delete','on',true);
      UPDATE public.gastos SET deleted_at = now(), deleted_by=p_user_id, deletion_batch_id=p_action_id, deletion_source='whatsapp', updated_at=clock_timestamp() WHERE user_id = p_user_id
        AND grupo_parcelamento_id = v_action.related_id AND origem = 'whatsapp'
        AND deleted_at IS NULL;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      PERFORM set_config('gi.gastos_soft_delete','off',true);
      IF v_count <> v_gasto.total_parcelas THEN
        RAISE EXCEPTION 'installment reversal mismatch';
      END IF;
    END IF;
  ELSE
    SELECT * INTO v_receita FROM public.receitas
    WHERE id = v_action.entity_id AND user_id = p_user_id AND origem = 'whatsapp'
      AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN 'unavailable'; END IF;
    IF (to_jsonb(v_receita)->>'updated_at') IS NULL OR (to_jsonb(v_receita)->>'updated_at')::timestamptz > v_action.created_at THEN RETURN 'modified'; END IF;
    IF to_jsonb(v_receita)->>'import_batch_id' IS NOT NULL THEN RETURN 'unavailable'; END IF;
    IF v_action.entity_kind = 'income' THEN
      IF v_receita.recorrencia_id IS NOT NULL THEN RETURN 'unavailable'; END IF;
      IF NOT coalesce(public.has_feature_access(p_user_id,'whatsapp'),false) THEN RAISE EXCEPTION 'permission_revoked'; END IF;
      UPDATE public.receitas SET deleted_at = now(), deleted_source='whatsapp', deleted_reason='undo_recent_action', updated_at=clock_timestamp() WHERE id = v_receita.id AND user_id = p_user_id;
    ELSE
      IF v_action.related_id IS NULL OR v_receita.recorrencia_id IS DISTINCT FROM v_action.related_id THEN
        RETURN 'unavailable';
      END IF;
      IF p_scope NOT IN ('occurrence', 'series') THEN RETURN 'choose_scope'; END IF;
      SELECT * INTO v_recorrencia FROM public.recorrencias
      WHERE id = v_action.related_id AND user_id = p_user_id AND origem = 'whatsapp' FOR UPDATE;
      IF NOT FOUND THEN RETURN 'unavailable'; END IF;
      IF p_scope = 'series' THEN
        UPDATE public.recorrencias SET status = 'cancelada'
        WHERE id = v_recorrencia.id AND user_id = p_user_id AND status = 'ativa';
        IF NOT FOUND THEN RETURN 'unavailable'; END IF;
      END IF;
      -- Only the occurrence created by this WhatsApp operation is removed.
      -- Other historical occurrences are never erased implicitly.
      IF NOT coalesce(public.has_feature_access(p_user_id,'whatsapp'),false) THEN RAISE EXCEPTION 'permission_revoked'; END IF;
      UPDATE public.receitas SET deleted_at = now(), deleted_source='whatsapp', deleted_reason='undo_recent_action', updated_at=clock_timestamp() WHERE id = v_receita.id AND user_id = p_user_id;
    END IF;
  END IF;
  UPDATE public.whatsapp_recent_actions
  SET state = 'undone', undone_at = now(), edit_state = 'idle', pending_patch = NULL
  WHERE id = v_action.id;
  INSERT INTO public.audit_logs(actor_user_id,action,target_user_id,entity_type,entity_id,metadata) VALUES(p_user_id,'whatsapp_undo_v2',p_user_id,v_action.entity_kind,v_action.entity_id::text,jsonb_build_object('action_id',p_action_id,'scope',p_scope));
  RETURN 'undone';
END;
$$;
REVOKE ALL ON FUNCTION public.whatsapp_undo_recent_action_v2(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_undo_recent_action_v2(uuid,text,uuid,text) TO service_role;
-- Legacy entry point delegates to the same protected implementation, never physical deletion.
CREATE OR REPLACE FUNCTION public.whatsapp_undo_recent_action(p_user_id uuid,p_phone text,p_action_id uuid,p_scope text DEFAULT 'single')
RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT public.whatsapp_undo_recent_action_v2(p_user_id,p_phone,p_action_id,p_scope);
$$;
REVOKE ALL ON FUNCTION public.whatsapp_undo_recent_action(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_undo_recent_action(uuid,text,uuid,text) TO service_role;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='whatsapp_undo_recent_action_v2' AND p.proowner<>(SELECT relowner FROM pg_class WHERE oid='public.gastos'::regclass)) THEN RAISE EXCEPTION 'rpc_owner_mismatch'; END IF;
END $$;
COMMIT;
