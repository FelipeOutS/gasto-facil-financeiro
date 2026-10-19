-- CANDIDATA — NÃO APLICADA. Fase 3: importação Pluggy → Gastos/Receitas existentes.
-- Aditiva: cria 3 tabelas próprias (pluggy_card_links, pluggy_import_entries,
-- pluggy_review_decisions) e 5 funções service_role-only. NÃO altera estrutura,
-- políticas ou dados de gastos/receitas/cartoes/extratos_importados/imported_transactions.
-- Gravações financeiras BLOQUEADAS no próprio SQL; habilitação requer revisão separada.
-- Em homologação descartável, as funções só INSEREM lançamentos com origem='pluggy' e só fazem exclusão
-- reversível (deleted_at) dos lançamentos que elas mesmas criaram e que não foram editados.
-- Requer: pluggy-open-finance.sql (Rev4) e pluggy-amount-original.sql já aplicados.

-- ---------------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------------
CREATE TABLE public.pluggy_card_links (
  user_id uuid NOT NULL,
  account_id text NOT NULL,
  cartao_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, account_id),
  FOREIGN KEY (user_id, account_id) REFERENCES public.pluggy_accounts(user_id, account_id) ON DELETE CASCADE
);

REVOKE ALL ON public.pluggy_card_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pluggy_card_links TO authenticated;
GRANT ALL ON public.pluggy_card_links TO service_role;

CREATE TABLE public.pluggy_import_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account_id text NOT NULL,
  transaction_id text NOT NULL,
  entry_table text NOT NULL CHECK (entry_table IN ('gastos', 'receitas')),
  entry_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  state text NOT NULL DEFAULT 'ativo' CHECK (state IN ('ativo', 'revertido', 'removido')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, account_id, transaction_id),
  UNIQUE (entry_table, entry_id),
  FOREIGN KEY (user_id, account_id, transaction_id) REFERENCES public.pluggy_transactions(user_id, account_id, transaction_id) ON DELETE RESTRICT,
  FOREIGN KEY (batch_id) REFERENCES public.extratos_importados(id) ON DELETE RESTRICT
);

REVOKE ALL ON public.pluggy_import_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pluggy_import_entries TO authenticated;
GRANT ALL ON public.pluggy_import_entries TO service_role;
CREATE INDEX pluggy_import_entries_batch ON public.pluggy_import_entries (user_id, batch_id);

CREATE TABLE public.pluggy_review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account_id text NOT NULL,
  transaction_id text NOT NULL,
  decision text CHECK (decision IN ('aprovado', 'rejeitado')),
  previous text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, account_id, transaction_id) REFERENCES public.pluggy_transactions(user_id, account_id, transaction_id) ON DELETE RESTRICT
);

REVOKE ALL ON public.pluggy_review_decisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pluggy_review_decisions TO authenticated;
GRANT ALL ON public.pluggy_review_decisions TO service_role;
CREATE INDEX pluggy_review_decisions_tx ON public.pluggy_review_decisions (user_id, account_id, transaction_id, decided_at);

-- Lovable Cloud concede ALL por padrão a anon/authenticated (e SELECT/INSERT a sandbox_exec): revogar antes.
REVOKE ALL ON public.pluggy_card_links, public.pluggy_import_entries, public.pluggy_review_decisions FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'REVOKE ALL ON public.pluggy_card_links, public.pluggy_import_entries, public.pluggy_review_decisions FROM sandbox_exec';
  END IF;
END $$;
GRANT SELECT ON public.pluggy_card_links, public.pluggy_import_entries, public.pluggy_review_decisions TO authenticated;
GRANT ALL ON public.pluggy_card_links, public.pluggy_import_entries, public.pluggy_review_decisions TO service_role;

ALTER TABLE public.pluggy_card_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_import_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_review_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pluggy_card_links_own_select" ON public.pluggy_card_links FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.pluggy_is_allowed());
CREATE POLICY "pluggy_import_entries_own_select" ON public.pluggy_import_entries FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.pluggy_is_allowed());
CREATE POLICY "pluggy_review_decisions_own_select" ON public.pluggy_review_decisions FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.pluggy_is_allowed());

CREATE TRIGGER pluggy_card_links_touch BEFORE UPDATE ON public.pluggy_card_links FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER pluggy_import_entries_touch BEFORE UPDATE ON public.pluggy_import_entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Autorização (mesma regra de pluggy_is_allowed, mas para um p_user_id explícito do servidor)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.pluggy_assert_owner(p_user_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_user_id IS NULL
     OR p_user_id NOT IN ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid, '47df50ce-df1e-4c54-8fae-0ffb5105478d'::uuid)
     OR NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p_user_id AND ur.role = 'owner') THEN
    RAISE EXCEPTION 'pluggy_nao_autorizado' USING ERRCODE = '42501';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Bloqueio SEM configuração, tabela de release, parâmetro ou override de sessão.
-- Uma futura mudança de corpo exige autorização separada. service_role não pode substituir DDL.
CREATE FUNCTION public.pluggy_assert_financial_release()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'pluggy_gravacao_financeira_bloqueada' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.pluggy_assert_financial_release() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pluggy_assert_financial_release() TO service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sandbox_exec') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.pluggy_assert_financial_release() FROM sandbox_exec';
  END IF;
END $$;

-- Integridade validada nas tabelas NOVAS, sem índices/constraints/triggers nas finanças existentes.
CREATE FUNCTION public.pluggy_validate_relationship()
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
    PERFORM public.pluggy_assert_financial_release();
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
REVOKE ALL ON FUNCTION public.pluggy_validate_relationship() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pluggy_validate_relationship() TO service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sandbox_exec') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.pluggy_validate_relationship() FROM sandbox_exec';
  END IF;
END $$;
CREATE TRIGGER pluggy_card_links_relationship BEFORE INSERT OR UPDATE ON public.pluggy_card_links
  FOR EACH ROW EXECUTE FUNCTION public.pluggy_validate_relationship();
CREATE TRIGGER pluggy_import_entries_relationship BEFORE INSERT OR UPDATE ON public.pluggy_import_entries
  FOR EACH ROW EXECUTE FUNCTION public.pluggy_validate_relationship();

-- 3. Vínculo de cartão: só por confirmação do titular; cartão e conta precisam ser dele.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.pluggy_link_card(p_user_id uuid, p_account_id text, p_cartao_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.pluggy_assert_owner(p_user_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('pluggy-import:' || p_user_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.pluggy_accounts a WHERE a.user_id = p_user_id AND a.account_id = p_account_id AND a.type = 'CREDIT' AND a.is_sandbox AND EXISTS (SELECT 1 FROM public.pluggy_items i WHERE i.user_id=a.user_id AND i.item_id=a.item_id AND i.is_sandbox AND i.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'pluggy_conta_cartao_invalida' USING ERRCODE = '22023';
  END IF;
  -- NULL = desvincular, sem DELETE e sem alterar qualquer lançamento financeiro.
  IF p_cartao_id IS NULL THEN
    UPDATE public.pluggy_card_links SET active=false WHERE user_id=p_user_id AND account_id=p_account_id AND active;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cartoes c WHERE c.user_id = p_user_id AND c.id = p_cartao_id) THEN
    RAISE EXCEPTION 'pluggy_cartao_invalido' USING ERRCODE = '22023';
  END IF;
  -- Trocar o vínculo não move lançamentos já importados (continuam no cartão original).
  INSERT INTO public.pluggy_card_links (user_id, account_id, cartao_id) VALUES (p_user_id, p_account_id, p_cartao_id)
  ON CONFLICT (user_id, account_id) DO UPDATE SET cartao_id = EXCLUDED.cartao_id, active=true, confirmed_at = now();
END $$;

-- ---------------------------------------------------------------------------
-- 4. Decisão de revisão: idempotente, auditada, reversível (p_decision NULL = voltar a pendente).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.pluggy_review_decide(p_user_id uuid, p_account_id text, p_transaction_id text, p_decision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE prev text;
BEGIN
  PERFORM public.pluggy_assert_owner(p_user_id);
  IF p_decision IS NOT NULL AND p_decision NOT IN ('aprovado', 'rejeitado') THEN
    RAISE EXCEPTION 'pluggy_decisao_invalida' USING ERRCODE = '22023';
  END IF;
  SELECT t.review_status INTO prev FROM public.pluggy_transactions t
    WHERE t.user_id = p_user_id AND t.account_id = p_account_id AND t.transaction_id = p_transaction_id
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_transacao_inexistente' USING ERRCODE = '22023'; END IF;
  IF prev IS NOT DISTINCT FROM p_decision THEN
    RETURN jsonb_build_object('changed', false, 'decision', p_decision);
  END IF;
  UPDATE public.pluggy_transactions SET review_status = p_decision
    WHERE user_id = p_user_id AND account_id = p_account_id AND transaction_id = p_transaction_id;
  INSERT INTO public.pluggy_review_decisions (user_id, account_id, transaction_id, decision, previous)
    VALUES (p_user_id, p_account_id, p_transaction_id, p_decision, prev);
  RETURN jsonb_build_object('changed', true, 'decision', p_decision, 'previous', prev);
END $$;

-- ---------------------------------------------------------------------------
-- 5. Aplicação atômica de um plano (tudo ou nada). Revalida tudo no banco.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.pluggy_import_apply(p_user_id uuid, p_batch_id uuid, p_actions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  a jsonb; r jsonb; tx record; ent record; cur record;
  new_id uuid; d date; v numeric; snap jsonb; stamp timestamptz;
  n_g int := 0; n_r int := 0; n_up int := 0; n_rm int := 0; n_dup int := 0; n_conf int := 0;
  tot_g numeric := 0; tot_r numeric := 0; d_min date; d_max date;
BEGIN
  PERFORM public.pluggy_assert_owner(p_user_id);
  PERFORM public.pluggy_assert_financial_release();
  IF p_batch_id IS NULL OR jsonb_typeof(p_actions) IS DISTINCT FROM 'array' OR jsonb_array_length(p_actions) > 5000 THEN
    RAISE EXCEPTION 'pluggy_lote_invalido' USING ERRCODE = '22023';
  END IF;
  -- Serializa com qualquer outra importação/reversão do mesmo titular.
  PERFORM pg_advisory_xact_lock(hashtextextended('pluggy-import:' || p_user_id::text, 0));

  IF EXISTS (SELECT 1 FROM public.extratos_importados e WHERE e.id = p_batch_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.extratos_importados e WHERE e.id = p_batch_id AND e.user_id = p_user_id AND e.tipo_origem = 'pluggy') THEN
      RAISE EXCEPTION 'pluggy_lote_invalido' USING ERRCODE = '22023';
    END IF;
    -- Repetição (resposta perdida / duplo clique): nada é gravado de novo.
    RETURN jsonb_build_object('replay', true, 'gastos', 0, 'receitas', 0, 'atualizados', 0, 'removidos', 0, 'duplicados', 0, 'conflitos', 0);
  END IF;

  INSERT INTO public.extratos_importados (id, user_id, nome_arquivo, banco, tipo_origem, status, observacao)
    VALUES (p_batch_id, p_user_id, 'Open Finance (Pluggy)', 'Pluggy', 'pluggy', 'importado', 'Importação automática Open Finance');

  FOR a IN SELECT value FROM jsonb_array_elements(p_actions) LOOP
    SELECT t.* INTO tx FROM public.pluggy_transactions t
      WHERE t.user_id = p_user_id AND t.account_id = a->>'account_id' AND t.transaction_id = a->>'transaction_id' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_transacao_inexistente' USING ERRCODE = '22023'; END IF;
    IF NOT tx.is_sandbox OR NOT EXISTS (SELECT 1 FROM public.pluggy_accounts pa JOIN public.pluggy_items pi ON pi.item_id=pa.item_id AND pi.user_id=pa.user_id WHERE pa.user_id=p_user_id AND pa.account_id=tx.account_id AND pa.is_sandbox AND pi.is_sandbox AND pi.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'pluggy_sandbox_obrigatorio' USING ERRCODE = '22023';
    END IF;

    IF a->>'op' = 'insert' THEN
      -- Defesa em profundidade: revisão pendente, duplicada ou ignorada nunca entra.
      IF tx.review_status = 'rejeitado' OR tx.classification = 'ignorado'
         OR (tx.classification = 'revisao' AND tx.review_status IS DISTINCT FROM 'aprovado')
         OR (cardinality(tx.mp_match_ids)>0 AND tx.review_status IS DISTINCT FROM 'aprovado')
         OR tx.deleted_at IS NOT NULL OR tx.status IS DISTINCT FROM 'POSTED' THEN
        RAISE EXCEPTION 'pluggy_transacao_nao_elegivel' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM public.pluggy_import_entries e
                 WHERE e.user_id = p_user_id AND e.account_id = tx.account_id AND e.transaction_id = tx.transaction_id) THEN
        n_dup := n_dup + 1; CONTINUE;
      END IF;
      r := a->'row';
      v := (r->>'valor')::numeric; d := (r->>'data')::date;
      IF v IS NULL OR v <= 0 OR v > 999999999.99 OR d IS NULL OR nullif(btrim(r->>'descricao'), '') IS NULL
         OR round(v * 100) <> round(tx.amount * 100) OR d <> tx.date
         OR r->>'id_operacao_banco' IS DISTINCT FROM ('pluggy:' || tx.account_id || ':' || tx.transaction_id) THEN
        RAISE EXCEPTION 'pluggy_lancamento_invalido' USING ERRCODE = '22023';
      END IF;
      new_id := gen_random_uuid();
      IF a->>'table' = 'gastos' THEN
        IF tx.classification_reason IN ('estorno','credito_em_cartao') OR (EXISTS (SELECT 1 FROM public.pluggy_accounts pa WHERE pa.user_id=p_user_id AND pa.account_id=tx.account_id AND pa.type='BANK') AND tx.type IS DISTINCT FROM 'DEBIT') THEN
          RAISE EXCEPTION 'pluggy_lancamento_invalido' USING ERRCODE = '22023';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.categorias c WHERE c.id = (r->>'categoria_id')::uuid AND c.user_id = p_user_id) THEN
          RAISE EXCEPTION 'pluggy_categoria_invalida' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM public.pluggy_accounts pa WHERE pa.user_id = p_user_id AND pa.account_id = tx.account_id AND pa.type = 'CREDIT') THEN
          -- Compra de cartão exige vínculo confirmado e o mesmo cartão do vínculo.
          IF r->>'forma_pagamento' IS DISTINCT FROM 'credito' OR NOT EXISTS (
               SELECT 1 FROM public.pluggy_card_links l JOIN public.cartoes c ON c.id = l.cartao_id AND c.user_id = l.user_id
               WHERE l.user_id = p_user_id AND l.account_id = tx.account_id AND l.active AND l.cartao_id = (r->>'cartao_id')::uuid)
             OR coalesce(r->>'fatura_competencia', '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR NOT EXISTS (SELECT 1 FROM public.pluggy_card_links l JOIN public.cartoes c ON c.id=l.cartao_id AND c.user_id=l.user_id WHERE l.user_id=p_user_id AND l.account_id=tx.account_id AND l.active AND extract(day FROM d) <> c.dia_fechamento AND r->>'fatura_competencia' = to_char((date_trunc('month', d) + ((CASE WHEN extract(day FROM d)<=c.dia_fechamento THEN -1 ELSE 0 END) + (CASE WHEN c.dia_vencimento<=c.dia_fechamento THEN 2 ELSE 1 END)) * interval '1 month')::date, 'YYYY-MM')) THEN
            RAISE EXCEPTION 'pluggy_cartao_sem_vinculo' USING ERRCODE = '22023';
          END IF;
        ELSIF r->>'cartao_id' IS NOT NULL OR r->>'forma_pagamento' = 'credito' THEN
          RAISE EXCEPTION 'pluggy_lancamento_invalido' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.gastos (id, user_id, categoria_id, descricao, valor, data, estabelecimento, forma_pagamento, observacao,
            mes, ano, confirmado, tipo_gasto, cartao_id, origem, import_batch_id, id_operacao_banco, fatura_competencia, invoice_month)
          VALUES (new_id, p_user_id, (r->>'categoria_id')::uuid, btrim(r->>'descricao'), v, d, coalesce(r->>'estabelecimento', ''),
            r->>'forma_pagamento', nullif(r->>'observacao', ''), extract(month FROM d), extract(year FROM d), true, 'unico',
            (r->>'cartao_id')::uuid, 'pluggy', p_batch_id, r->>'id_operacao_banco', nullif(r->>'fatura_competencia', ''), NULL);
        snap := jsonb_build_object('valor', v, 'data', d, 'descricao', btrim(r->>'descricao'), 'categoria_id', r->>'categoria_id');
        n_g := n_g + 1; tot_g := tot_g + v;
      ELSIF a->>'table' = 'receitas' THEN
        IF tx.classification_reason IN ('estorno','credito_em_cartao') OR tx.type IS DISTINCT FROM 'CREDIT' OR EXISTS (SELECT 1 FROM public.pluggy_accounts pa WHERE pa.user_id = p_user_id AND pa.account_id = tx.account_id AND pa.type = 'CREDIT') THEN
          RAISE EXCEPTION 'pluggy_lancamento_invalido' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.receitas (id, user_id, descricao, valor, data, tipo, mes, ano, origem, import_batch_id, id_operacao_banco)
          VALUES (new_id, p_user_id, btrim(r->>'descricao'), v, d, coalesce(nullif(r->>'tipo', ''), 'outros'),
            extract(month FROM d), extract(year FROM d), 'pluggy', p_batch_id, r->>'id_operacao_banco');
        snap := jsonb_build_object('valor', v, 'data', d, 'descricao', btrim(r->>'descricao'), 'categoria_id', NULL);
        n_r := n_r + 1; tot_r := tot_r + v;
      ELSE
        RAISE EXCEPTION 'pluggy_lancamento_invalido' USING ERRCODE = '22023';
      END IF;
      IF a->>'table' = 'gastos' THEN SELECT updated_at INTO stamp FROM public.gastos WHERE id=new_id; ELSE SELECT updated_at INTO stamp FROM public.receitas WHERE id=new_id; END IF;
      snap := snap || jsonb_build_object('updated_at', stamp);
      INSERT INTO public.pluggy_import_entries (user_id, account_id, transaction_id, entry_table, entry_id, batch_id, snapshot)
        VALUES (p_user_id, tx.account_id, tx.transaction_id, a->>'table', new_id, p_batch_id, snap);
      d_min := least(coalesce(d_min, d), d); d_max := greatest(coalesce(d_max, d), d);

    ELSIF a->>'op' IN ('update', 'remove') THEN
      SELECT e.* INTO ent FROM public.pluggy_import_entries e
        WHERE e.user_id = p_user_id AND e.account_id = tx.account_id AND e.transaction_id = tx.transaction_id
          AND e.entry_id = (a->>'entry_id')::uuid AND e.state = 'ativo'
        FOR UPDATE;
      IF NOT FOUND THEN n_conf := n_conf + 1; CONTINUE; END IF;
      IF a->>'table' IS DISTINCT FROM ent.entry_table THEN RAISE EXCEPTION 'pluggy_lancamento_invalido' USING ERRCODE='22023'; END IF;
      -- Troca/desvínculo não move, atualiza nem remove compras do cartão anterior.
      IF ent.entry_table='gastos' AND EXISTS (SELECT 1 FROM public.pluggy_accounts pa WHERE pa.user_id=p_user_id AND pa.account_id=tx.account_id AND pa.type='CREDIT') AND NOT EXISTS (
        SELECT 1 FROM public.gastos g JOIN public.pluggy_card_links l ON l.user_id=g.user_id AND l.cartao_id=g.cartao_id
        WHERE g.id=ent.entry_id AND g.user_id=p_user_id AND l.account_id=tx.account_id AND l.active
      ) THEN n_conf := n_conf + 1; CONTINUE; END IF;
      IF a->>'op'='update' AND (tx.deleted_at IS NOT NULL OR tx.status IS DISTINCT FROM 'POSTED' OR tx.review_status='rejeitado' OR tx.classification='ignorado' OR (tx.classification='revisao' AND tx.review_status IS DISTINCT FROM 'aprovado') OR (ent.entry_table='receitas' AND tx.type IS DISTINCT FROM 'CREDIT') OR (ent.entry_table='gastos' AND EXISTS (SELECT 1 FROM public.pluggy_accounts pa WHERE pa.user_id=p_user_id AND pa.account_id=tx.account_id AND pa.type='CREDIT') AND tx.date<>(ent.snapshot->>'data')::date)) THEN RAISE EXCEPTION 'pluggy_transacao_nao_elegivel' USING ERRCODE='22023'; END IF;
      IF a->>'op'='remove' AND tx.deleted_at IS NULL AND tx.review_status IS DISTINCT FROM 'rejeitado' AND tx.classification IS DISTINCT FROM 'ignorado' THEN RAISE EXCEPTION 'pluggy_remocao_nao_elegivel' USING ERRCODE='22023'; END IF;
      IF ent.entry_table = 'gastos' THEN
        SELECT g.valor, g.data, g.descricao, g.categoria_id::text AS categoria_id, g.deleted_at, g.updated_at INTO cur FROM public.gastos g
          WHERE g.id = ent.entry_id AND g.user_id = p_user_id AND g.origem = 'pluggy' FOR UPDATE;
      ELSE
        SELECT x.valor, x.data, x.descricao, NULL::text AS categoria_id, x.deleted_at, x.updated_at INTO cur FROM public.receitas x
          WHERE x.id = ent.entry_id AND x.user_id = p_user_id AND x.origem = 'pluggy' FOR UPDATE;
      END IF;
      -- Só mexe se a linha está exatamente como o importador a deixou (nenhuma edição manual).
      IF NOT FOUND OR cur.deleted_at IS NOT NULL
         OR cur.valor <> (ent.snapshot->>'valor')::numeric OR cur.data <> (ent.snapshot->>'data')::date
         OR cur.descricao <> ent.snapshot->>'descricao'
         OR cur.categoria_id IS DISTINCT FROM ent.snapshot->>'categoria_id'
         OR (ent.snapshot ? 'updated_at' AND cur.updated_at IS DISTINCT FROM (ent.snapshot->>'updated_at')::timestamptz) THEN
        n_conf := n_conf + 1; CONTINUE;
      END IF;
      IF a->>'expected' IS NOT NULL AND ((a->'expected'->>'valor')::numeric IS DISTINCT FROM cur.valor OR (a->'expected'->>'data')::date IS DISTINCT FROM cur.data OR a->'expected'->>'descricao' IS DISTINCT FROM cur.descricao) THEN n_conf := n_conf + 1; CONTINUE; END IF;
      IF a->>'op' = 'update' THEN
        v := (a->'next'->>'valor')::numeric; d := (a->'next'->>'data')::date;
        IF v IS NULL OR v <= 0 OR v > 999999999.99 OR d IS NULL OR round(v * 100) <> round(tx.amount * 100) OR d <> tx.date THEN
          RAISE EXCEPTION 'pluggy_lancamento_invalido' USING ERRCODE = '22023';
        END IF;
        IF ent.entry_table = 'gastos' THEN
          UPDATE public.gastos SET valor = v, data = d, mes = extract(month FROM d), ano = extract(year FROM d),
            descricao = coalesce(nullif(btrim(a->'next'->>'descricao'), ''), descricao)
            WHERE id = ent.entry_id AND user_id = p_user_id;
        ELSE
          UPDATE public.receitas SET valor = v, data = d, mes = extract(month FROM d), ano = extract(year FROM d),
            descricao = coalesce(nullif(btrim(a->'next'->>'descricao'), ''), descricao)
            WHERE id = ent.entry_id AND user_id = p_user_id;
        END IF;
        IF ent.entry_table='gastos' THEN SELECT updated_at INTO stamp FROM public.gastos WHERE id=ent.entry_id; ELSE SELECT updated_at INTO stamp FROM public.receitas WHERE id=ent.entry_id; END IF;
        UPDATE public.pluggy_import_entries SET snapshot = jsonb_build_object('valor', v, 'data', d,
            'descricao', coalesce(nullif(btrim(a->'next'->>'descricao'), ''), ent.snapshot->>'descricao'), 'categoria_id', ent.snapshot->>'categoria_id', 'updated_at', stamp)
          WHERE id = ent.id;
        n_up := n_up + 1;
      ELSE
        IF ent.entry_table = 'gastos' THEN
          UPDATE public.gastos SET deleted_at = now() WHERE id = ent.entry_id AND user_id = p_user_id;
        ELSE
          UPDATE public.receitas SET deleted_at = now(), deleted_reason = left(coalesce(a->>'reason', 'pluggy'), 80), deleted_source = 'pluggy'
            WHERE id = ent.entry_id AND user_id = p_user_id;
        END IF;
        UPDATE public.pluggy_import_entries SET state = 'removido' WHERE id = ent.id;
        n_rm := n_rm + 1;
      END IF;
    ELSE
      RAISE EXCEPTION 'pluggy_lancamento_invalido' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  UPDATE public.extratos_importados SET qtd_movimentacoes = n_g + n_r, qtd_duplicadas_ignoradas = n_dup,
      total_despesas = tot_g, total_receitas = tot_r, periodo_inicio = d_min, periodo_fim = d_max
    WHERE id = p_batch_id AND user_id = p_user_id;
  RETURN jsonb_build_object('replay', false, 'gastos', n_g, 'receitas', n_r, 'atualizados', n_up, 'removidos', n_rm,
    'duplicados', n_dup, 'conflitos', n_conf);
END $$;

-- ---------------------------------------------------------------------------
-- 6. Desfazer uma importação: exclusão reversível só dos lançamentos daquele lote,
--    criados pelo importador e não editados. Idempotente. Mantém histórico.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.pluggy_import_revert(p_user_id uuid, p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE ent record; cur record; n_rev int := 0; n_kept int := 0;
BEGIN
  PERFORM public.pluggy_assert_owner(p_user_id);
  PERFORM public.pluggy_assert_financial_release();
  PERFORM pg_advisory_xact_lock(hashtextextended('pluggy-import:' || p_user_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.extratos_importados e WHERE e.id = p_batch_id AND e.user_id = p_user_id AND e.tipo_origem = 'pluggy') THEN
    RAISE EXCEPTION 'pluggy_lote_inexistente' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.extratos_importados e WHERE e.id = p_batch_id AND e.status = 'revertido') THEN
    RETURN jsonb_build_object('replay', true, 'revertidos', 0, 'preservados', 0);
  END IF;
  FOR ent IN SELECT * FROM public.pluggy_import_entries e
             WHERE e.user_id = p_user_id AND e.batch_id = p_batch_id AND e.state = 'ativo' FOR UPDATE LOOP
    IF ent.entry_table = 'gastos' THEN
      SELECT g.valor, g.data, g.descricao, g.categoria_id::text AS categoria_id, g.deleted_at, g.updated_at INTO cur FROM public.gastos g
        WHERE g.id = ent.entry_id AND g.user_id = p_user_id AND g.origem = 'pluggy' AND g.import_batch_id = p_batch_id FOR UPDATE;
    ELSE
      SELECT x.valor, x.data, x.descricao, NULL::text AS categoria_id, x.deleted_at, x.updated_at INTO cur FROM public.receitas x
        WHERE x.id = ent.entry_id AND x.user_id = p_user_id AND x.origem = 'pluggy' AND x.import_batch_id = p_batch_id FOR UPDATE;
    END IF;
    IF NOT FOUND OR cur.deleted_at IS NOT NULL
       OR cur.valor <> (ent.snapshot->>'valor')::numeric OR cur.data <> (ent.snapshot->>'data')::date
       OR cur.descricao <> ent.snapshot->>'descricao' OR cur.categoria_id IS DISTINCT FROM ent.snapshot->>'categoria_id'
         OR (ent.snapshot ? 'updated_at' AND cur.updated_at IS DISTINCT FROM (ent.snapshot->>'updated_at')::timestamptz) THEN
      n_kept := n_kept + 1; CONTINUE; -- editado pelo usuário: preservado
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
  UPDATE public.extratos_importados SET status = 'revertido', reverted_at = now(),
      observacao = format('Revertido: %s lançamentos; %s preservados por edição manual', n_rev, n_kept)
    WHERE id = p_batch_id AND user_id = p_user_id;
  RETURN jsonb_build_object('replay', false, 'revertidos', n_rev, 'preservados', n_kept);
END $$;

-- ---------------------------------------------------------------------------
-- 7. Permissões das funções: somente service_role (servidor). Nunca anon/authenticated/sandbox_exec.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.pluggy_assert_owner(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pluggy_link_card(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pluggy_review_decide(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pluggy_import_apply(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pluggy_import_revert(uuid, uuid) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.pluggy_assert_owner(uuid), public.pluggy_link_card(uuid, text, uuid), public.pluggy_review_decide(uuid, text, text, text), public.pluggy_import_apply(uuid, uuid, jsonb), public.pluggy_import_revert(uuid, uuid) FROM sandbox_exec';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.pluggy_assert_owner(uuid), public.pluggy_link_card(uuid, text, uuid),
  public.pluggy_review_decide(uuid, text, text, text), public.pluggy_import_apply(uuid, uuid, jsonb),
  public.pluggy_import_revert(uuid, uuid) TO service_role;
