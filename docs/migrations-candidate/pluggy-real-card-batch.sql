-- CANDIDATA 2026-10-20. Nao aplicada. Requer lote fechado + real-card-links.
-- Estende o mesmo escritor atomico; nao cria grants nem abre a trava global.
-- Uma compra exige grant literal com cartao, billId e vencimento exatos.
ALTER TABLE public.pluggy_real_batch_grant_items ADD COLUMN cartao_id uuid;
ALTER TABLE public.pluggy_real_batch_grant_items ADD COLUMN bill_id text;
ALTER TABLE public.pluggy_real_batch_grant_items ADD COLUMN bill_due_date date;
ALTER TABLE public.pluggy_real_batch_grant_items ADD CONSTRAINT pluggy_card_grant_complete CHECK (
 (cartao_id IS NULL AND bill_id IS NULL AND bill_due_date IS NULL) OR
 (cartao_id IS NOT NULL AND nullif(btrim(bill_id),'') IS NOT NULL AND bill_due_date IS NOT NULL AND entry_table='gastos'));
CREATE OR REPLACE FUNCTION public.pluggy_import_apply_real_batch(p_user_id uuid, p_batch_id uuid, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b record; it record; tx record; r jsonb; new_id uuid; stamp timestamptz; op text; desc_ text;
        n_g int := 0; n_r int := 0; t_g numeric := 0; t_r numeric := 0; d_min date; d_max date;
BEGIN
  IF p_user_id IS DISTINCT FROM '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid THEN
    RAISE EXCEPTION 'pluggy_nao_autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM public.pluggy_assert_owner(p_user_id);
  IF p_batch_id IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'pluggy_lote_invalido' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pluggy-import:' || p_user_id::text, 0));
  SELECT * INTO b FROM public.pluggy_real_batch_grants WHERE batch_id = p_batch_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_lote_nao_autorizado' USING ERRCODE = '42501'; END IF;
  IF b.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('replay', true, 'gastos', 0, 'receitas', 0, 'batch_id', b.batch_id);
  END IF;
  IF b.expires_at <= now() THEN RAISE EXCEPTION 'pluggy_autorizacao_expirada' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.extratos_importados e WHERE e.id = p_batch_id) THEN
    RAISE EXCEPTION 'pluggy_lote_invalido' USING ERRCODE = '22023';
  END IF;
  -- A lista enviada deve ser EXATAMENTE a autorizada (sem faltar, sobrar ou repetir).
  IF jsonb_array_length(p_rows) <> b.item_count
     OR (SELECT count(*) FROM public.pluggy_real_batch_grant_items WHERE batch_id = p_batch_id) <> b.item_count
     OR (SELECT count(DISTINCT (x->>'account_id', x->>'transaction_id')) FROM jsonb_array_elements(p_rows) x) <> b.item_count
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) x WHERE NOT EXISTS (
          SELECT 1 FROM public.pluggy_real_batch_grant_items i WHERE i.batch_id = p_batch_id AND i.account_id = x->>'account_id' AND i.transaction_id = x->>'transaction_id'))
     OR (SELECT round(sum(valor) * 100) FROM public.pluggy_real_batch_grant_items WHERE batch_id = p_batch_id) <> round(b.total * 100) THEN
    RAISE EXCEPTION 'pluggy_lista_nao_autorizada' USING ERRCODE = '42501';
  END IF;

  UPDATE public.pluggy_real_batch_grants SET active_txid = txid_current() WHERE batch_id = p_batch_id;
  SELECT min(data), max(data) INTO d_min, d_max FROM public.pluggy_real_batch_grant_items WHERE batch_id = p_batch_id;
  INSERT INTO public.extratos_importados (id, user_id, nome_arquivo, banco, tipo_origem, status, periodo_inicio, periodo_fim, qtd_movimentacoes, total_receitas, total_despesas, observacao)
    VALUES (p_batch_id, p_user_id, 'Open Finance (Pluggy) — Mercado Pago', 'Mercado Pago', 'pluggy', 'importado', d_min, d_max, b.item_count,
            (SELECT coalesce(sum(valor), 0) FROM public.pluggy_real_batch_grant_items WHERE batch_id = p_batch_id AND entry_table = 'receitas'),
            (SELECT coalesce(sum(valor), 0) FROM public.pluggy_real_batch_grant_items WHERE batch_id = p_batch_id AND entry_table = 'gastos'),
            format('Importação real em lote fechado; conector 606; %s movimentação(ões)', b.item_count));

  FOR it IN SELECT * FROM public.pluggy_real_batch_grant_items WHERE batch_id = p_batch_id ORDER BY data, transaction_id LOOP
    SELECT x INTO r FROM jsonb_array_elements(p_rows) x WHERE x->>'account_id' = it.account_id AND x->>'transaction_id' = it.transaction_id;
    SELECT t.* INTO tx FROM public.pluggy_transactions t
      WHERE t.user_id = p_user_id AND t.account_id = it.account_id AND t.transaction_id = it.transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_transacao_inexistente' USING ERRCODE = '22023'; END IF;
    IF tx.is_sandbox OR NOT EXISTS (
         SELECT 1 FROM public.pluggy_accounts pa JOIN public.pluggy_items pi ON pi.item_id = pa.item_id AND pi.user_id = pa.user_id
          WHERE pa.user_id = p_user_id AND pa.account_id = tx.account_id AND ((pa.type='BANK' AND it.cartao_id IS NULL) OR (pa.type='CREDIT' AND it.cartao_id IS NOT NULL AND it.entry_table='gastos'))
            AND NOT pa.is_sandbox AND NOT pi.is_sandbox AND pi.deleted_at IS NULL AND pi.connector_id = 606) THEN
      RAISE EXCEPTION 'pluggy_origem_nao_permitida' USING ERRCODE = '22023';
    END IF;
    IF tx.deleted_at IS NOT NULL OR tx.status IS DISTINCT FROM 'POSTED' OR tx.review_status IS NOT NULL
       OR tx.classification IS DISTINCT FROM (CASE it.entry_table WHEN 'gastos' THEN 'gasto' ELSE 'receita' END)
       OR tx.type IS DISTINCT FROM (CASE it.entry_table WHEN 'gastos' THEN 'DEBIT' ELSE 'CREDIT' END)
       OR coalesce(cardinality(tx.mp_match_ids), 0) > 0
       OR round(tx.amount * 100) <> round(it.valor * 100) OR tx.date <> it.data THEN
      RAISE EXCEPTION 'pluggy_transacao_nao_elegivel: %', it.transaction_id USING ERRCODE = '22023';
    END IF;
    IF it.cartao_id IS NOT NULL THEN
      PERFORM 1 FROM public.pluggy_card_links l JOIN public.cartoes c ON c.id=l.cartao_id AND c.user_id=l.user_id
        WHERE l.user_id=p_user_id AND l.account_id=tx.account_id AND l.cartao_id=it.cartao_id AND l.active FOR SHARE OF l,c;
      IF NOT FOUND OR tx.bill_id IS DISTINCT FROM it.bill_id OR tx.bill_due_date IS DISTINCT FROM it.bill_due_date
        OR tx.bill_id IS NULL OR tx.bill_due_date IS NULL OR tx.amount_original IS NULL OR abs(tx.amount_original)<>tx.amount
        OR (tx.installment_number IS NOT NULL OR tx.total_installments IS NOT NULL) AND
           (tx.installment_number IS NULL OR tx.total_installments IS NULL OR tx.installment_number<1 OR tx.total_installments<tx.installment_number)
        OR EXISTS (SELECT 1 FROM public.pluggy_transactions refund WHERE refund.user_id=p_user_id AND refund.account_id=tx.account_id AND refund.deleted_at IS NULL AND (refund.classification_reason='estorno' OR upper(coalesce(refund.operation_type,''))='ESTORNO') AND round(refund.amount*100)=round(tx.amount*100) AND abs(refund.date-tx.date)<=7)
        OR upper(coalesce(tx.operation_type,'')) IN ('ESTORNO','PAGAMENTO_FATURA')
        OR tx.classification_reason IN ('estorno','pagamento_de_fatura','credito_em_cartao') THEN
        RAISE EXCEPTION 'pluggy_fatura_ou_vinculo_divergente' USING ERRCODE='22023';
      END IF;
    END IF;
    op := 'pluggy:' || tx.account_id || ':' || tx.transaction_id;
    -- Nunca reimporta: inclui importações anteriores desfeitas e a autorização individual.
    IF EXISTS (SELECT 1 FROM public.pluggy_import_entries e WHERE e.user_id = p_user_id AND e.account_id = tx.account_id AND e.transaction_id = tx.transaction_id)
       OR EXISTS (SELECT 1 FROM public.pluggy_real_import_grants g WHERE g.user_id = p_user_id AND g.account_id = tx.account_id AND g.transaction_id = tx.transaction_id)
       OR EXISTS (SELECT 1 FROM public.gastos x WHERE x.user_id = p_user_id AND x.id_operacao_banco = op)
       OR EXISTS (SELECT 1 FROM public.receitas x WHERE x.user_id = p_user_id AND x.id_operacao_banco = op) THEN
      RAISE EXCEPTION 'pluggy_ja_importada: %', it.transaction_id USING ERRCODE = '23505';
    END IF;
    -- Coincidência com outras origens (manual, WhatsApp, extrato) ou MP antigo: lote inteiro abortado.
    IF (it.entry_table = 'gastos' AND EXISTS (SELECT 1 FROM public.gastos x WHERE x.user_id = p_user_id AND x.deleted_at IS NULL
          AND round(x.valor * 100) = round(tx.amount * 100) AND abs(x.data - tx.date) <= 1))
       OR (it.entry_table = 'receitas' AND EXISTS (SELECT 1 FROM public.receitas x WHERE x.user_id = p_user_id AND x.deleted_at IS NULL
          AND round(x.valor * 100) = round(tx.amount * 100) AND abs(x.data - tx.date) <= 1))
       OR EXISTS (SELECT 1 FROM public.imported_transactions m WHERE m.user_id = p_user_id
          AND round(abs(m.amount) * 100) = round(tx.amount * 100) AND abs(m.occurred_at::date - tx.date) <= 1) THEN
      RAISE EXCEPTION 'pluggy_possivel_duplicata: %', it.transaction_id USING ERRCODE = '23505';
    END IF;
    desc_ := nullif(btrim(r->>'descricao'), '');
    IF desc_ IS NULL OR length(desc_) > 200 THEN RAISE EXCEPTION 'pluggy_lancamento_invalido' USING ERRCODE = '22023'; END IF;
    new_id := gen_random_uuid();
    IF it.entry_table = 'gastos' THEN
      IF NOT EXISTS (SELECT 1 FROM public.categorias c WHERE c.id = it.categoria_id AND c.user_id = p_user_id) THEN
        RAISE EXCEPTION 'pluggy_categoria_invalida' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.gastos (id, user_id, categoria_id, descricao, valor, data, estabelecimento, forma_pagamento, observacao,
          mes, ano, confirmado, tipo_gasto, cartao_id, origem, import_batch_id, id_operacao_banco, fatura_competencia, invoice_month)
        VALUES (new_id, p_user_id, it.categoria_id, desc_, it.valor, it.data, left(coalesce(r->>'estabelecimento', ''), 200),
          CASE WHEN it.cartao_id IS NULL THEN 'debito' ELSE 'credito' END, 'Open Finance — Mercado Pago', extract(month FROM it.data), extract(year FROM it.data), true, 'unico',
          it.cartao_id, 'pluggy', p_batch_id, op, CASE WHEN it.cartao_id IS NOT NULL THEN to_char(it.bill_due_date,'YYYY-MM') ELSE NULL END, NULL);
      SELECT updated_at INTO stamp FROM public.gastos WHERE id = new_id;
      n_g := n_g + 1; t_g := t_g + it.valor;
    ELSE
      INSERT INTO public.receitas (id, user_id, descricao, valor, data, tipo, mes, ano, origem, import_batch_id, id_operacao_banco)
        VALUES (new_id, p_user_id, desc_, it.valor, it.data, coalesce(nullif(it.tipo, ''), 'outros'),
          extract(month FROM it.data), extract(year FROM it.data), 'pluggy', p_batch_id, op);
      SELECT updated_at INTO stamp FROM public.receitas WHERE id = new_id;
      n_r := n_r + 1; t_r := t_r + it.valor;
    END IF;
    INSERT INTO public.pluggy_import_entries (user_id, account_id, transaction_id, entry_table, entry_id, batch_id, snapshot)
      VALUES (p_user_id, tx.account_id, tx.transaction_id, it.entry_table, new_id, p_batch_id,
              jsonb_build_object('valor', it.valor, 'data', it.data, 'descricao', desc_, 'categoria_id', it.categoria_id::text, 'updated_at', stamp, 'cartao_id', it.cartao_id, 'fatura_competencia', CASE WHEN it.cartao_id IS NOT NULL THEN to_char(it.bill_due_date,'YYYY-MM') ELSE NULL END));
  END LOOP;
  UPDATE public.pluggy_real_batch_grants SET consumed_at = now(), active_txid = NULL WHERE batch_id = p_batch_id;
  RETURN jsonb_build_object('replay', false, 'gastos', n_g, 'receitas', n_r, 'total_gastos', t_g, 'total_receitas', t_r, 'batch_id', p_batch_id);
END $$;

