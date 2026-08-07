-- CREATE FUNCTION
CREATE OR REPLACE FUNCTION public.execute_data_deletion_atomic(
    p_user_id UUID,
    p_categories TEXT[],
    p_options JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_results JSONB := '{}'::JSONB;
    v_cat TEXT;
    v_count INTEGER;
    v_scope TEXT;
BEGIN
    -- 1. Security check: p_user_id must match auth.uid()
    IF p_user_id IS NULL OR p_user_id != auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized: User ID mismatch';
    END IF;

    -- 2. Validate categories against allowlist
    FOREACH v_cat IN ARRAY p_categories LOOP
        IF v_cat NOT IN ('expenses', 'income', 'payables', 'receivables', 'subscriptions', 'budgets', 'goals', 'savings', 'investments', 'cards', 'market', 'imports') THEN
            RAISE EXCEPTION 'Invalid category: %', v_cat;
        END IF;
    END LOOP;

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
            DELETE FROM public.movimentacoes_meta WHERE user_id = p_user_id;
            DELETE FROM public.metas_financeiras WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_results := v_results || jsonb_build_object('goals', v_count);

        ELSIF v_cat = 'savings' THEN
            DELETE FROM public.dinheiro_guardado WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_results := v_results || jsonb_build_object('savings', v_count);

        ELSIF v_cat = 'investments' THEN
            DELETE FROM public.investimentos_movimentacoes WHERE user_id = p_user_id;
            DELETE FROM public.investimentos_rendimentos WHERE user_id = p_user_id;
            DELETE FROM public.investimentos_atualizacoes WHERE user_id = p_user_id;
            DELETE FROM public.investimentos_ativos WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_results := v_results || jsonb_build_object('investments', v_count);

        ELSIF v_cat = 'cards' THEN
            UPDATE public.gastos SET cartao_id = NULL WHERE user_id = p_user_id AND cartao_id IS NOT NULL;
            DELETE FROM public.faturas_cartao WHERE user_id = p_user_id;
            DELETE FROM public.cartoes WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_results := v_results || jsonb_build_object('cards', v_count);

        ELSIF v_cat = 'market' THEN
            DELETE FROM public.mercado_orcamentos WHERE user_id = p_user_id;
            DELETE FROM public.mercado_precos_usuario WHERE user_id = p_user_id;
            DELETE FROM public.mercado_listas WHERE user_id = p_user_id;
            DELETE FROM public.mercado_historico_compras WHERE user_id = p_user_id;
            DELETE FROM public.mercado_mercados_salvos WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_results := v_results || jsonb_build_object('market', v_count);

        ELSIF v_cat = 'imports' THEN
            DELETE FROM public.imported_transactions WHERE user_id = p_user_id;
            DELETE FROM public.investimentos_importacoes WHERE user_id = p_user_id;
            DELETE FROM public.extratos_importados WHERE user_id = p_user_id;
            GET DIAGNOSTICS v_count = ROW_COUNT;
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
$$;

-- REVOKE EXECUTE FROM PUBLIC
REVOKE EXECUTE ON FUNCTION public.execute_data_deletion_atomic(UUID, TEXT[], JSONB) FROM PUBLIC;

-- GRANT EXECUTE TO authenticated
GRANT EXECUTE ON FUNCTION public.execute_data_deletion_atomic(UUID, TEXT[], JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_data_deletion_atomic(UUID, TEXT[], JSONB) TO service_role;
