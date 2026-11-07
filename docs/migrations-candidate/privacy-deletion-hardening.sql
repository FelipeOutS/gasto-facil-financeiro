-- CANDIDATO (não aplicado). Endurece execute_data_deletion_atomic da tela /app/privacidade.
-- 1) Recusa auth.uid() nulo: hoje anon/service role sem JWT passam pela checagem (NULL != x é NULL).
-- 2) Revoga EXECUTE de PUBLIC/anon.
-- 3) Valida escopos e recusa, antes de qualquer DELETE, vínculos com Pluggy, bens, faturas e recorrências.
-- 4) Não desvincula mais gastos de cartões (o ramo cards só roda sem vínculos).
-- Testado em banco descartável por scripts/test-privacy-deletion.sh.
CREATE OR REPLACE FUNCTION public.execute_data_deletion_atomic(p_user_id uuid, p_categories text[], p_options jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_results JSONB := '{}'::JSONB;
    v_cat TEXT;
    v_count INTEGER;
    v_total INTEGER;
    v_scope TEXT;
BEGIN
    -- 1. Security check: p_user_id must match auth.uid()
    -- auth.uid() nulo (anon/service role sem JWT) agora é recusado; antes NULL passava.
    IF auth.uid() IS NULL OR p_user_id IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
    END IF;
    IF p_categories IS NULL OR cardinality(p_categories) = 0 THEN
        RAISE EXCEPTION 'invalid_selection' USING ERRCODE = '22023';
    END IF;

    -- 2. Validate categories against allowlist
    FOREACH v_cat IN ARRAY p_categories LOOP
        IF v_cat NOT IN ('expenses', 'income', 'payables', 'receivables', 'subscriptions', 'budgets', 'goals', 'savings', 'investments', 'cards', 'market', 'imports') THEN
            RAISE EXCEPTION 'invalid_selection' USING ERRCODE = '22023';
        END IF;
        v_scope := COALESCE(p_options->v_cat->>'scope', 'all');
        IF NOT (v_scope = 'all'
            OR (v_cat = 'payables' AND v_scope IN ('paid','pending','overdue'))
            OR (v_cat = 'receivables' AND v_scope IN ('received','pending','overdue'))) THEN
            RAISE EXCEPTION 'invalid_selection' USING ERRCODE = '22023';
        END IF;
    END LOOP;

    -- 2b. Vínculos financeiros: recusa tudo antes de qualquer DELETE (nada parcial).
    IF 'imports' = ANY(p_categories) AND EXISTS (SELECT 1 FROM public.pluggy_import_entries e
         JOIN public.extratos_importados x ON x.id = e.batch_id WHERE x.user_id = p_user_id) THEN
        RAISE EXCEPTION 'blocked_by_dependencies' USING ERRCODE = '23503', HINT = 'imports_pluggy_linked';
    END IF;
    IF 'expenses' = ANY(p_categories) AND (
         EXISTS (SELECT 1 FROM public.pluggy_import_entries WHERE user_id = p_user_id AND entry_table = 'gastos')
      OR EXISTS (SELECT 1 FROM public.gastos WHERE user_id = p_user_id AND (bem_id IS NOT NULL OR cartao_id IS NOT NULL))
      OR EXISTS (SELECT 1 FROM public.bens_pagamentos b JOIN public.gastos g ON g.id = b.gasto_id WHERE g.user_id = p_user_id)
      OR EXISTS (SELECT 1 FROM public.bens_amortizacoes b JOIN public.gastos g ON g.id = b.gasto_id WHERE g.user_id = p_user_id)
      OR EXISTS (SELECT 1 FROM public.bens_custos_aquisicao b JOIN public.gastos g ON g.id = b.gasto_id WHERE g.user_id = p_user_id)) THEN
        RAISE EXCEPTION 'blocked_by_dependencies' USING ERRCODE = '23503', HINT = 'expenses_linked';
    END IF;
    IF 'income' = ANY(p_categories) AND EXISTS (SELECT 1 FROM public.pluggy_import_entries WHERE user_id = p_user_id AND entry_table = 'receitas') THEN
        RAISE EXCEPTION 'blocked_by_dependencies' USING ERRCODE = '23503', HINT = 'income_pluggy_linked';
    END IF;
    IF 'cards' = ANY(p_categories) AND (
         EXISTS (SELECT 1 FROM public.faturas_cartao WHERE user_id = p_user_id)
      OR EXISTS (SELECT 1 FROM public.gastos WHERE user_id = p_user_id AND cartao_id IS NOT NULL)) THEN
        RAISE EXCEPTION 'blocked_by_dependencies' USING ERRCODE = '23503', HINT = 'cards_invoice_linked';
    END IF;
    IF 'subscriptions' = ANY(p_categories) AND (
         EXISTS (SELECT 1 FROM public.gastos WHERE user_id = p_user_id AND recorrencia_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.receitas WHERE user_id = p_user_id AND recorrencia_id IS NOT NULL)) THEN
        RAISE EXCEPTION 'blocked_by_dependencies' USING ERRCODE = '23503', HINT = 'subscriptions_entries_linked';
    END IF;

    -- 3. Execution loop
    FOREACH v_cat IN ARRAY p_categories LOOP
        v_scope := COALESCE(p_options->v_cat->>'scope', 'all');
        
        IF v_cat = 'expenses' THEN
            DELETE FROM public.gastos WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_results := v_results || jsonb_build_object('expenses', v_count);
        
        ELSIF v_cat = 'income' THEN
            DELETE FROM public.receitas WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_results := v_results || jsonb_build_object('income', v_count);

        ELSIF v_cat = 'payables' THEN
            IF v_scope = 'paid' THEN
                DELETE FROM public.contas_a_pagar WHERE user_id = p_user_id AND status = 'pago';
            ELSIF v_scope = 'pending' THEN
                DELETE FROM public.contas_a_pagar WHERE user_id = p_user_id AND status = 'pendente';
            ELSIF v_scope = 'overdue' THEN
                DELETE FROM public.contas_a_pagar WHERE user_id = p_user_id AND status = 'atrasado';
            ELSE
                DELETE FROM public.contas_a_pagar WHERE user_id = p_user_id;
            END IF;
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_results := v_results || jsonb_build_object('payables', v_count);

        ELSIF v_cat = 'receivables' THEN
            IF v_scope = 'received' THEN
                DELETE FROM public.contas_a_receber WHERE user_id = p_user_id AND status = 'recebido';
            ELSIF v_scope = 'pending' THEN
                DELETE FROM public.contas_a_receber WHERE user_id = p_user_id AND status = 'pendente';
            ELSIF v_scope = 'overdue' THEN
                DELETE FROM public.contas_a_receber WHERE user_id = p_user_id AND status = 'atrasado';
            ELSE
                DELETE FROM public.contas_a_receber WHERE user_id = p_user_id;
            END IF;
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_results := v_results || jsonb_build_object('receivables', v_count);

        ELSIF v_cat = 'subscriptions' THEN
            DELETE FROM public.recorrencias WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_results := v_results || jsonb_build_object('subscriptions', v_count);

        ELSIF v_cat = 'budgets' THEN
            DELETE FROM public.limites WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_results := v_results || jsonb_build_object('budgets', v_count);

        ELSIF v_cat = 'goals' THEN
            v_total := 0;
            DELETE FROM public.movimentacoes_meta WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
            DELETE FROM public.metas_financeiras WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
            v_count := v_total;
            v_results := v_results || jsonb_build_object('goals', v_count);

        ELSIF v_cat = 'savings' THEN
            DELETE FROM public.dinheiro_guardado WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_results := v_results || jsonb_build_object('savings', v_count);

        ELSIF v_cat = 'investments' THEN
            v_total := 0;
            DELETE FROM public.investimentos_movimentacoes WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
            DELETE FROM public.investimentos_rendimentos WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
            DELETE FROM public.investimentos_atualizacoes WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
            DELETE FROM public.investimentos_ativos WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
            v_count := v_total;
            v_results := v_results || jsonb_build_object('investments', v_count);

        ELSIF v_cat = 'cards' THEN
            v_total := 0;
            DELETE FROM public.faturas_cartao WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
            DELETE FROM public.cartoes WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
            v_count := v_total;
            v_results := v_results || jsonb_build_object('cards', v_count);

        ELSIF v_cat = 'market' THEN
            v_total := 0;
            DELETE FROM public.mercado_orcamentos WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
            DELETE FROM public.mercado_precos_usuario WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
            DELETE FROM public.mercado_listas WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
            DELETE FROM public.mercado_historico_compras WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
            DELETE FROM public.mercado_mercados_salvos WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
            v_count := v_total;
            v_results := v_results || jsonb_build_object('market', v_count);

        ELSIF v_cat = 'imports' THEN
            v_total := 0;
            DELETE FROM public.imported_transactions WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
            DELETE FROM public.investimentos_importacoes WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
            DELETE FROM public.extratos_importados WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
            v_count := v_total;
            v_results := v_results || jsonb_build_object('imports', v_count);
        END IF;
    END LOOP;

    -- 4. Audit Log
    INSERT INTO public.audit_logs (
        actor_user_id,
        target_user_id,
        action,
        entity_type,
        metadata
    ) VALUES (
        p_user_id,
        p_user_id,
        'selective_data_deletion_atomic',
        'multiple',
        jsonb_build_object('categories', p_categories, 'options', p_options, 'results', v_results)
    );

    RETURN v_results;
END;
$function$;

REVOKE ALL ON FUNCTION public.execute_data_deletion_atomic(uuid, text[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_data_deletion_atomic(uuid, text[], jsonb) TO authenticated, service_role;
