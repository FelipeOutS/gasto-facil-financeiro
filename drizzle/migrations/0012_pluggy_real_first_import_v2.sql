-- CANDIDATA — NÃO APLICADA. Exige aprovação separada (hash informado no relatório).
-- Objetivo: permitir UMA importação real controlada do Mercado Pago (conector 606),
-- somente na conta do Felipe, somente para a movimentação BANCÁRIA expressamente
-- autorizada em public.pluggy_real_import_grants. A trava global
-- public.pluggy_assert_financial_release() NÃO é alterada e continua rejeitando
-- pluggy_import_apply/pluggy_import_revert e qualquer outro caminho.
--
-- Garantias:
-- * Autorização é uma LINHA criada apenas pelo dono do banco (migração/SQL aprovado);
--   anon/authenticated/service_role não inserem nem alteram autorizações.
-- * Cada autorização vale para 1 transação, 1 vez, com prazo e com o LOTE já fixado
--   na própria autorização (gerado no servidor do banco, nunca pelo navegador);
--   repetição com o mesmo lote devolve replay sem gravar; qualquer outro lote é recusado.
-- * O gatilho de integridade só dispensa a trava global para a identidade EXATA
--   autorizada (titular, conta, transação, tabela, lote) e somente dentro da transação
--   SQL que está consumindo/desfazendo a autorização (txid atual).
-- * Desfazer parcial (lançamento editado preservado) registra o lote como 'parcial'
--   (estado já existente em extratos_importados) e o resultado na autorização.
-- * Revalida no banco: titular, papel owner, conector 606, real, conta BANK, POSTED,
--   sem revisão, sem coincidência Mercado Pago, sem duplicata de outras origens (±1 dia),
--   valor/data/natureza iguais aos autorizados, sem cartão.
-- * Desfazer: exclusão reversível (deleted_at) apenas do lançamento criado, e só se não
--   foi editado; editado é preservado.
-- Requer: pluggy-open-finance.sql, pluggy-amount-original.sql, pluggy-import-gi.sql,
-- pluggy-live-readonly.sql já aplicados. Sem BEGIN/COMMIT (a ferramenta usa uma transação).

CREATE TABLE public.pluggy_real_import_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL CHECK (user_id = '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid),
  account_id text NOT NULL,
  transaction_id text NOT NULL,
  entry_table text NOT NULL CHECK (entry_table IN ('gastos', 'receitas')),
  valor numeric NOT NULL CHECK (valor > 0),
  data date NOT NULL,
  expires_at timestamptz NOT NULL,
  batch_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  consumed_at timestamptz,
  active_txid bigint,
  reverted_at timestamptz,
  revert_outcome text CHECK (revert_outcome IN ('revertido', 'parcial')),
  revert_kept integer CHECK (revert_kept >= 0),
  CHECK ((reverted_at IS NULL) = (revert_outcome IS NULL) AND (reverted_at IS NULL) = (revert_kept IS NULL)),
  CHECK (reverted_at IS NULL OR consumed_at IS NOT NULL),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, account_id, transaction_id),
  FOREIGN KEY (user_id, account_id, transaction_id) REFERENCES public.pluggy_transactions(user_id, account_id, transaction_id) ON DELETE RESTRICT
);
REVOKE ALL ON public.pluggy_real_import_grants FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.pluggy_real_import_grants TO service_role;
ALTER TABLE public.pluggy_real_import_grants ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sandbox_exec') THEN
    EXECUTE 'REVOKE ALL ON public.pluggy_real_import_grants FROM sandbox_exec';
  END IF;
END $$;
CREATE POLICY pluggy_real_grants_service_read ON public.pluggy_real_import_grants FOR SELECT TO service_role USING (true);

-- Verdadeiro somente para a movimentação EXATA autorizada, dentro da transação SQL
-- que está usando essa autorização. Qualquer campo diferente => falso => trava global.
CREATE FUNCTION public.pluggy_real_grant_in_use(p_user_id uuid, p_account_id text, p_transaction_id text, p_entry_table text, p_batch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.pluggy_real_import_grants g
                 WHERE g.user_id = p_user_id AND g.account_id = p_account_id AND g.transaction_id = p_transaction_id
                   AND g.entry_table = p_entry_table AND g.batch_id = p_batch_id
                   AND g.active_txid IS NOT NULL AND g.active_txid = txid_current());
$$;
REVOKE ALL ON FUNCTION public.pluggy_real_grant_in_use(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pluggy_real_grant_in_use(uuid, text, text, text, uuid) TO service_role;

-- Mesmo corpo de pluggy-import-gi.sql; única mudança: a trava global é dispensada só
-- para a identidade exata autorizada e ativa nesta transação SQL.
CREATE OR REPLACE FUNCTION public.pluggy_validate_relationship()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.pluggy_assert_owner(NEW.user_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('pluggy-import:' || NEW.user_id::text, 0));
  IF TG_TABLE_NAME='pluggy_card_links' THEN
    PERFORM 1 FROM public.pluggy_accounts a JOIN public.pluggy_items i ON i.user_id=a.user_id AND i.item_id=a.item_id
      WHERE a.user_id=NEW.user_id AND a.account_id=NEW.account_id AND a.type='CREDIT'
        AND a.is_sandbox AND i.is_sandbox AND i.deleted_at IS NULL FOR SHARE OF a,i;
    IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_conta_cartao_invalida' USING ERRCODE='23503'; END IF;
    PERFORM 1 FROM public.cartoes c WHERE c.id=NEW.cartao_id AND c.user_id=NEW.user_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_cartao_invalido' USING ERRCODE='23503'; END IF;
  ELSE
    IF NOT public.pluggy_real_grant_in_use(NEW.user_id, NEW.account_id, NEW.transaction_id, NEW.entry_table, NEW.batch_id) THEN
      PERFORM public.pluggy_assert_financial_release();
    END IF;
    IF TG_OP='UPDATE' AND (NEW.user_id,NEW.account_id,NEW.transaction_id,NEW.entry_table,NEW.entry_id,NEW.batch_id)
       IS DISTINCT FROM (OLD.user_id,OLD.account_id,OLD.transaction_id,OLD.entry_table,OLD.entry_id,OLD.batch_id) THEN
      RAISE EXCEPTION 'pluggy_identidade_imutavel' USING ERRCODE='23503';
    END IF;
    PERFORM 1 FROM public.extratos_importados e WHERE e.id=NEW.batch_id AND e.user_id=NEW.user_id AND e.tipo_origem='pluggy' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_lote_invalido' USING ERRCODE='23503'; END IF;
    IF NEW.entry_table='gastos' THEN
      PERFORM 1 FROM public.gastos g WHERE g.id=NEW.entry_id AND g.user_id=NEW.user_id AND g.origem='pluggy'
        AND g.import_batch_id=NEW.batch_id AND g.id_operacao_banco='pluggy:'||NEW.account_id||':'||NEW.transaction_id FOR SHARE;
    ELSE
      PERFORM 1 FROM public.receitas r WHERE r.id=NEW.entry_id AND r.user_id=NEW.user_id AND r.origem='pluggy'
        AND r.import_batch_id=NEW.batch_id AND r.id_operacao_banco='pluggy:'||NEW.account_id||':'||NEW.transaction_id FOR SHARE;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_lancamento_invalido' USING ERRCODE='23503'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.pluggy_import_apply_real_once(p_user_id uuid, p_account_id text, p_transaction_id text, p_batch_id uuid, p_row jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g record; tx record; v numeric; d date; new_id uuid; snap jsonb; stamp timestamptz; op text;
BEGIN
  IF p_user_id IS DISTINCT FROM '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid THEN
    RAISE EXCEPTION 'pluggy_nao_autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM public.pluggy_assert_owner(p_user_id);
  IF p_batch_id IS NULL OR jsonb_typeof(p_row) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'pluggy_lote_invalido' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pluggy-import:' || p_user_id::text, 0));

  SELECT * INTO g FROM public.pluggy_real_import_grants
    WHERE user_id = p_user_id AND account_id = p_account_id AND transaction_id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_autorizacao_inexistente' USING ERRCODE = '42501'; END IF;
  IF p_batch_id IS DISTINCT FROM g.batch_id THEN
    RAISE EXCEPTION 'pluggy_lote_nao_autorizado' USING ERRCODE = '42501';
  END IF;
  IF g.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('replay', true, 'gastos', 0, 'receitas', 0, 'batch_id', g.batch_id);
  END IF;
  IF g.expires_at <= now() THEN RAISE EXCEPTION 'pluggy_autorizacao_expirada' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.extratos_importados e WHERE e.id = p_batch_id) THEN
    RAISE EXCEPTION 'pluggy_lote_invalido' USING ERRCODE = '22023';
  END IF;

  SELECT t.* INTO tx FROM public.pluggy_transactions t
    WHERE t.user_id = p_user_id AND t.account_id = p_account_id AND t.transaction_id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_transacao_inexistente' USING ERRCODE = '22023'; END IF;
  IF tx.is_sandbox OR NOT EXISTS (
       SELECT 1 FROM public.pluggy_accounts pa JOIN public.pluggy_items pi ON pi.item_id = pa.item_id AND pi.user_id = pa.user_id
        WHERE pa.user_id = p_user_id AND pa.account_id = tx.account_id AND pa.type = 'BANK'
          AND NOT pa.is_sandbox AND NOT pi.is_sandbox AND pi.deleted_at IS NULL AND pi.connector_id = 606) THEN
    RAISE EXCEPTION 'pluggy_origem_nao_permitida' USING ERRCODE = '22023';
  END IF;
  IF tx.deleted_at IS NOT NULL OR tx.status IS DISTINCT FROM 'POSTED' OR tx.review_status IS NOT NULL
     OR tx.classification IS DISTINCT FROM (CASE g.entry_table WHEN 'gastos' THEN 'gasto' ELSE 'receita' END)
     OR tx.type IS DISTINCT FROM (CASE g.entry_table WHEN 'gastos' THEN 'DEBIT' ELSE 'CREDIT' END)
     OR coalesce(cardinality(tx.mp_match_ids), 0) > 0
     OR round(tx.amount * 100) <> round(g.valor * 100) OR tx.date <> g.data THEN
    RAISE EXCEPTION 'pluggy_transacao_nao_elegivel' USING ERRCODE = '22023';
  END IF;
  op := 'pluggy:' || tx.account_id || ':' || tx.transaction_id;
  IF EXISTS (SELECT 1 FROM public.pluggy_import_entries e WHERE e.user_id = p_user_id AND e.account_id = tx.account_id AND e.transaction_id = tx.transaction_id)
     OR EXISTS (SELECT 1 FROM public.gastos x WHERE x.user_id = p_user_id AND x.id_operacao_banco = op)
     OR EXISTS (SELECT 1 FROM public.receitas x WHERE x.user_id = p_user_id AND x.id_operacao_banco = op) THEN
    RAISE EXCEPTION 'pluggy_ja_importada' USING ERRCODE = '23505';
  END IF;
  -- Coincidência com lançamento de outra origem (manual/WhatsApp/MP/extrato): nunca grava.
  IF (g.entry_table = 'gastos' AND EXISTS (SELECT 1 FROM public.gastos x WHERE x.user_id = p_user_id AND x.deleted_at IS NULL
        AND coalesce(x.origem, '') <> 'pluggy' AND round(x.valor * 100) = round(tx.amount * 100) AND abs(x.data - tx.date) <= 1))
     OR (g.entry_table = 'receitas' AND EXISTS (SELECT 1 FROM public.receitas x WHERE x.user_id = p_user_id AND x.deleted_at IS NULL
        AND coalesce(x.origem, '') <> 'pluggy' AND round(x.valor * 100) = round(tx.amount * 100) AND abs(x.data - tx.date) <= 1)) THEN
    RAISE EXCEPTION 'pluggy_possivel_duplicata' USING ERRCODE = '23505';
  END IF;

  v := (p_row->>'valor')::numeric; d := (p_row->>'data')::date;
  IF v IS NULL OR round(v * 100) <> round(tx.amount * 100) OR d IS DISTINCT FROM tx.date
     OR nullif(btrim(p_row->>'descricao'), '') IS NULL OR p_row->>'id_operacao_banco' IS DISTINCT FROM op
     OR p_row->>'cartao_id' IS NOT NULL OR p_row->>'forma_pagamento' = 'credito' THEN
    RAISE EXCEPTION 'pluggy_lancamento_invalido' USING ERRCODE = '22023';
  END IF;

  UPDATE public.pluggy_real_import_grants SET consumed_at = now(), active_txid = txid_current() WHERE id = g.id;
  INSERT INTO public.extratos_importados (id, user_id, nome_arquivo, banco, tipo_origem, status, periodo_inicio, periodo_fim, qtd_movimentacoes, total_receitas, total_despesas, observacao)
    VALUES (p_batch_id, p_user_id, 'Open Finance (Pluggy) — Mercado Pago', 'Mercado Pago', 'pluggy', 'importado', d, d, 1,
            CASE WHEN g.entry_table = 'receitas' THEN v ELSE 0 END, CASE WHEN g.entry_table = 'gastos' THEN v ELSE 0 END,
            format('Primeira importação real controlada; conector 606; conta %s; transação %s', tx.account_id, tx.transaction_id));
  new_id := gen_random_uuid();
  IF g.entry_table = 'gastos' THEN
    IF NOT EXISTS (SELECT 1 FROM public.categorias c WHERE c.id = (p_row->>'categoria_id')::uuid AND c.user_id = p_user_id) THEN
      RAISE EXCEPTION 'pluggy_categoria_invalida' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.gastos (id, user_id, categoria_id, descricao, valor, data, estabelecimento, forma_pagamento, observacao,
        mes, ano, confirmado, tipo_gasto, cartao_id, origem, import_batch_id, id_operacao_banco, fatura_competencia, invoice_month)
      VALUES (new_id, p_user_id, (p_row->>'categoria_id')::uuid, btrim(p_row->>'descricao'), v, d, coalesce(p_row->>'estabelecimento', ''),
        coalesce(nullif(p_row->>'forma_pagamento', ''), 'debito'), 'Open Finance — Mercado Pago', extract(month FROM d), extract(year FROM d), true, 'unico',
        NULL, 'pluggy', p_batch_id, op, NULL, NULL);
    SELECT updated_at INTO stamp FROM public.gastos WHERE id = new_id;
    snap := jsonb_build_object('valor', v, 'data', d, 'descricao', btrim(p_row->>'descricao'), 'categoria_id', p_row->>'categoria_id', 'updated_at', stamp);
  ELSE
    INSERT INTO public.receitas (id, user_id, descricao, valor, data, tipo, mes, ano, origem, import_batch_id, id_operacao_banco)
      VALUES (new_id, p_user_id, btrim(p_row->>'descricao'), v, d, coalesce(nullif(p_row->>'tipo', ''), 'outros'),
        extract(month FROM d), extract(year FROM d), 'pluggy', p_batch_id, op);
    SELECT updated_at INTO stamp FROM public.receitas WHERE id = new_id;
    snap := jsonb_build_object('valor', v, 'data', d, 'descricao', btrim(p_row->>'descricao'), 'categoria_id', NULL, 'updated_at', stamp);
  END IF;
  INSERT INTO public.pluggy_import_entries (user_id, account_id, transaction_id, entry_table, entry_id, batch_id, snapshot)
    VALUES (p_user_id, tx.account_id, tx.transaction_id, g.entry_table, new_id, p_batch_id, snap);
  UPDATE public.pluggy_real_import_grants SET active_txid = NULL WHERE id = g.id;
  RETURN jsonb_build_object('replay', false, 'gastos', (g.entry_table = 'gastos')::int, 'receitas', (g.entry_table = 'receitas')::int, 'batch_id', p_batch_id, 'entry_id', new_id);
END $$;

CREATE FUNCTION public.pluggy_import_revert_real_once(p_user_id uuid, p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g record; ent record; cur record; n_rev int := 0; n_kept int := 0;
BEGIN
  IF p_user_id IS DISTINCT FROM '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid THEN
    RAISE EXCEPTION 'pluggy_nao_autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM public.pluggy_assert_owner(p_user_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('pluggy-import:' || p_user_id::text, 0));
  SELECT * INTO g FROM public.pluggy_real_import_grants WHERE user_id = p_user_id AND batch_id = p_batch_id AND consumed_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_lote_inexistente' USING ERRCODE = '22023'; END IF;
  IF g.reverted_at IS NOT NULL THEN
    RETURN jsonb_build_object('replay', true, 'resultado', g.revert_outcome, 'revertidos', 0, 'preservados', g.revert_kept);
  END IF;
  UPDATE public.pluggy_real_import_grants SET active_txid = txid_current() WHERE id = g.id;
  FOR ent IN SELECT * FROM public.pluggy_import_entries e WHERE e.user_id = p_user_id AND e.batch_id = p_batch_id AND e.state = 'ativo' FOR UPDATE LOOP
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
  -- Parcial: o lançamento editado continua ativo (entrada 'ativo', lote 'parcial', sem reverted_at no lote).
  IF n_kept = 0 THEN
    UPDATE public.extratos_importados SET status = 'revertido', reverted_at = now(),
        observacao = format('Revertido: %s lançamento(s); nenhum preservado', n_rev)
      WHERE id = p_batch_id AND user_id = p_user_id;
  ELSE
    UPDATE public.extratos_importados SET status = 'parcial',
        observacao = format('Desfeito parcialmente: %s lançamento(s) revertido(s); %s preservado(s) por edição manual', n_rev, n_kept)
      WHERE id = p_batch_id AND user_id = p_user_id;
  END IF;
  UPDATE public.pluggy_real_import_grants SET reverted_at = now(), active_txid = NULL,
      revert_outcome = CASE WHEN n_kept = 0 THEN 'revertido' ELSE 'parcial' END, revert_kept = n_kept WHERE id = g.id;
  RETURN jsonb_build_object('replay', false, 'resultado', CASE WHEN n_kept = 0 THEN 'revertido' ELSE 'parcial' END, 'revertidos', n_rev, 'preservados', n_kept);
END $$;

REVOKE ALL ON FUNCTION public.pluggy_import_apply_real_once(uuid, text, text, uuid, jsonb), public.pluggy_import_revert_real_once(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pluggy_import_apply_real_once(uuid, text, text, uuid, jsonb), public.pluggy_import_revert_real_once(uuid, uuid) TO service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sandbox_exec') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.pluggy_import_apply_real_once(uuid, text, text, uuid, jsonb), public.pluggy_import_revert_real_once(uuid, uuid), public.pluggy_real_grant_in_use(uuid, text, text, text, uuid) FROM sandbox_exec';
  END IF;
END $$;

-- A autorização da movimentação específica NÃO faz parte deste arquivo. Após a
-- aprovação, é um INSERT separado, também aprovado, com valores literais:
-- INSERT INTO public.pluggy_real_import_grants (user_id, account_id, transaction_id, entry_table, valor, data, batch_id, expires_at)
-- VALUES ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1', '<account_id>', '<transaction_id>', 'receitas'|'gastos', <valor>, '<data>', '<batch_id literal>', now() + interval '24 hours');
