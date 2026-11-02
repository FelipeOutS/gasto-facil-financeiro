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

-- Reversão de extrato TUDO-OU-NADA com a MESMA semântica do fluxo seguro do site
-- (revertExtratoImportadoSeguro): gastos/receitas/transferências editados depois
-- da importação (updated_at - created_at > 5 s) são MANTIDOS; guardado e
-- movimentações de meta são sempre removidos; sobrou algo => status 'parcial',
-- senão 'revertido'. Lote com gasto soft-excluído => bloqueia tudo. Receita
-- soft-excluída não é apagada nem contada. Acesso: RLS do chamador (dono ou
-- conta conectada com permissão), como no app; nenhuma linha fora do lote.
-- Contagem divergente (RLS/concorrência) => exceção => ROLLBACK total.
CREATE OR REPLACE FUNCTION public.reverter_extrato_atomic(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid(); v_ext record; v_owner uuid; v_n int;
  v_g uuid[]; v_r uuid[]; v_t uuid[]; v_d uuid[]; v_m uuid[];
  v_mantidos int := 0; v_status text; v_tol interval := interval '5 seconds';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'login_required' USING ERRCODE = '42501'; END IF;
  SELECT id, user_id, status, to_jsonb(extratos_importados)->>'tipo_origem' AS tipo_origem INTO v_ext FROM public.extratos_importados
   WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'extrato_not_found' USING ERRCODE = 'P0002'; END IF;
  v_owner := v_ext.user_id;
  -- Autoridade no servidor: nunca confiar no cache/tipo informado pelo browser.
  IF v_ext.tipo_origem='pluggy'
     OR EXISTS (SELECT 1 FROM public.gastos WHERE user_id=v_owner AND import_batch_id=p_batch_id AND to_jsonb(gastos)->>'origem'='pluggy')
     OR EXISTS (SELECT 1 FROM public.receitas WHERE user_id=v_owner AND import_batch_id=p_batch_id AND to_jsonb(receitas)->>'origem'='pluggy') THEN
    RAISE EXCEPTION 'pluggy_reversao_generica_bloqueada' USING ERRCODE='42501';
  END IF;
  IF v_ext.status = 'revertido' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'removidos', 0, 'mantidos', 0,
      'status', 'revertido', 'ids', '[]'::jsonb);
  END IF;
  -- Trava todas as linhas do lote antes de decidir.
  PERFORM 1 FROM public.gastos WHERE user_id = v_owner AND import_batch_id = p_batch_id FOR UPDATE;
  PERFORM 1 FROM public.receitas WHERE user_id = v_owner AND import_batch_id = p_batch_id FOR UPDATE;
  PERFORM 1 FROM public.transferencias_internas WHERE user_id = v_owner AND import_batch_id = p_batch_id FOR UPDATE;
  PERFORM 1 FROM public.dinheiro_guardado WHERE user_id = v_owner AND import_batch_id = p_batch_id FOR UPDATE;
  PERFORM 1 FROM public.movimentacoes_meta WHERE user_id = v_owner AND import_batch_id = p_batch_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.gastos WHERE user_id = v_owner AND import_batch_id = p_batch_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'lote_tem_gasto_excluido' USING ERRCODE = 'P0001';
  END IF;

  v_g := ARRAY(SELECT id FROM public.gastos WHERE user_id = v_owner AND import_batch_id = p_batch_id
    AND deleted_at IS NULL AND NOT (updated_at IS NOT NULL AND created_at IS NOT NULL AND updated_at - created_at > v_tol));
  v_r := ARRAY(SELECT id FROM public.receitas WHERE user_id = v_owner AND import_batch_id = p_batch_id
    AND deleted_at IS NULL AND NOT (updated_at IS NOT NULL AND created_at IS NOT NULL AND updated_at - created_at > v_tol));
  v_t := ARRAY(SELECT id FROM public.transferencias_internas WHERE user_id = v_owner AND import_batch_id = p_batch_id
    AND NOT (updated_at IS NOT NULL AND created_at IS NOT NULL AND updated_at - created_at > v_tol));
  v_d := ARRAY(SELECT id FROM public.dinheiro_guardado WHERE user_id = v_owner AND import_batch_id = p_batch_id);
  v_m := ARRAY(SELECT id FROM public.movimentacoes_meta WHERE user_id = v_owner AND import_batch_id = p_batch_id);

  SELECT (SELECT count(*) FROM public.gastos WHERE user_id = v_owner AND import_batch_id = p_batch_id AND deleted_at IS NULL)
       + (SELECT count(*) FROM public.receitas WHERE user_id = v_owner AND import_batch_id = p_batch_id AND deleted_at IS NULL)
       + (SELECT count(*) FROM public.transferencias_internas WHERE user_id = v_owner AND import_batch_id = p_batch_id)
       - cardinality(v_g) - cardinality(v_r) - cardinality(v_t)
    INTO v_mantidos;

  DELETE FROM public.gastos WHERE id = ANY(v_g) AND user_id = v_owner AND import_batch_id = p_batch_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n <> cardinality(v_g) THEN RAISE EXCEPTION 'contagem_gastos' USING ERRCODE = '40001'; END IF;
  DELETE FROM public.receitas WHERE id = ANY(v_r) AND user_id = v_owner AND import_batch_id = p_batch_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n <> cardinality(v_r) THEN RAISE EXCEPTION 'contagem_receitas' USING ERRCODE = '40001'; END IF;
  DELETE FROM public.transferencias_internas WHERE id = ANY(v_t) AND user_id = v_owner AND import_batch_id = p_batch_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n <> cardinality(v_t) THEN RAISE EXCEPTION 'contagem_transferencias' USING ERRCODE = '40001'; END IF;
  DELETE FROM public.dinheiro_guardado WHERE id = ANY(v_d) AND user_id = v_owner AND import_batch_id = p_batch_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n <> cardinality(v_d) THEN RAISE EXCEPTION 'contagem_guardado' USING ERRCODE = '40001'; END IF;
  DELETE FROM public.movimentacoes_meta WHERE id = ANY(v_m) AND user_id = v_owner AND import_batch_id = p_batch_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n <> cardinality(v_m) THEN RAISE EXCEPTION 'contagem_movimentacoes' USING ERRCODE = '40001'; END IF;

  v_status := CASE WHEN v_mantidos > 0 THEN 'parcial' ELSE 'revertido' END;
  UPDATE public.extratos_importados SET status = v_status, reverted_at = now(), updated_at = now()
   WHERE id = p_batch_id AND user_id = v_owner;
  GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n <> 1 THEN RAISE EXCEPTION 'status_nao_atualizado' USING ERRCODE = '40001'; END IF;

  RETURN jsonb_build_object('ok', true, 'idempotent', false,
    'removidos', cardinality(v_g) + cardinality(v_r) + cardinality(v_t) + cardinality(v_d) + cardinality(v_m),
    'mantidos', v_mantidos, 'status', v_status,
    'ids', to_jsonb(v_g || v_r || v_t || v_d || v_m));
END $$;

REVOKE ALL ON FUNCTION public.estornar_conta_gastos_atomic(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverter_extrato_atomic(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estornar_conta_gastos_atomic(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverter_extrato_atomic(uuid) TO authenticated;
