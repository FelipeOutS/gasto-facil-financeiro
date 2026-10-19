-- CANDIDATA — NÃO APLICADA. Exige aprovação separada (hash informado no relatório).
-- Fase 4: importação real EM LOTE FECHADO do Mercado Pago (conector 606), só Felipe.
-- A trava global public.pluggy_assert_financial_release() NÃO é alterada.
--
-- Garantias:
-- * Autorização de lote = 1 linha em pluggy_real_batch_grants (lote fixo, prazo, quantidade
--   e total) + lista EXPLÍCITA em pluggy_real_batch_grant_items (conta, transação, tabela,
--   valor, data, categoria/tipo fixados). Só o dono do banco cria (SQL aprovado).
-- * Cada transação só pode constar de UMA autorização de lote, e nunca de uma já usada
--   pela autorização individual (primeiro teste) nem já importada (inclusive desfeita).
-- * Gravação tudo-ou-nada: a lista enviada precisa ser exatamente a autorizada; qualquer
--   item inválido aborta a transação inteira (nada é gravado e a autorização não é usada).
-- * Revalida no momento da gravação: titular, owner, conector 606, real, conta BANK,
--   POSTED, sem revisão, sem coincidência MP, natureza/valor/data iguais, sem cartão,
--   sem duplicata em Gastos/Receitas de outras origens (±1 dia) nem no MP antigo (±1 dia).
-- * Idempotente (replay) e serializado por advisory lock + FOR UPDATE.
-- * Desfazer: deleted_at só nos lançamentos do lote não editados; editados preservados.
-- Requer: pluggy-real-first-import.sql já aplicado. Sem BEGIN/COMMIT.

CREATE TABLE public.pluggy_real_batch_grants (
  batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL CHECK (user_id = '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid),
  item_count integer NOT NULL CHECK (item_count BETWEEN 1 AND 10),
  total numeric NOT NULL CHECK (total > 0),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  active_txid bigint,
  reverted_at timestamptz,
  revert_outcome text CHECK (revert_outcome IN ('revertido', 'parcial')),
  revert_kept integer CHECK (revert_kept >= 0),
  CHECK ((reverted_at IS NULL) = (revert_outcome IS NULL) AND (reverted_at IS NULL) = (revert_kept IS NULL)),
  CHECK (reverted_at IS NULL OR consumed_at IS NOT NULL),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.pluggy_real_batch_grant_items (
  batch_id uuid NOT NULL REFERENCES public.pluggy_real_batch_grants(batch_id) ON DELETE RESTRICT,
  user_id uuid NOT NULL CHECK (user_id = '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid),
  account_id text NOT NULL,
  transaction_id text NOT NULL,
  entry_table text NOT NULL CHECK (entry_table IN ('gastos', 'receitas')),
  valor numeric NOT NULL CHECK (valor > 0),
  data date NOT NULL,
  categoria_id uuid,
  tipo text,
  CHECK ((entry_table = 'gastos') = (categoria_id IS NOT NULL)),
  PRIMARY KEY (batch_id, account_id, transaction_id),
  UNIQUE (user_id, account_id, transaction_id),
  FOREIGN KEY (user_id, account_id, transaction_id) REFERENCES public.pluggy_transactions(user_id, account_id, transaction_id) ON DELETE RESTRICT
);
REVOKE ALL ON public.pluggy_real_batch_grants, public.pluggy_real_batch_grant_items FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.pluggy_real_batch_grants, public.pluggy_real_batch_grant_items TO service_role;
ALTER TABLE public.pluggy_real_batch_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_real_batch_grant_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY pluggy_real_batch_grants_service_read ON public.pluggy_real_batch_grants FOR SELECT TO service_role USING (true);
CREATE POLICY pluggy_real_batch_items_service_read ON public.pluggy_real_batch_grant_items FOR SELECT TO service_role USING (true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sandbox_exec') THEN
    EXECUTE 'REVOKE ALL ON public.pluggy_real_batch_grants, public.pluggy_real_batch_grant_items FROM sandbox_exec';
  END IF;
END $$;

-- Itens de lote não podem repetir transação da autorização individual (primeiro teste).
CREATE FUNCTION public.pluggy_real_batch_item_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.pluggy_real_import_grants g WHERE g.user_id = NEW.user_id AND g.account_id = NEW.account_id AND g.transaction_id = NEW.transaction_id)
     OR EXISTS (SELECT 1 FROM public.pluggy_import_entries e WHERE e.user_id = NEW.user_id AND e.account_id = NEW.account_id AND e.transaction_id = NEW.transaction_id) THEN
    RAISE EXCEPTION 'pluggy_transacao_ja_autorizada_ou_importada' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pluggy_real_batch_grants b WHERE b.batch_id = NEW.batch_id AND (b.user_id <> NEW.user_id OR b.consumed_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'pluggy_lote_fechado' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pluggy_real_batch_item_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER pluggy_real_batch_item_guard BEFORE INSERT OR UPDATE ON public.pluggy_real_batch_grant_items
  FOR EACH ROW EXECUTE FUNCTION public.pluggy_real_batch_item_guard();

-- Verdadeiro só para um item EXATO do lote autorizado, dentro da transação SQL que usa o lote.
CREATE FUNCTION public.pluggy_real_batch_in_use(p_user_id uuid, p_account_id text, p_transaction_id text, p_entry_table text, p_batch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.pluggy_real_batch_grants b JOIN public.pluggy_real_batch_grant_items i ON i.batch_id = b.batch_id
                 WHERE b.batch_id = p_batch_id AND b.user_id = p_user_id AND i.user_id = p_user_id
                   AND i.account_id = p_account_id AND i.transaction_id = p_transaction_id AND i.entry_table = p_entry_table
                   AND b.active_txid IS NOT NULL AND b.active_txid = txid_current());
$$;
REVOKE ALL ON FUNCTION public.pluggy_real_batch_in_use(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pluggy_real_batch_in_use(uuid, text, text, text, uuid) TO service_role;

-- Mesmo corpo da versão v2; única mudança: aceita também item exato de lote em uso.
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
    IF NOT public.pluggy_real_grant_in_use(NEW.user_id, NEW.account_id, NEW.transaction_id, NEW.entry_table, NEW.batch_id)
       AND NOT public.pluggy_real_batch_in_use(NEW.user_id, NEW.account_id, NEW.transaction_id, NEW.entry_table, NEW.batch_id) THEN
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

-- p_rows: array JSON [{account_id, transaction_id, descricao, estabelecimento?}] — exatamente os itens autorizados.
CREATE FUNCTION public.pluggy_import_apply_real_batch(p_user_id uuid, p_batch_id uuid, p_rows jsonb)
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
          WHERE pa.user_id = p_user_id AND pa.account_id = tx.account_id AND pa.type = 'BANK'
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
          AND coalesce(x.origem, '') <> 'pluggy' AND round(x.valor * 100) = round(tx.amount * 100) AND abs(x.data - tx.date) <= 1))
       OR (it.entry_table = 'receitas' AND EXISTS (SELECT 1 FROM public.receitas x WHERE x.user_id = p_user_id AND x.deleted_at IS NULL
          AND coalesce(x.origem, '') <> 'pluggy' AND round(x.valor * 100) = round(tx.amount * 100) AND abs(x.data - tx.date) <= 1))
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
          'debito', 'Open Finance — Mercado Pago', extract(month FROM it.data), extract(year FROM it.data), true, 'unico',
          NULL, 'pluggy', p_batch_id, op, NULL, NULL);
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
              jsonb_build_object('valor', it.valor, 'data', it.data, 'descricao', desc_, 'categoria_id', it.categoria_id::text, 'updated_at', stamp));
  END LOOP;
  UPDATE public.pluggy_real_batch_grants SET consumed_at = now(), active_txid = NULL WHERE batch_id = p_batch_id;
  RETURN jsonb_build_object('replay', false, 'gastos', n_g, 'receitas', n_r, 'total_gastos', t_g, 'total_receitas', t_r, 'batch_id', p_batch_id);
END $$;

CREATE FUNCTION public.pluggy_import_revert_real_batch(p_user_id uuid, p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b record; ent record; cur record; n_rev int := 0; n_kept int := 0;
BEGIN
  IF p_user_id IS DISTINCT FROM '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid THEN
    RAISE EXCEPTION 'pluggy_nao_autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM public.pluggy_assert_owner(p_user_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('pluggy-import:' || p_user_id::text, 0));
  SELECT * INTO b FROM public.pluggy_real_batch_grants WHERE user_id = p_user_id AND batch_id = p_batch_id AND consumed_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_lote_inexistente' USING ERRCODE = '22023'; END IF;
  IF b.reverted_at IS NOT NULL THEN
    RETURN jsonb_build_object('replay', true, 'resultado', b.revert_outcome, 'revertidos', 0, 'preservados', b.revert_kept);
  END IF;
  UPDATE public.pluggy_real_batch_grants SET active_txid = txid_current() WHERE batch_id = p_batch_id;
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
  IF n_kept = 0 THEN
    UPDATE public.extratos_importados SET status = 'revertido', reverted_at = now(),
        observacao = format('Revertido: %s lançamento(s); nenhum preservado', n_rev)
      WHERE id = p_batch_id AND user_id = p_user_id;
  ELSE
    UPDATE public.extratos_importados SET status = 'parcial',
        observacao = format('Desfeito parcialmente: %s lançamento(s) revertido(s); %s preservado(s) por edição manual', n_rev, n_kept)
      WHERE id = p_batch_id AND user_id = p_user_id;
  END IF;
  UPDATE public.pluggy_real_batch_grants SET reverted_at = now(), active_txid = NULL,
      revert_outcome = CASE WHEN n_kept = 0 THEN 'revertido' ELSE 'parcial' END, revert_kept = n_kept WHERE batch_id = p_batch_id;
  RETURN jsonb_build_object('replay', false, 'resultado', CASE WHEN n_kept = 0 THEN 'revertido' ELSE 'parcial' END, 'revertidos', n_rev, 'preservados', n_kept);
END $$;

REVOKE ALL ON FUNCTION public.pluggy_import_apply_real_batch(uuid, uuid, jsonb), public.pluggy_import_revert_real_batch(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pluggy_import_apply_real_batch(uuid, uuid, jsonb), public.pluggy_import_revert_real_batch(uuid, uuid) TO service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sandbox_exec') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.pluggy_import_apply_real_batch(uuid, uuid, jsonb), public.pluggy_import_revert_real_batch(uuid, uuid), public.pluggy_real_batch_in_use(uuid, text, text, text, uuid) FROM sandbox_exec';
  END IF;
END $$;

-- A autorização do lote NÃO faz parte deste arquivo. Após a aprovação, é SQL separado,
-- também aprovado, com valores literais: 1 linha em pluggy_real_batch_grants
-- (batch_id literal, item_count, total, expires_at) + 1 linha por transação em
-- pluggy_real_batch_grant_items (conta, transação, tabela, valor, data, categoria/tipo).
