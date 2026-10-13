-- CANDIDATA F4 — NÃO APLICAR sem aprovação. Depende da F2 (gastos.deleted_at).
-- Ordem futura: 1) gastos-soft-delete-f2.sql  2) whatsapp-undo-soft-delete.sql
--               3) ESTE arquivo  4) whatsapp-shopping-quota.sql
-- Objetivo: estorno de conta e reversão de extrato TUDO-OU-NADA, sem nunca
-- apagar gasto soft-excluído (que precisa poder ser restaurado).
-- SECURITY INVOKER: RLS de cada tabela vale; dono checado por auth.uid().
-- Idempotente (CREATE OR REPLACE). Rollback: DROP FUNCTION das duas (não toca dados).

CREATE OR REPLACE FUNCTION public.estornar_conta_gastos_atomic(p_conta_id uuid, p_gasto_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ids uuid[] := ARRAY(SELECT DISTINCT unnest(coalesce(p_gasto_ids, '{}'::uuid[])));
  v_conta record; v_lock int; v_del int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'login_required' USING ERRCODE = '42501'; END IF;
  SELECT id, status INTO v_conta FROM public.contas_a_pagar
   WHERE id = p_conta_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'conta_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_conta.status <> 'pago' THEN RETURN jsonb_build_object('ok', true, 'idempotent', true, 'removidos', 0); END IF;
  -- Trava todos os gastos alvo; após a espera, a releitura enxerga marcações confirmadas.
  SELECT count(*) INTO v_lock FROM (SELECT 1 FROM public.gastos
    WHERE id = ANY(v_ids) AND user_id = v_uid FOR UPDATE) s;
  IF v_lock <> cardinality(v_ids) THEN RAISE EXCEPTION 'gasto_not_owned_or_missing' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.gastos WHERE id = ANY(v_ids) AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'gasto_vinculado_excluido' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.gastos WHERE id = ANY(v_ids) AND user_id = v_uid AND deleted_at IS NULL;
  GET DIAGNOSTICS v_del = ROW_COUNT;
  IF v_del <> cardinality(v_ids) THEN RAISE EXCEPTION 'concorrencia' USING ERRCODE = '40001'; END IF;
  UPDATE public.contas_a_pagar SET status = 'pendente', data_pagamento = NULL, gasto_id = NULL, updated_at = now()
   WHERE id = p_conta_id AND user_id = v_uid;
  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'removidos', v_del);
END $$;

CREATE OR REPLACE FUNCTION public.reverter_extrato_atomic(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_ext record; v_n int; v_total int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'login_required' USING ERRCODE = '42501'; END IF;
  SELECT id, status INTO v_ext FROM public.extratos_importados
   WHERE id = p_batch_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'extrato_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_ext.status = 'revertido' THEN RETURN jsonb_build_object('ok', true, 'idempotent', true, 'removidos', 0); END IF;
  PERFORM 1 FROM public.gastos WHERE user_id = v_uid AND import_batch_id = p_batch_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.gastos WHERE user_id = v_uid AND import_batch_id = p_batch_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'lote_tem_gasto_excluido' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.gastos WHERE user_id = v_uid AND import_batch_id = p_batch_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
  DELETE FROM public.receitas WHERE user_id = v_uid AND import_batch_id = p_batch_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
  DELETE FROM public.transferencias_internas WHERE user_id = v_uid AND import_batch_id = p_batch_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
  DELETE FROM public.dinheiro_guardado WHERE user_id = v_uid AND import_batch_id = p_batch_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
  DELETE FROM public.movimentacoes_meta WHERE user_id = v_uid AND import_batch_id = p_batch_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
  UPDATE public.extratos_importados SET status = 'revertido', reverted_at = now(), updated_at = now()
   WHERE id = p_batch_id AND user_id = v_uid;
  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'removidos', v_total);
END $$;

REVOKE ALL ON FUNCTION public.estornar_conta_gastos_atomic(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverter_extrato_atomic(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estornar_conta_gastos_atomic(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverter_extrato_atomic(uuid) TO authenticated;
