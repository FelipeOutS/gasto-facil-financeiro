-- Uma chamada / transação: qualquer falha (inclusive histórico) desfaz o lote.
-- INVOKER preserva RLS, permissões e triggers existentes. Não aplica grants em tabelas.
CREATE OR REPLACE FUNCTION public.import_extrato_atomic(
  p_owner_id uuid, p_batch_id uuid, p_gastos jsonb, p_receitas jsonb,
  p_transferencias jsonb, p_extrato jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  item jsonb;
  saved jsonb;
  expenses jsonb := '[]'::jsonb;
  incomes jsonb := '[]'::jsonb;
  transfers jsonb := '[]'::jsonb;
  history jsonb;
  operation_id text;
  duplicates integer := 0;
  entry_kind text;
BEGIN
  IF auth.uid() IS NULL OR p_owner_id IS NULL OR p_batch_id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_gastos) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_receitas) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_transferencias) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_extrato) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Lote inválido';
  END IF;
  -- Serializa importações da mesma conta, inclusive entre abas/dispositivos.
  PERFORM pg_advisory_xact_lock(hashtextextended('import-extrato:' || p_owner_id::text, 0));
  SELECT to_jsonb(e) INTO history FROM public.extratos_importados e
    WHERE e.user_id = p_owner_id AND e.id = p_batch_id;
  IF history IS NOT NULL THEN
    IF history->>'status' <> 'importado' THEN
      RAISE EXCEPTION 'Este lote já foi revertido ou alterado';
    END IF;
    -- Repetição após perda da resposta: devolve o commit anterior, sem inserir nada.
    SELECT coalesce(jsonb_agg(g), '[]') INTO expenses FROM public.gastos g
      WHERE g.user_id = p_owner_id AND g.import_batch_id = p_batch_id;
    SELECT coalesce(jsonb_agg(r), '[]') INTO incomes FROM public.receitas r
      WHERE r.user_id = p_owner_id AND r.import_batch_id = p_batch_id;
    SELECT coalesce(jsonb_agg(t), '[]') INTO transfers FROM public.transferencias_internas t
      WHERE t.user_id = p_owner_id AND t.import_batch_id = p_batch_id;
    RETURN jsonb_build_object('gastos', expenses, 'receitas', incomes,
      'transferencias', transfers, 'extrato', history, 'duplicados', 0);
  END IF;

  FOREACH entry_kind IN ARRAY ARRAY['gastos', 'receitas', 'transferencias_internas'] LOOP
    FOR item IN SELECT value FROM jsonb_array_elements(CASE entry_kind
      WHEN 'gastos' THEN p_gastos WHEN 'receitas' THEN p_receitas ELSE p_transferencias END)
    LOOP
      IF coalesce((item->>'valor')::numeric, 0) <= 0
         OR nullif(btrim(item->>'descricao'), '') IS NULL
         OR (item->>'data')::date IS NULL THEN
        RAISE EXCEPTION 'Lançamento inválido';
      END IF;
      operation_id := nullif(lower(btrim(item->>'id_operacao_banco')), '');
      -- Identificador bancário é preferido; sem ele, compara assinatura exata.
      -- A deduplicação aproximada da revisão continua no cliente.
      IF EXISTS (
        SELECT 1 FROM (
          SELECT 'gastos' AS kind, descricao, valor, data, id_operacao_banco, cartao_id
            FROM public.gastos WHERE user_id = p_owner_id
          UNION ALL
          SELECT 'receitas', descricao, valor, data, id_operacao_banco, NULL::uuid
            FROM public.receitas WHERE user_id = p_owner_id AND deleted_at IS NULL
          UNION ALL
          SELECT 'transferencias_internas', descricao, valor, data, id_operacao_banco, NULL::uuid
            FROM public.transferencias_internas WHERE user_id = p_owner_id
        ) existing WHERE
          (operation_id IS NOT NULL AND lower(btrim(existing.id_operacao_banco)) = operation_id)
          OR (operation_id IS NULL AND existing.kind = entry_kind
            AND existing.data = (item->>'data')::date
            AND existing.valor = (item->>'valor')::numeric
            AND lower(btrim(existing.descricao)) = lower(btrim(item->>'descricao'))
            AND existing.cartao_id IS NOT DISTINCT FROM (item->>'cartao_id')::uuid)
      ) THEN
        duplicates := duplicates + 1;
        CONTINUE;
      END IF;
      -- Nunca aceita proprietário/lote/ID/timestamps arbitrários do payload.
      item := item || jsonb_build_object('id', gen_random_uuid(), 'user_id', p_owner_id,
        'import_batch_id', p_batch_id,
        'mes', extract(month FROM (item->>'data')::date),
        'ano', extract(year FROM (item->>'data')::date));
      IF entry_kind = 'gastos' THEN
        item := item || '{"confirmado":true,"tipo_gasto":"unico"}'::jsonb;
        INSERT INTO public.gastos (id, user_id, descricao, valor, data, estabelecimento, categoria_id, forma_pagamento, observacao, mes, ano, confirmado, tipo_gasto, horario, origem, import_batch_id, id_operacao_banco, cartao_id, invoice_month)
          SELECT r.id, r.user_id, r.descricao, r.valor, r.data, r.estabelecimento, r.categoria_id, r.forma_pagamento, r.observacao, r.mes, r.ano, r.confirmado, r.tipo_gasto, r.horario, r.origem, r.import_batch_id, r.id_operacao_banco, r.cartao_id, r.invoice_month
          FROM jsonb_populate_record(NULL::public.gastos, item) r
          RETURNING to_jsonb(gastos.*) INTO saved;
        IF saved IS NULL THEN RAISE EXCEPTION 'Lançamento não confirmado'; END IF;
        expenses := expenses || jsonb_build_array(saved);
      ELSIF entry_kind = 'receitas' THEN
        item := item || '{"recorrente":false}'::jsonb;
        INSERT INTO public.receitas (id, user_id, descricao, valor, data, tipo, recorrente, mes, ano, horario, origem, import_batch_id, id_operacao_banco)
          SELECT r.id, r.user_id, r.descricao, r.valor, r.data, r.tipo, r.recorrente, r.mes, r.ano, r.horario, r.origem, r.import_batch_id, r.id_operacao_banco
          FROM jsonb_populate_record(NULL::public.receitas, item) r
          RETURNING to_jsonb(receitas.*) INTO saved;
        IF saved IS NULL THEN RAISE EXCEPTION 'Lançamento não confirmado'; END IF;
        incomes := incomes || jsonb_build_array(saved);
      ELSIF entry_kind = 'transferencias_internas' THEN
        INSERT INTO public.transferencias_internas (id, user_id, descricao, valor, data, horario, origem, destino, observacao, origem_importacao, import_batch_id, id_operacao_banco, mes, ano)
          SELECT r.id, r.user_id, r.descricao, r.valor, r.data, r.horario, r.origem, r.destino, r.observacao, r.origem_importacao, r.import_batch_id, r.id_operacao_banco, r.mes, r.ano
          FROM jsonb_populate_record(NULL::public.transferencias_internas, item) r
          RETURNING to_jsonb(transferencias_internas.*) INTO saved;
        IF saved IS NULL THEN RAISE EXCEPTION 'Lançamento não confirmado'; END IF;
        transfers := transfers || jsonb_build_array(saved);
      END IF;
    END LOOP;
  END LOOP;

  IF jsonb_array_length(expenses) + jsonb_array_length(incomes) + jsonb_array_length(transfers) > 0 THEN
    -- Histórico por último; totais calculados somente das linhas efetivamente inseridas.
    INSERT INTO public.extratos_importados (
      id, user_id, nome_arquivo, banco, tipo_origem, periodo_inicio, periodo_fim,
      qtd_movimentacoes, qtd_duplicadas_ignoradas, total_receitas, total_despesas,
      total_guardado, total_transferencias, status, observacao
    ) VALUES (
      p_batch_id, p_owner_id, p_extrato->>'nome_arquivo', p_extrato->>'banco',
      p_extrato->>'tipo_origem',
      (SELECT min((v->>'data')::date) FROM jsonb_array_elements(expenses || incomes || transfers) v),
      (SELECT max((v->>'data')::date) FROM jsonb_array_elements(expenses || incomes || transfers) v),
      jsonb_array_length(expenses) + jsonb_array_length(incomes) + jsonb_array_length(transfers),
      coalesce((p_extrato->>'qtd_duplicadas_ignoradas')::integer, 0) + duplicates,
      (SELECT coalesce(sum((v->>'valor')::numeric), 0) FROM jsonb_array_elements(incomes) v),
      (SELECT coalesce(sum((v->>'valor')::numeric), 0) FROM jsonb_array_elements(expenses) v),
      0,
      (SELECT coalesce(sum((v->>'valor')::numeric), 0) FROM jsonb_array_elements(transfers) v),
      'importado', p_extrato->>'observacao'
    ) RETURNING to_jsonb(extratos_importados.*) INTO history;
    IF history IS NULL THEN RAISE EXCEPTION 'Histórico não confirmado'; END IF;
  END IF;
  RETURN jsonb_build_object('gastos', expenses, 'receitas', incomes,
    'transferencias', transfers, 'extrato', history, 'duplicados', duplicates);
END;
$$;
REVOKE ALL ON FUNCTION public.import_extrato_atomic(uuid, uuid, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_extrato_atomic(uuid, uuid, jsonb, jsonb, jsonb, jsonb) TO authenticated;
