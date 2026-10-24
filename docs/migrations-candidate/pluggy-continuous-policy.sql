-- CANDIDATA 2026-10-21. Não aplicada. Requer real-card-batch e partial-undo.
-- Exceção específica: política -> grant literal transitório -> escritor existente.
-- NÃO substitui pluggy_assert_financial_release. Browser nunca escreve grants.
CREATE TABLE public.pluggy_continuous_release (id boolean PRIMARY KEY DEFAULT true CHECK(id), enabled boolean NOT NULL DEFAULT false);
INSERT INTO public.pluggy_continuous_release(id) VALUES(true);
CREATE TABLE public.pluggy_continuous_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL CHECK(user_id='3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'),
 account_id text NOT NULL, enabled boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 1,
 kinds text[] NOT NULL CHECK(cardinality(kinds)>0 AND kinds <@ ARRAY['purchase','interest','salary','card_purchase']::text[]),
 categoria_id uuid, max_transaction numeric NOT NULL CHECK(max_transaction>0 AND max_transaction<=5000),
 max_daily_amount numeric NOT NULL CHECK(max_daily_amount>0 AND max_daily_amount<=20000),
 max_daily_count integer NOT NULL CHECK(max_daily_count BETWEEN 1 AND 100),
 starts_on date NOT NULL, consented_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,account_id),
 FOREIGN KEY(user_id,account_id) REFERENCES public.pluggy_accounts(user_id,account_id) ON DELETE RESTRICT
);
CREATE TABLE public.pluggy_continuous_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, policy_id uuid NOT NULL REFERENCES public.pluggy_continuous_policies(id),
 revision integer NOT NULL, account_id text NOT NULL, transaction_id text NOT NULL, source_updated_at timestamptz NOT NULL,
 outcome text NOT NULL CHECK(outcome IN('imported','review','limit')), reason text NOT NULL,
 amount numeric NOT NULL, batch_id uuid REFERENCES public.pluggy_real_batch_grants(batch_id), processed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(policy_id,transaction_id), CHECK((outcome='imported')=(batch_id IS NOT NULL))
);
CREATE TABLE public.pluggy_continuous_consent_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), policy_id uuid NOT NULL REFERENCES public.pluggy_continuous_policies(id),
 user_id uuid NOT NULL, revision integer NOT NULL, enabled boolean NOT NULL, terms jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.pluggy_continuous_release,public.pluggy_continuous_policies,public.pluggy_continuous_audit,public.pluggy_continuous_consent_log FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.pluggy_continuous_policies,public.pluggy_continuous_audit,public.pluggy_continuous_consent_log TO service_role,authenticated;
ALTER TABLE public.pluggy_continuous_release ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_continuous_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_continuous_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_continuous_consent_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY continuous_policy_read ON public.pluggy_continuous_policies FOR SELECT TO authenticated USING(user_id=auth.uid() AND public.pluggy_is_allowed());
CREATE POLICY continuous_audit_read ON public.pluggy_continuous_audit FOR SELECT TO authenticated USING(user_id=auth.uid() AND public.pluggy_is_allowed());
CREATE POLICY continuous_consent_read ON public.pluggy_continuous_consent_log FOR SELECT TO authenticated USING(user_id=auth.uid() AND public.pluggy_is_allowed());
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sandbox_exec') THEN
 REVOKE ALL ON public.pluggy_continuous_release,public.pluggy_continuous_policies,public.pluggy_continuous_audit,public.pluggy_continuous_consent_log FROM sandbox_exec;
END IF; END $$;

CREATE FUNCTION public.pluggy_continuous_kind(t public.pluggy_transactions, account_type text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN t.status<>'POSTED' OR t.deleted_at IS NOT NULL OR t.is_sandbox OR t.review_status IS NOT NULL OR t.currency<>'BRL'
 OR t.amount<=0 OR coalesce(cardinality(t.mp_match_ids),0)>0 OR t.classification NOT IN('gasto','receita')
 THEN NULL
 WHEN account_type='BANK' AND t.type='CREDIT' AND t.classification='receita' AND lower(btrim(t.description))='rendimentos' AND t.pluggy_category='Proceeds interests and dividends' AND upper(t.operation_type) IN('RESGATE_APLIC_FINANCEIRA','RENDIMENTO','JUROS') THEN 'interest'
 WHEN lower(coalesce(t.description,'')||' '||coalesce(t.pluggy_category,'')||' '||coalesce(t.operation_type,'')) ~ '(empr[eé]st|loan|financiamento|amortiza|antecipa|cr[eé]dito pessoal|adiant|reserva|resgate|transfer|pix|estorno|refund|reembols|devolu|cancel|c[aâ]mbio|cripto|crypto|fatura|payment|ajuste|adjust|saque|withdraw|capital)'
 THEN NULL
 WHEN account_type='BANK' AND t.type='DEBIT' AND t.classification='gasto' AND upper(t.operation_type) IN('COMPRA','COMPRA_DEBITO') THEN 'purchase'
 WHEN account_type='BANK' AND t.type='CREDIT' AND t.classification='receita' AND upper(t.operation_type) IN('RENDIMENTO','JUROS') THEN 'interest'
 WHEN account_type='BANK' AND t.type='CREDIT' AND t.classification='receita' AND upper(t.operation_type)='SALARIO' THEN 'salary'
 WHEN account_type='CREDIT' AND t.type='DEBIT' AND t.classification='gasto' AND t.classification_reason IN('compra_cartao','compra_cartao_valor_negativo') AND t.bill_id IS NOT NULL AND t.bill_due_date IS NOT NULL THEN 'card_purchase'
 ELSE NULL END
$$;

CREATE FUNCTION public.pluggy_continuous_set(p_user_id uuid,p_account_id text,p_enabled boolean,p_kinds text[],p_categoria_id uuid,p_max_transaction numeric,p_max_daily_amount numeric,p_max_daily_count integer,p_confirmed boolean)
RETURNS public.pluggy_continuous_policies LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.pluggy_continuous_policies; BEGIN
 IF p_user_id IS DISTINCT FROM '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid THEN RAISE EXCEPTION 'pluggy_nao_autorizado'; END IF;
 PERFORM public.pluggy_assert_owner(p_user_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('pluggy-import:'||p_user_id::text,0));
 IF p_enabled THEN
  IF p_confirmed IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM pluggy_continuous_release WHERE enabled) THEN RAISE EXCEPTION 'pluggy_politica_bloqueada'; END IF;
  PERFORM 1 FROM pluggy_accounts a JOIN pluggy_items i ON i.user_id=a.user_id AND i.item_id=a.item_id WHERE a.user_id=p_user_id AND a.account_id=p_account_id AND a.currency='BRL' AND NOT a.is_sandbox AND NOT i.is_sandbox AND i.connector_id=606 AND i.deleted_at IS NULL AND i.status='UPDATED' AND (i.consent_expires_at IS NULL OR i.consent_expires_at>clock_timestamp()) FOR SHARE OF a,i;
  IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_origem_nao_permitida'; END IF;
  IF p_kinds && ARRAY['purchase','card_purchase']::text[] AND NOT EXISTS(SELECT 1 FROM categorias WHERE id=p_categoria_id AND user_id=p_user_id) THEN RAISE EXCEPTION 'pluggy_categoria_invalida'; END IF;
  INSERT INTO pluggy_continuous_policies(user_id,account_id,enabled,kinds,categoria_id,max_transaction,max_daily_amount,max_daily_count,starts_on,consented_at,expires_at)
   VALUES(p_user_id,p_account_id,true,p_kinds,p_categoria_id,p_max_transaction,p_max_daily_amount,p_max_daily_count,(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,clock_timestamp(),clock_timestamp()+interval '90 days')
   ON CONFLICT(user_id,account_id) DO UPDATE SET enabled=true,revision=pluggy_continuous_policies.revision+1,kinds=excluded.kinds,categoria_id=excluded.categoria_id,max_transaction=excluded.max_transaction,max_daily_amount=excluded.max_daily_amount,max_daily_count=excluded.max_daily_count,starts_on=excluded.starts_on,consented_at=excluded.consented_at,expires_at=excluded.expires_at,updated_at=clock_timestamp() RETURNING * INTO p;
 ELSE
  UPDATE pluggy_continuous_policies SET enabled=false,revision=revision+1,updated_at=clock_timestamp() WHERE user_id=p_user_id AND account_id=p_account_id RETURNING * INTO p;
  IF NOT FOUND THEN RAISE EXCEPTION 'pluggy_politica_inexistente'; END IF;
 END IF;
 INSERT INTO pluggy_continuous_consent_log(policy_id,user_id,revision,enabled,terms) VALUES(p.id,p_user_id,p.revision,p.enabled,to_jsonb(p));
 RETURN p;
END $$;

CREATE FUNCTION public.pluggy_continuous_process(p_user_id uuid,p_account_id text,p_preview boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p pluggy_continuous_policies; t pluggy_transactions; a record; k text; reason_ text; batch uuid; card uuid; daily_n int; daily_sum numeric; imported_n int:=0; report jsonb:='[]'; result_ jsonb; today_ date:=(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
 IF p_user_id IS DISTINCT FROM '3324b9f8-ea68-465c-8e1e-ab1cc8caebf1'::uuid THEN RAISE EXCEPTION 'pluggy_nao_autorizado'; END IF;
 PERFORM pluggy_assert_owner(p_user_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('pluggy-import:'||p_user_id::text,0));
 SELECT * INTO p FROM pluggy_continuous_policies WHERE user_id=p_user_id AND account_id=p_account_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('blocked',true,'items','[]'::jsonb); END IF;
 IF NOT p_preview AND (NOT p.enabled OR p.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM pluggy_continuous_release WHERE enabled)) THEN RETURN jsonb_build_object('blocked',true,'items','[]'::jsonb); END IF;
 SELECT a0.type INTO a FROM pluggy_accounts a0 JOIN pluggy_items i ON i.item_id=a0.item_id AND i.user_id=a0.user_id
 WHERE a0.user_id=p_user_id AND a0.account_id=p_account_id AND NOT a0.is_sandbox AND a0.currency='BRL' AND NOT i.is_sandbox AND i.connector_id=606 AND i.deleted_at IS NULL AND i.status='UPDATED' AND (i.consent_expires_at IS NULL OR i.consent_expires_at>clock_timestamp()) FOR SHARE OF a0,i;
 IF NOT FOUND THEN RETURN jsonb_build_object('blocked',true,'reason','connection_unavailable','items','[]'::jsonb); END IF;
 SELECT count(*),coalesce(sum(amount),0) INTO daily_n,daily_sum FROM pluggy_continuous_audit WHERE policy_id=p.id AND outcome='imported' AND (processed_at AT TIME ZONE 'America/Sao_Paulo')::date=today_;
 FOR t IN SELECT tx.* FROM pluggy_transactions tx WHERE tx.user_id=p_user_id AND tx.account_id=p_account_id AND tx.deleted_at IS NULL
  AND tx.date BETWEEN greatest(p.starts_on,today_-31) AND today_
  AND NOT EXISTS(SELECT 1 FROM pluggy_import_entries e WHERE e.user_id=p_user_id AND e.account_id=tx.account_id AND e.transaction_id=tx.transaction_id)
  AND (p_preview OR NOT EXISTS(SELECT 1 FROM pluggy_continuous_audit au WHERE au.policy_id=p.id AND au.transaction_id=tx.transaction_id AND (au.outcome='imported' OR (au.revision=p.revision AND au.source_updated_at=tx.updated_at AND au.processed_at::date=clock_timestamp()::date))))
  ORDER BY tx.date,tx.transaction_id LIMIT 200 FOR UPDATE LOOP
  EXIT WHEN imported_n>=10;
  k:=pluggy_continuous_kind(t,a.type); reason_:=NULL; card:=NULL; batch:=NULL;
  IF k IS NULL OR NOT(k=ANY(p.kinds)) THEN reason_:='classification_review'; END IF;
  IF t.categoria_manual IS NOT NULL THEN reason_:='manual_classification_review'; END IF;
  IF t.amount>p.max_transaction OR daily_n>=p.max_daily_count OR daily_sum+t.amount>p.max_daily_amount THEN reason_:='safety_limit'; END IF;
  IF k='card_purchase' THEN
   SELECT cartao_id INTO card FROM pluggy_card_links WHERE user_id=p_user_id AND account_id=p_account_id AND active FOR SHARE;
   IF card IS NULL THEN reason_:='card_link_required'; END IF;
  END IF;
  -- All active origins: equality of value/day is suspicion, not permission.
  IF EXISTS(SELECT 1 FROM gastos g WHERE g.user_id=p_user_id AND g.deleted_at IS NULL AND round(g.valor*100)=round(t.amount*100) AND abs(g.data-t.date)<=1)
  OR EXISTS(SELECT 1 FROM receitas r WHERE r.user_id=p_user_id AND r.deleted_at IS NULL AND round(r.valor*100)=round(t.amount*100) AND abs(r.data-t.date)<=1)
  OR EXISTS(SELECT 1 FROM imported_transactions m WHERE m.user_id=p_user_id AND round(abs(m.amount)*100)=round(t.amount*100) AND abs(m.occurred_at::date-t.date)<=1)
  OR EXISTS(SELECT 1 FROM pluggy_real_import_grants g WHERE g.user_id=p_user_id AND g.account_id=p_account_id AND g.transaction_id=t.transaction_id)
  OR EXISTS(SELECT 1 FROM pluggy_real_batch_grant_items g WHERE g.user_id=p_user_id AND g.account_id=p_account_id AND g.transaction_id=t.transaction_id)
  THEN reason_:='duplicate_review'; END IF;
  IF reason_ IS NULL AND NOT p_preview THEN
   BEGIN
    -- Release is checked for every write; lock blocks revocation until this transaction ends.
    PERFORM 1 FROM pluggy_continuous_release WHERE enabled FOR SHARE;
    IF NOT FOUND OR NOT p.enabled OR p.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'pluggy_politica_bloqueada'; END IF;
    batch:=gen_random_uuid();
    INSERT INTO pluggy_real_batch_grants(batch_id,user_id,item_count,total,expires_at) VALUES(batch,p_user_id,1,t.amount,least(p.expires_at,clock_timestamp()+interval '1 minute'));
    INSERT INTO pluggy_real_batch_grant_items(batch_id,user_id,account_id,transaction_id,entry_table,valor,data,categoria_id,tipo,cartao_id,bill_id,bill_due_date)
     VALUES(batch,p_user_id,p_account_id,t.transaction_id,CASE t.classification WHEN 'gasto' THEN 'gastos' ELSE 'receitas' END,t.amount,t.date,CASE WHEN t.classification='gasto' THEN p.categoria_id END,CASE WHEN t.classification='receita' THEN CASE k WHEN 'salary' THEN 'salario' ELSE 'outros' END END,card,CASE WHEN card IS NOT NULL THEN t.bill_id END,CASE WHEN card IS NOT NULL THEN t.bill_due_date END);
    result_:=pluggy_import_apply_real_batch(p_user_id,batch,jsonb_build_array(jsonb_build_object('account_id',p_account_id,'transaction_id',t.transaction_id,'descricao',left(t.description,200))));
    daily_n:=daily_n+1; daily_sum:=daily_sum+t.amount; imported_n:=imported_n+1;
   EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '23505' OR SQLSTATE '42501' THEN batch:=NULL; reason_:='writer_revalidation_review';
   END;
  END IF;
  IF p_preview AND reason_ IS NULL THEN daily_n:=daily_n+1; daily_sum:=daily_sum+t.amount; imported_n:=imported_n+1; END IF;
  report:=report||jsonb_build_array(jsonb_build_object('transaction_id',t.transaction_id,'amount',t.amount,'date',t.date,'kind',k,'reason',coalesce(reason_,'eligible'),'batch_id',batch));
  IF NOT p_preview THEN
   INSERT INTO pluggy_continuous_audit(user_id,policy_id,revision,account_id,transaction_id,source_updated_at,outcome,reason,amount,batch_id)
    VALUES(p_user_id,p.id,p.revision,p_account_id,t.transaction_id,t.updated_at,CASE WHEN batch IS NOT NULL THEN 'imported' WHEN reason_='safety_limit' THEN 'limit' ELSE 'review' END,coalesce(reason_,'policy_authorized'),t.amount,batch)
    ON CONFLICT(policy_id,transaction_id) DO UPDATE SET revision=excluded.revision,source_updated_at=excluded.source_updated_at,outcome=excluded.outcome,reason=excluded.reason,amount=excluded.amount,batch_id=excluded.batch_id,processed_at=clock_timestamp() WHERE pluggy_continuous_audit.outcome<>'imported';
  END IF;
 END LOOP;
 RETURN jsonb_build_object('imported',CASE WHEN p_preview THEN 0 ELSE imported_n END,'items',report,'policy_revision',p.revision,'page_limit',200);
END $$;
REVOKE ALL ON FUNCTION public.pluggy_continuous_kind(public.pluggy_transactions,text),public.pluggy_continuous_set(uuid,text,boolean,text[],uuid,numeric,numeric,integer,boolean),public.pluggy_continuous_process(uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pluggy_continuous_set(uuid,text,boolean,text[],uuid,numeric,numeric,integer,boolean),public.pluggy_continuous_process(uuid,text,boolean) TO service_role;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sandbox_exec') THEN
 REVOKE ALL ON FUNCTION public.pluggy_continuous_kind(public.pluggy_transactions,text),public.pluggy_continuous_set(uuid,text,boolean,text[],uuid,numeric,numeric,integer,boolean),public.pluggy_continuous_process(uuid,text,boolean) FROM sandbox_exec;
END IF; END $$;
