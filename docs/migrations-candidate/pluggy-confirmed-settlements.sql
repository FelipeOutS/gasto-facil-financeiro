-- CANDIDATA. Referências confirmadas, principal devolvido e estornos não são nova renda.
-- Exige tabelas existentes contas_a_receber/faturas_cartao; nenhuma autorização real incluída.
CREATE TABLE public.pluggy_settlement_release(id boolean PRIMARY KEY DEFAULT true CHECK(id),enabled boolean NOT NULL DEFAULT false);
INSERT INTO public.pluggy_settlement_release(id) VALUES(true);
CREATE TABLE public.pluggy_bill_snapshots(
 user_id uuid NOT NULL,account_id text NOT NULL,bill_id text NOT NULL,due_date date NOT NULL,closing_date date,total numeric NOT NULL CHECK(total>=0),currency text NOT NULL CHECK(currency='BRL'),
 payments jsonb NOT NULL,charges jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,account_id,bill_id),
 FOREIGN KEY(user_id,account_id) REFERENCES public.pluggy_accounts(user_id,account_id) ON DELETE RESTRICT,
 CHECK(jsonb_typeof(payments)='array' AND jsonb_typeof(charges)='array')
);
CREATE TABLE public.pluggy_settlements(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,account_id text NOT NULL,source_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN('advance_link','receivable_return','refund','bill_payment')),
 target_id uuid NOT NULL,amount numeric NOT NULL CHECK(amount>0),before_row jsonb,after_row jsonb,expected_after_row jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),reverted_at timestamptz,UNIQUE(user_id,account_id,source_id),
 FOREIGN KEY(user_id,account_id) REFERENCES public.pluggy_accounts(user_id,account_id) ON DELETE RESTRICT
);
REVOKE ALL ON public.pluggy_settlement_release,public.pluggy_bill_snapshots,public.pluggy_settlements FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.pluggy_bill_snapshots,public.pluggy_settlements TO authenticated,service_role;
GRANT INSERT,UPDATE ON public.pluggy_bill_snapshots TO service_role;
ALTER TABLE public.pluggy_settlement_release ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_bill_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY pluggy_bills_read ON public.pluggy_bill_snapshots FOR SELECT TO authenticated USING(user_id=auth.uid() AND pluggy_is_allowed());
CREATE POLICY pluggy_settlements_read ON public.pluggy_settlements FOR SELECT TO authenticated USING(user_id=auth.uid() AND pluggy_is_allowed());
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sandbox_exec') THEN REVOKE ALL ON public.pluggy_settlement_release,public.pluggy_bill_snapshots,public.pluggy_settlements FROM sandbox_exec; END IF; END $$;
CREATE FUNCTION public.pluggy_settlement_import_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM pluggy_settlements s WHERE s.user_id=NEW.user_id AND s.account_id=NEW.account_id AND s.source_id=NEW.transaction_id) THEN RAISE EXCEPTION 'pluggy_transacao_conciliada' USING ERRCODE='23505'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER pluggy_settlement_source_guard BEFORE INSERT ON public.pluggy_import_entries FOR EACH ROW EXECUTE FUNCTION public.pluggy_settlement_import_guard();
CREATE FUNCTION public.pluggy_settlement_apply(p_user_id uuid,p_account_id text,p_source_id text,p_kind text,p_target_id uuid,p_expected timestamptz,p_confirmed boolean,p_source_expected jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t pluggy_transactions; before_ jsonb; after_ jsonb; amount_ numeric; saved uuid; original_ numeric; paid_ numeric; paydate date; old_bill pluggy_bill_snapshots; next_bill pluggy_bill_snapshots; card uuid; invoice public.faturas_cartao; targetstamp timestamptz;
BEGIN
 IF p_user_id IS DISTINCT FROM '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid OR p_confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'pluggy_nao_autorizado'; END IF;
 PERFORM pluggy_assert_owner(p_user_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('pluggy-import:'||p_user_id::text,0));
 PERFORM 1 FROM pluggy_settlement_release WHERE enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_conciliacao_bloqueada'; END IF;
 PERFORM 1 FROM pluggy_accounts a JOIN pluggy_items i ON i.user_id=a.user_id AND i.item_id=a.item_id WHERE a.user_id=p_user_id AND a.account_id=p_account_id AND NOT a.is_sandbox AND NOT i.is_sandbox AND a.currency='BRL' AND i.connector_id=606 AND i.deleted_at IS NULL AND i.status='UPDATED' AND (i.consent_expires_at IS NULL OR i.consent_expires_at>clock_timestamp()) FOR SHARE OF a,i;
 IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_origem_nao_permitida'; END IF;
 SELECT id INTO saved FROM pluggy_settlements WHERE user_id=p_user_id AND account_id=p_account_id AND source_id=p_source_id;
 IF FOUND THEN
  IF NOT EXISTS(SELECT 1 FROM pluggy_settlements WHERE id=saved AND kind=p_kind AND target_id=p_target_id) THEN RAISE EXCEPTION 'pluggy_destino_divergente'; END IF;
  RETURN saved; -- including reversed sources: never apply twice
 END IF;
 IF p_kind='bill_payment' THEN
  -- source is the previous bank bill; the following cycle contains its payments.
  SELECT * INTO old_bill FROM pluggy_bill_snapshots WHERE user_id=p_user_id AND account_id=p_account_id AND bill_id=p_source_id FOR SHARE;
  IF NOT FOUND OR old_bill.total<=0 OR old_bill.total<>round(old_bill.total,2) THEN RAISE EXCEPTION 'pluggy_fatura_indisponivel'; END IF;
  IF (SELECT count(*) FROM pluggy_bill_snapshots WHERE user_id=p_user_id AND account_id=p_account_id AND date_trunc('month',due_date)=date_trunc('month',old_bill.due_date)+interval '1 month')<>1 THEN RAISE EXCEPTION 'pluggy_fatura_ambigua'; END IF;
  SELECT * INTO next_bill FROM pluggy_bill_snapshots WHERE user_id=p_user_id AND account_id=p_account_id AND date_trunc('month',due_date)=date_trunc('month',old_bill.due_date)+interval '1 month' FOR SHARE;
  IF (p_source_expected->>'previous')::timestamptz IS DISTINCT FROM old_bill.updated_at OR (p_source_expected->>'next')::timestamptz IS DISTINCT FROM next_bill.updated_at THEN RAISE EXCEPTION 'pluggy_origem_alterada'; END IF;
  IF old_bill.updated_at<clock_timestamp()-interval '1 day' OR next_bill.updated_at<clock_timestamp()-interval '1 day' OR jsonb_array_length(next_bill.payments)=0
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(next_bill.charges) x WHERE (x->>'amount')::numeric IS DISTINCT FROM 0 OR x->>'currencyCode' IS DISTINCT FROM 'BRL')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(next_bill.payments) x WHERE nullif(x->>'id','') IS NULL OR x->>'currencyCode' IS DISTINCT FROM 'BRL' OR (x->>'amount')::numeric IS NULL OR (x->>'amount')::numeric<=0 OR (x->>'amount')::numeric<>round((x->>'amount')::numeric,2) OR (x->>'paymentDate')::date IS NULL OR (x->>'paymentDate')::date<coalesce(old_bill.closing_date,old_bill.due_date) OR (x->>'paymentDate')::date>least(next_bill.due_date,(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date))
   OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(next_bill.payments) x)<>jsonb_array_length(next_bill.payments)
  THEN RAISE EXCEPTION 'pluggy_pagamento_requer_revisao'; END IF;
  SELECT sum((x->>'amount')::numeric),max((x->>'paymentDate')::date) INTO paid_,paydate FROM jsonb_array_elements(next_bill.payments) x;
  IF paid_ IS DISTINCT FROM old_bill.total THEN RAISE EXCEPTION 'pluggy_pagamento_divergente'; END IF;
  SELECT cartao_id INTO card FROM pluggy_card_links WHERE user_id=p_user_id AND account_id=p_account_id AND active FOR SHARE;
  IF card IS DISTINCT FROM p_target_id THEN RAISE EXCEPTION 'pluggy_vinculo_divergente'; END IF;
  PERFORM 1 FROM gastos WHERE user_id=p_user_id AND cartao_id=card AND fatura_competencia=to_char(old_bill.due_date,'YYYY-MM') AND deleted_at IS NULL FOR UPDATE;
  SELECT sum(valor) INTO original_ FROM gastos WHERE user_id=p_user_id AND cartao_id=card AND fatura_competencia=to_char(old_bill.due_date,'YYYY-MM') AND deleted_at IS NULL;
  IF original_ IS DISTINCT FROM old_bill.total THEN RAISE EXCEPTION 'pluggy_fatura_local_divergente'; END IF;
  SELECT * INTO invoice FROM faturas_cartao WHERE user_id=p_user_id AND cartao_id=card AND mes=extract(month FROM old_bill.due_date) AND ano=extract(year FROM old_bill.due_date) FOR UPDATE;
  IF FOUND THEN
   IF invoice.updated_at IS DISTINCT FROM p_expected OR invoice.status='paga' OR invoice.valor_pago<>0 THEN RAISE EXCEPTION 'pluggy_fatura_editada'; END IF;
   before_:=to_jsonb(invoice);
   UPDATE faturas_cartao SET status='paga',valor_pago=old_bill.total,data_pagamento=paydate,updated_at=clock_timestamp() WHERE id=invoice.id RETURNING to_jsonb(faturas_cartao.*) INTO after_;
  ELSE
   IF p_expected IS NOT NULL THEN RAISE EXCEPTION 'pluggy_fatura_editada'; END IF;
   INSERT INTO faturas_cartao(user_id,cartao_id,mes,ano,status,valor_pago,data_pagamento) VALUES(p_user_id,card,extract(month FROM old_bill.due_date),extract(year FROM old_bill.due_date),'paga',old_bill.total,paydate) RETURNING to_jsonb(faturas_cartao.*) INTO after_;
  END IF;
  amount_:=old_bill.total;
 ELSE
  SELECT * INTO t FROM pluggy_transactions WHERE user_id=p_user_id AND account_id=p_account_id AND transaction_id=p_source_id FOR UPDATE;
  IF NOT FOUND OR t.status<>'POSTED' OR t.deleted_at IS NOT NULL OR t.is_sandbox OR t.currency<>'BRL' OR t.amount<=0 THEN RAISE EXCEPTION 'pluggy_transacao_invalida'; END IF;
  IF EXISTS(SELECT 1 FROM pluggy_import_entries WHERE user_id=p_user_id AND account_id=p_account_id AND transaction_id=p_source_id)
   OR EXISTS(SELECT 1 FROM pluggy_real_batch_grant_items WHERE user_id=p_user_id AND account_id=p_account_id AND transaction_id=p_source_id)
   OR EXISTS(SELECT 1 FROM pluggy_real_import_grants WHERE user_id=p_user_id AND account_id=p_account_id AND transaction_id=p_source_id)
  THEN RAISE EXCEPTION 'pluggy_transacao_ja_importada'; END IF;
  IF (p_source_expected->>'transaction')::timestamptz IS DISTINCT FROM t.updated_at THEN RAISE EXCEPTION 'pluggy_origem_alterada'; END IF;
  -- soft-delete-exceção: tombstones also prevent duplicate source reuse.
  IF EXISTS(SELECT 1 FROM gastos WHERE user_id=p_user_id AND id_operacao_banco='pluggy:'||p_account_id||':'||p_source_id) OR EXISTS(SELECT 1 FROM receitas WHERE user_id=p_user_id AND id_operacao_banco='pluggy:'||p_account_id||':'||p_source_id) THEN RAISE EXCEPTION 'pluggy_transacao_ja_importada'; END IF;
  amount_:=t.amount;
  IF p_kind IN('advance_link','receivable_return') THEN
   SELECT to_jsonb(c.*),c.updated_at INTO before_,targetstamp FROM contas_a_receber c WHERE c.id=p_target_id AND c.user_id=p_user_id AND c.status<>'cancelado' FOR UPDATE;
   IF NOT FOUND OR targetstamp IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'pluggy_recebivel_editado'; END IF;
   IF p_kind='advance_link' THEN
    IF t.type<>'DEBIT' OR upper(coalesce(t.operation_type,'')) NOT IN('PIX','TRANSFERENCIA_PIX') OR amount_>(before_->>'valor_total')::numeric THEN RAISE EXCEPTION 'pluggy_adiantamento_invalido'; END IF;
    IF EXISTS(SELECT 1 FROM pluggy_settlements WHERE user_id=p_user_id AND target_id=p_target_id AND kind='advance_link' AND reverted_at IS NULL) THEN RAISE EXCEPTION 'pluggy_adiantamento_ja_vinculado'; END IF;
    after_:=before_;
   ELSE
    SELECT sum(amount) INTO original_ FROM pluggy_settlements WHERE user_id=p_user_id AND target_id=p_target_id AND kind='advance_link' AND reverted_at IS NULL;
    SELECT coalesce(sum(amount),0) INTO paid_ FROM pluggy_settlements WHERE user_id=p_user_id AND target_id=p_target_id AND kind='receivable_return' AND reverted_at IS NULL;
    IF t.type<>'CREDIT' OR upper(coalesce(t.operation_type,'')) NOT IN('PIX','TRANSFERENCIA_PIX') OR original_ IS NULL OR paid_+amount_>original_ OR amount_>(before_->>'valor_restante')::numeric THEN RAISE EXCEPTION 'pluggy_devolucao_invalida'; END IF;
    UPDATE contas_a_receber SET valor_recebido=valor_recebido+amount_,valor_restante=valor_restante-amount_,status=CASE WHEN valor_restante=amount_ THEN 'recebido' ELSE 'parcial' END,data_recebimento=CASE WHEN valor_restante=amount_ THEN t.date ELSE NULL END,updated_at=clock_timestamp() WHERE id=p_target_id RETURNING to_jsonb(contas_a_receber.*) INTO after_;
   END IF;
  ELSIF p_kind='refund' THEN
   SELECT to_jsonb(g.*),g.updated_at INTO before_,targetstamp FROM gastos g WHERE g.id=p_target_id AND g.user_id=p_user_id AND g.deleted_at IS NULL FOR UPDATE;
   IF NOT FOUND OR targetstamp IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'pluggy_compra_editada'; END IF;
   IF t.type<>'CREDIT' OR (t.classification_reason IS DISTINCT FROM 'estorno' AND upper(coalesce(t.operation_type,''))<>'ESTORNO') OR t.date<(before_->>'data')::date OR amount_>(before_->>'valor')::numeric THEN RAISE EXCEPTION 'pluggy_estorno_invalido'; END IF;
   IF (before_->>'cartao_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pluggy_card_links WHERE user_id=p_user_id AND account_id=p_account_id AND cartao_id=(before_->>'cartao_id')::uuid AND active) THEN RAISE EXCEPTION 'pluggy_vinculo_divergente'; END IF;
   UPDATE gastos SET valor=CASE WHEN valor=amount_ THEN valor ELSE valor-amount_ END,deleted_at=CASE WHEN valor=amount_ THEN clock_timestamp() ELSE NULL END,updated_at=clock_timestamp() WHERE id=p_target_id RETURNING to_jsonb(gastos.*) INTO after_;
  ELSE RAISE EXCEPTION 'pluggy_conciliacao_invalida'; END IF;
 END IF;
 INSERT INTO pluggy_settlements(user_id,account_id,source_id,kind,target_id,amount,before_row,after_row,expected_after_row) VALUES(p_user_id,p_account_id,p_source_id,p_kind,p_target_id,amount_,before_,after_,after_) RETURNING id INTO saved;
 RETURN saved;
END $$;
CREATE FUNCTION public.pluggy_settlement_undo(p_user_id uuid,p_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s pluggy_settlements; current_ jsonb; BEGIN
 IF p_user_id IS DISTINCT FROM '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid THEN RAISE EXCEPTION 'pluggy_nao_autorizado'; END IF;
 PERFORM pluggy_assert_owner(p_user_id); PERFORM pg_advisory_xact_lock(hashtextextended('pluggy-import:'||p_user_id::text,0));
 PERFORM 1 FROM pluggy_settlement_release WHERE enabled FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_conciliacao_bloqueada'; END IF;
 SELECT * INTO s FROM pluggy_settlements WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_conciliacao_inexistente'; END IF; IF s.reverted_at IS NOT NULL THEN RETURN 'replay'; END IF;
 IF s.kind='advance_link' THEN
  IF EXISTS(SELECT 1 FROM pluggy_settlements WHERE user_id=p_user_id AND target_id=s.target_id AND kind='receivable_return' AND reverted_at IS NULL) THEN RAISE EXCEPTION 'pluggy_desfaca_devolucoes_primeiro'; END IF;
 ELSIF s.kind='receivable_return' THEN
  SELECT to_jsonb(c.*) INTO current_ FROM contas_a_receber c WHERE id=s.target_id AND user_id=p_user_id FOR UPDATE;
  IF current_ IS DISTINCT FROM s.expected_after_row THEN RETURN 'preservado'; END IF;
  UPDATE contas_a_receber SET valor_recebido=(s.before_row->>'valor_recebido')::numeric,valor_restante=(s.before_row->>'valor_restante')::numeric,status=s.before_row->>'status',data_recebimento=(s.before_row->>'data_recebimento')::date,updated_at=clock_timestamp() WHERE id=s.target_id RETURNING to_jsonb(contas_a_receber.*) INTO current_;
 ELSIF s.kind='refund' THEN
  -- soft-delete-exceção: undo must compare the exact tombstone produced by this settlement.
  SELECT to_jsonb(g.*) INTO current_ FROM gastos g WHERE id=s.target_id AND user_id=p_user_id FOR UPDATE;
  IF current_ IS DISTINCT FROM s.expected_after_row THEN RETURN 'preservado'; END IF;
  UPDATE gastos SET valor=(s.before_row->>'valor')::numeric,deleted_at=(s.before_row->>'deleted_at')::timestamptz,updated_at=clock_timestamp() WHERE id=s.target_id RETURNING to_jsonb(gastos.*) INTO current_;
 ELSE
  SELECT to_jsonb(f.*) INTO current_ FROM faturas_cartao f WHERE id=(s.after_row->>'id')::uuid AND user_id=p_user_id FOR UPDATE;
  IF current_ IS DISTINCT FROM s.expected_after_row THEN RETURN 'preservado'; END IF;
  UPDATE faturas_cartao SET status=coalesce(s.before_row->>'status','aberta'),valor_pago=coalesce((s.before_row->>'valor_pago')::numeric,0),data_pagamento=(s.before_row->>'data_pagamento')::date,updated_at=clock_timestamp() WHERE id=(s.after_row->>'id')::uuid RETURNING to_jsonb(faturas_cartao.*) INTO current_;
 END IF;
 -- Advance the comparison stamp only for a predecessor restored exactly by this undo.
 -- A manual edit never reaches this point, and immutable audit snapshots remain unchanged.
 IF s.kind IN('receivable_return','refund') THEN
  UPDATE pluggy_settlements SET expected_after_row=current_ WHERE id=(
   SELECT id FROM pluggy_settlements WHERE user_id=p_user_id AND target_id=s.target_id AND kind=s.kind AND id<>s.id AND reverted_at IS NULL
    AND (expected_after_row-'updated_at')=(current_-'updated_at') ORDER BY created_at DESC,id DESC LIMIT 1
  );
 END IF;
 UPDATE pluggy_settlements SET reverted_at=clock_timestamp() WHERE id=s.id;
 RETURN 'revertido';
END $$;
REVOKE ALL ON FUNCTION public.pluggy_settlement_apply(uuid,text,text,text,uuid,timestamptz,boolean,jsonb),public.pluggy_settlement_undo(uuid,uuid),public.pluggy_settlement_import_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pluggy_settlement_apply(uuid,text,text,text,uuid,timestamptz,boolean,jsonb),public.pluggy_settlement_undo(uuid,uuid) TO service_role;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sandbox_exec') THEN REVOKE ALL ON FUNCTION public.pluggy_settlement_apply(uuid,text,text,text,uuid,timestamptz,boolean,jsonb),public.pluggy_settlement_undo(uuid,uuid),public.pluggy_settlement_import_guard() FROM sandbox_exec; END IF; END $$;
