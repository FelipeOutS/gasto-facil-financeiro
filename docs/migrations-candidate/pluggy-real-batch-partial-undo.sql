-- CANDIDATA. Requer lote fechado verificado. Nao cria autorizacoes nem libera a trava global.
-- Selecao explicita, atomica, isolamento por titular/lote e preservacao de edicoes.
CREATE FUNCTION public.pluggy_import_revert_real_batch_items(p_user_id uuid, p_batch_id uuid, p_entry_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b record; ent record; cur record; n_rev int := 0; n_kept int := 0; n_remaining int := 0;
BEGIN
  IF p_user_id IS DISTINCT FROM '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid THEN
    RAISE EXCEPTION 'pluggy_nao_autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM public.pluggy_assert_owner(p_user_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('pluggy-import:' || p_user_id::text, 0));
  SELECT * INTO b FROM public.pluggy_real_batch_grants WHERE user_id = p_user_id AND batch_id = p_batch_id AND consumed_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_lote_inexistente' USING ERRCODE = '22023'; END IF;
  IF p_entry_ids IS NULL OR cardinality(p_entry_ids) NOT BETWEEN 1 AND 10
    OR (SELECT count(DISTINCT x) FROM unnest(p_entry_ids) x) <> cardinality(p_entry_ids)
    OR EXISTS (SELECT 1 FROM unnest(p_entry_ids) x WHERE NOT EXISTS (
      SELECT 1 FROM public.pluggy_import_entries e WHERE e.user_id=p_user_id AND e.batch_id=p_batch_id AND e.entry_id=x)) THEN
    RAISE EXCEPTION 'pluggy_selecao_invalida' USING ERRCODE='22023';
  END IF;
  IF b.reverted_at IS NOT NULL THEN
    RETURN jsonb_build_object('replay', true, 'resultado', b.revert_outcome, 'revertidos', 0, 'preservados', b.revert_kept);
  END IF;
  UPDATE public.pluggy_real_batch_grants SET active_txid = txid_current() WHERE batch_id = p_batch_id;
  FOR ent IN SELECT * FROM public.pluggy_import_entries e WHERE e.user_id = p_user_id AND e.batch_id = p_batch_id AND e.state = 'ativo' AND e.entry_id = ANY(p_entry_ids) FOR UPDATE LOOP
    IF ent.entry_table = 'gastos' THEN
      SELECT x.valor, x.data, x.descricao, x.categoria_id::text AS categoria_id, x.deleted_at, x.updated_at INTO cur FROM public.gastos x
        WHERE x.id = ent.entry_id AND x.user_id = p_user_id AND x.origem = 'pluggy' AND x.import_batch_id = p_batch_id FOR UPDATE;
    ELSE
      SELECT x.valor, x.data, x.descricao, NULL::text AS categoria_id, x.deleted_at, x.updated_at INTO cur FROM public.receitas x
        WHERE x.id = ent.entry_id AND x.user_id = p_user_id AND x.origem = 'pluggy' AND x.import_batch_id = p_batch_id FOR UPDATE;
    END IF;
    IF NOT FOUND OR cur.deleted_at IS NOT NULL
       OR cur.valor <> (ent.snapshot->>'valor')::numeric OR cur.data <> (ent.snapshot->>'data')::date
       OR cur.descricao <> ent.snapshot->>'descricao' OR cur.categoria_id IS DISTINCT FROM ent.snapshot->>'categoria_id'
       OR cur.updated_at IS DISTINCT FROM (ent.snapshot->>'updated_at')::timestamptz THEN
      n_kept := n_kept + 1; CONTINUE;
    END IF;
    IF ent.entry_table = 'gastos' THEN
      UPDATE public.gastos SET deleted_at = now() WHERE id = ent.entry_id AND user_id = p_user_id;
    ELSE
      UPDATE public.receitas SET deleted_at = now(), deleted_reason = 'importacao_pluggy_desfeita', deleted_source = 'pluggy'
        WHERE id = ent.entry_id AND user_id = p_user_id;
    END IF;
    UPDATE public.pluggy_import_entries SET state = 'revertido' WHERE id = ent.id;
    n_rev := n_rev + 1;
  END LOOP;
  SELECT count(*) INTO n_remaining FROM public.pluggy_import_entries WHERE user_id=p_user_id AND batch_id=p_batch_id AND state='ativo';
  IF n_remaining = 0 THEN
    UPDATE public.extratos_importados SET status = 'revertido', reverted_at = now(),
        observacao = format('Revertido: %s lançamento(s); nenhum preservado', n_rev)
      WHERE id = p_batch_id AND user_id = p_user_id;
  ELSE
    UPDATE public.extratos_importados SET status = 'parcial',
        observacao = format('Desfeito parcialmente: %s revertido(s) nesta operação; %s ativo(s) restante(s), incluindo %s preservado(s) por edição manual', n_rev, n_remaining, n_kept)
      WHERE id = p_batch_id AND user_id = p_user_id;
  END IF;
  UPDATE public.pluggy_real_batch_grants SET reverted_at = CASE WHEN n_remaining=0 THEN now() ELSE NULL END, active_txid = NULL,
      revert_outcome = CASE WHEN n_remaining=0 THEN 'revertido' ELSE NULL END, revert_kept = CASE WHEN n_remaining=0 THEN 0 ELSE NULL END WHERE batch_id = p_batch_id;
  RETURN jsonb_build_object('replay', n_rev=0 AND n_kept=0, 'resultado', CASE WHEN n_remaining = 0 THEN 'revertido' ELSE 'parcial' END, 'revertidos', n_rev, 'preservados', n_kept);
END $$;

REVOKE ALL ON FUNCTION public.pluggy_import_revert_real_batch_items(uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pluggy_import_revert_real_batch_items(uuid,uuid,uuid[]) TO service_role;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sandbox_exec') THEN
EXECUTE 'REVOKE ALL ON FUNCTION public.pluggy_import_revert_real_batch_items(uuid,uuid,uuid[]) FROM sandbox_exec';
END IF; END $$;
