-- PACOTE ÚNICO (não aplicado). 17 candidatos na ordem testada, sem BEGIN/COMMIT
-- (a ferramenta de migração abre UMA transação: tudo entra ou nada entra).
-- Tudo nasce desligado: release_enabled=false, preview_only=true, allowlist vazia.

-- ===== 01/17 gastos-soft-delete-f2.sql =====
-- =====================================================================
-- CANDIDATA — NÃO APLICADA. Opção A / Fase 2: exclusão reversível de gastos.
-- Só aditiva. Não altera dados existentes, não apaga nada, não muda
-- importações, faturas, bens, metas nem a cota free_ads (marcados continuam
-- contando — decisão 6). Aplicar SOMENTE após F3 (leitores filtrando
-- deleted_at IS NULL) e nova autorização.
-- =====================================================================

-- 1) Colunas (nullable, sem default, sem backfill)
ALTER TABLE public.gastos ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE public.gastos ADD COLUMN IF NOT EXISTS deleted_by uuid NULL;
ALTER TABLE public.gastos ADD COLUMN IF NOT EXISTS deletion_batch_id uuid NULL;
ALTER TABLE public.gastos ADD COLUMN IF NOT EXISTS deletion_source text NULL;

DO $$ BEGIN
  ALTER TABLE public.gastos ADD CONSTRAINT gastos_deletion_source_chk
    CHECK (deletion_source IS NULL OR deletion_source IN ('whatsapp_periodo', 'site'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Marcadores coerentes: ou todos nulos, ou todos preenchidos.
DO $$ BEGIN
  ALTER TABLE public.gastos ADD CONSTRAINT gastos_deletion_consistent_chk CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL AND deletion_batch_id IS NULL AND deletion_source IS NULL)
    OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND deletion_batch_id IS NOT NULL AND deletion_source IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Índices
CREATE INDEX IF NOT EXISTS gastos_user_data_ativos_idx
  ON public.gastos (user_id, data) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS gastos_deletion_batch_idx
  ON public.gastos (user_id, deletion_batch_id) WHERE deletion_batch_id IS NOT NULL;

-- 3) Bloqueio: marcadores só mudam dentro das RPCs abaixo.
-- Clientes (authenticated/anon, inclusive contas compartilhadas) não podem
-- gravar deleted_* em INSERT/UPDATE comuns; demais colunas seguem livres.
-- Também impede editar um gasto já marcado por UPDATE comum.
CREATE OR REPLACE FUNCTION public.tg_gastos_guard_soft_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- A GUC é só um sinal de intenção (qualquer cliente pode setá-la).
  -- A autorização real é a IDENTIDADE efetiva: dentro das RPCs SECURITY
  -- DEFINER, current_user = dono da tabela/RPCs; para clientes
  -- (anon/authenticated/service_role) current_user nunca é o dono.
  -- Esta função NÃO é SECURITY DEFINER de propósito (senão current_user
  -- seria sempre o dono).
  IF current_setting('gi.gastos_soft_delete', true) = 'on'
     AND current_user = (SELECT pg_get_userbyid(c.relowner) FROM pg_catalog.pg_class c
                          WHERE c.oid = 'public.gastos'::regclass) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NOT NULL OR NEW.deleted_by IS NOT NULL
       OR NEW.deletion_batch_id IS NOT NULL OR NEW.deletion_source IS NOT NULL THEN
      RAISE EXCEPTION 'gastos_soft_delete_fields_protected' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
       OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by
       OR NEW.deletion_batch_id IS DISTINCT FROM OLD.deletion_batch_id
       OR NEW.deletion_source IS DISTINCT FROM OLD.deletion_source THEN
      RAISE EXCEPTION 'gastos_soft_delete_fields_protected' USING ERRCODE = '42501';
    END IF;
    IF OLD.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'gastos_row_soft_deleted' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS gastos_guard_soft_delete ON public.gastos;
CREATE TRIGGER gastos_guard_soft_delete
  BEFORE INSERT OR UPDATE ON public.gastos
  FOR EACH ROW EXECUTE FUNCTION public.tg_gastos_guard_soft_delete();

-- 4) Seleção determinística do período (interna, não exposta).
-- Período por DATA local já calculada pelo app no fuso do perfil:
-- [p_ini, p_fim_excl). Só gastos ATIVOS do PRÓPRIO usuário (titular).
-- Parcelas: grupo com itens dentro E fora do período → bloqueio, a menos
-- que p_serie_completa = true (aí entra a série inteira, ativa).
CREATE OR REPLACE FUNCTION public._gastos_periodo_selecao(
  p_uid uuid, p_ini date, p_fim_excl date, p_serie_completa boolean)
RETURNS TABLE (id uuid, valor numeric, updated_at timestamptz, grupo uuid, origem text, no_periodo boolean)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH base AS (
    SELECT g.id, g.valor, g.updated_at, g.grupo_parcelamento_id AS grupo, g.origem, true AS no_periodo
    FROM public.gastos g
    WHERE g.user_id = p_uid AND g.deleted_at IS NULL
      AND g.data >= p_ini AND g.data < p_fim_excl
  ), serie AS (
    SELECT g.id, g.valor, g.updated_at, g.grupo_parcelamento_id, g.origem, false
    FROM public.gastos g
    WHERE p_serie_completa AND g.user_id = p_uid AND g.deleted_at IS NULL
      AND g.grupo_parcelamento_id IN (SELECT b.grupo FROM base b WHERE b.grupo IS NOT NULL)
      AND NOT (g.data >= p_ini AND g.data < p_fim_excl)
  )
  SELECT * FROM base UNION ALL SELECT * FROM serie
$$;

CREATE OR REPLACE FUNCTION public._gastos_snapshot_hash(p_uid uuid, p_ini date, p_fim_excl date, p_serie boolean)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT md5(coalesce(string_agg(s.id::text || ':' || s.valor::text || ':' || s.updated_at::text, '|' ORDER BY s.id), ''))
  FROM public._gastos_periodo_selecao(p_uid, p_ini, p_fim_excl, p_serie) s
$$;

-- Validação comum de período/limites.
CREATE OR REPLACE FUNCTION public._gastos_periodo_valido(p_ini date, p_fim_excl date)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_ini IS NULL OR p_fim_excl IS NULL OR p_fim_excl <= p_ini THEN
    RAISE EXCEPTION 'periodo_invalido' USING ERRCODE = '22023';
  END IF;
  IF p_fim_excl - p_ini > 366 THEN
    RAISE EXCEPTION 'periodo_longo_demais' USING ERRCODE = '22023';
  END IF;
END $$;

-- 5) PRÉVIA read-only. Identidade = auth.uid(); nunca recebe user_id.
CREATE OR REPLACE FUNCTION public.gastos_preview_exclusao_periodo(
  p_ini date, p_fim_excl date, p_serie_completa boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count int; v_sum numeric; v_parcial int; v_extra int; v_origens jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '42501'; END IF;
  PERFORM public._gastos_periodo_valido(p_ini, p_fim_excl);

  SELECT count(*), coalesce(sum(s.valor), 0), count(*) FILTER (WHERE NOT s.no_periodo)
    INTO v_count, v_sum, v_extra
    FROM public._gastos_periodo_selecao(v_uid, p_ini, p_fim_excl, p_serie_completa) s;

  -- Grupos cortados (sempre calculado sobre a seleção do período).
  SELECT count(DISTINCT b.grupo) INTO v_parcial
    FROM public._gastos_periodo_selecao(v_uid, p_ini, p_fim_excl, false) b
   WHERE b.grupo IS NOT NULL AND EXISTS (
     SELECT 1 FROM public.gastos g
      WHERE g.user_id = v_uid AND g.deleted_at IS NULL AND g.grupo_parcelamento_id = b.grupo
        AND NOT (g.data >= p_ini AND g.data < p_fim_excl));

  SELECT coalesce(jsonb_object_agg(o, n), '{}'::jsonb) INTO v_origens FROM (
    SELECT coalesce(nullif(s.origem, ''), 'manual') o, count(*) n
      FROM public._gastos_periodo_selecao(v_uid, p_ini, p_fim_excl, p_serie_completa) s GROUP BY 1) x;

  RETURN jsonb_build_object(
    'count', v_count, 'sum', v_sum, 'origens', v_origens,
    'grupos_cortados', v_parcial, 'itens_fora_do_periodo', v_extra,
    'serie_completa', p_serie_completa,
    'bloqueado', (v_parcial > 0 AND NOT p_serie_completa),
    'snapshot', public._gastos_snapshot_hash(v_uid, p_ini, p_fim_excl, p_serie_completa));
END $$;

-- 6) SOFT-DELETE atômico e idempotente.
CREATE OR REPLACE FUNCTION public.gastos_soft_delete_periodo(
  p_ini date, p_fim_excl date, p_serie_completa boolean,
  p_expected_count int, p_expected_sum numeric, p_snapshot text,
  p_batch_id uuid, p_source text DEFAULT 'whatsapp_periodo')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prev jsonb; v_done int; v_n int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '42501'; END IF;
  IF p_batch_id IS NULL THEN RAISE EXCEPTION 'batch_obrigatorio' USING ERRCODE = '22023'; END IF;
  IF p_source NOT IN ('whatsapp_periodo', 'site') THEN RAISE EXCEPTION 'origem_invalida' USING ERRCODE = '22023'; END IF;
  PERFORM public._gastos_periodo_valido(p_ini, p_fim_excl);

  -- Serializa por usuário (concorrência / cliques simultâneos).
  PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:' || v_uid::text, 0));

  -- Idempotência: lote já aplicado → mesmo resultado, nada novo.
  SELECT count(*) INTO v_done FROM public.gastos
   WHERE user_id = v_uid AND deletion_batch_id = p_batch_id;
  IF v_done > 0 THEN
    RETURN jsonb_build_object('status', 'ja_aplicado', 'count', v_done);
  END IF;

  -- Trava as linhas candidatas e revalida o snapshot.
  PERFORM 1 FROM public.gastos g
   WHERE g.id IN (SELECT s.id FROM public._gastos_periodo_selecao(v_uid, p_ini, p_fim_excl, p_serie_completa) s)
   FOR UPDATE;

  v_prev := public.gastos_preview_exclusao_periodo(p_ini, p_fim_excl, p_serie_completa);
  IF (v_prev->>'bloqueado')::boolean THEN
    RETURN jsonb_build_object('status', 'bloqueado_parcelas');
  END IF;
  IF (v_prev->>'count')::int = 0 THEN
    RETURN jsonb_build_object('status', 'vazio');
  END IF;
  IF (v_prev->>'count')::int <> p_expected_count
     OR (v_prev->>'sum')::numeric <> p_expected_sum
     OR v_prev->>'snapshot' <> p_snapshot THEN
    RETURN jsonb_build_object('status', 'divergente');
  END IF;

  PERFORM set_config('gi.gastos_soft_delete', 'on', true);
  UPDATE public.gastos g
     SET deleted_at = now(), deleted_by = v_uid,
         deletion_batch_id = p_batch_id, deletion_source = p_source
   WHERE g.user_id = v_uid AND g.deleted_at IS NULL
     AND g.id IN (SELECT s.id FROM public._gastos_periodo_selecao(v_uid, p_ini, p_fim_excl, p_serie_completa) s);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('gi.gastos_soft_delete', 'off', true);

  IF v_n <> p_expected_count THEN
    RAISE EXCEPTION 'contagem_divergente_no_commit' USING ERRCODE = '40001'; -- rollback total
  END IF;

  INSERT INTO public.audit_logs (actor_user_id, action, target_user_id, entity_type, entity_id, metadata)
  VALUES (v_uid, 'gastos_soft_delete_periodo', v_uid, 'gastos_batch', p_batch_id::text,
          jsonb_build_object('count', v_n, 'sum', p_expected_sum, 'ini', p_ini, 'fim_excl', p_fim_excl,
                             'serie_completa', p_serie_completa, 'source', p_source));

  RETURN jsonb_build_object('status', 'ok', 'count', v_n, 'sum', p_expected_sum);
END $$;

-- 7) RESTAURAÇÃO do lote (titular, até 30 dias). Depois disso nada é
-- apagado: os gastos seguem marcados e preservados (atendimento manual).
CREATE OR REPLACE FUNCTION public.gastos_restaurar_lote(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_when timestamptz; v_n int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:' || v_uid::text, 0));

  SELECT min(deleted_at) INTO v_when FROM public.gastos
   WHERE user_id = v_uid AND deletion_batch_id = p_batch_id;
  IF v_when IS NULL THEN
    RETURN jsonb_build_object('status', 'nao_encontrado'); -- inclui lote de outro usuário / já restaurado
  END IF;
  IF v_when < now() - interval '30 days' THEN
    RETURN jsonb_build_object('status', 'fora_do_prazo');
  END IF;

  PERFORM set_config('gi.gastos_soft_delete', 'on', true);
  UPDATE public.gastos SET deleted_at = NULL, deleted_by = NULL, deletion_batch_id = NULL, deletion_source = NULL
   WHERE user_id = v_uid AND deletion_batch_id = p_batch_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('gi.gastos_soft_delete', 'off', true);

  INSERT INTO public.audit_logs (actor_user_id, action, target_user_id, entity_type, entity_id, metadata)
  VALUES (v_uid, 'gastos_restaurar_lote', v_uid, 'gastos_batch', p_batch_id::text, jsonb_build_object('count', v_n));
  RETURN jsonb_build_object('status', 'ok', 'count', v_n);
END $$;

-- 8) Privilégios mínimos.
REVOKE ALL ON FUNCTION public._gastos_periodo_selecao(uuid, date, date, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._gastos_snapshot_hash(uuid, date, date, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._gastos_periodo_valido(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gastos_preview_exclusao_periodo(date, date, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gastos_soft_delete_periodo(date, date, boolean, int, numeric, text, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gastos_restaurar_lote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gastos_preview_exclusao_periodo(date, date, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gastos_soft_delete_periodo(date, date, boolean, int, numeric, text, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gastos_restaurar_lote(uuid) TO authenticated, service_role;

-- 9) Pré-condição do modelo: RPCs que marcam/restauram pertencem ao MESMO
-- papel dono de public.gastos. Se divergir, a migração falha (fail-closed).
DO $$ DECLARE v_owner oid := (SELECT relowner FROM pg_class WHERE oid = 'public.gastos'::regclass);
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid IN (
      'public.gastos_soft_delete_periodo(date,date,boolean,int,numeric,text,uuid,text)'::regprocedure,
      'public.gastos_restaurar_lote(uuid)'::regprocedure) AND proowner <> v_owner) THEN
    RAISE EXCEPTION 'rpc_owner_diferente_do_dono_de_gastos';
  END IF;
  IF v_owner IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) THEN
    RAISE EXCEPTION 'dono_de_gastos_nao_pode_ser_papel_de_cliente';
  END IF;
END $$;

-- ===== 02/17 financial-offline-generation.sql =====
-- CANDIDATE ONLY. Apply/review together with reorganization, never independently activate reset.
-- Versioned writes serialize with reset. Old clients lacking a version fail closed after reset.
CREATE TABLE public.financial_write_generations (
 user_id uuid PRIMARY KEY, generation bigint NOT NULL DEFAULT 0 CHECK(generation>=0)
);
GRANT SELECT ON public.financial_write_generations TO authenticated;
GRANT ALL ON public.financial_write_generations TO service_role;
ALTER TABLE public.financial_write_generations ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_generation ON public.financial_write_generations FOR SELECT TO authenticated USING(user_id=auth.uid());
ALTER TABLE public.gastos ADD COLUMN offline_generation bigint;
ALTER TABLE public.receitas ADD COLUMN offline_generation bigint;
CREATE FUNCTION public.financial_assert_generation(p_user uuid,p_generation bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE stored bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 SELECT generation INTO stored FROM public.financial_write_generations WHERE user_id=p_user;
 IF coalesce(p_generation,0)<>coalesce(stored,0) THEN RAISE EXCEPTION 'financial_generation_stale_review_required'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.financial_assert_generation(uuid,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.financial_assert_generation(uuid,bigint) TO authenticated,service_role;
CREATE FUNCTION public.financial_offline_generation_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.offline_client_id IS NULL THEN RETURN NEW; END IF;
 -- Only trusted security-definer reset functions set this transaction-local marker.
 IF current_setting('gi.reorganization_mutation',true)='on' AND current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID) THEN RETURN NEW; END IF;
 PERFORM public.financial_assert_generation(NEW.user_id,NEW.offline_generation);
 IF TG_OP='UPDATE' AND OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'offline_cannot_restore_deleted_entry'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.financial_offline_generation_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER financial_offline_generation_guard BEFORE INSERT OR UPDATE ON public.gastos FOR EACH ROW EXECUTE FUNCTION public.financial_offline_generation_guard();
CREATE TRIGGER financial_offline_generation_guard BEFORE INSERT OR UPDATE ON public.receitas FOR EACH ROW EXECUTE FUNCTION public.financial_offline_generation_guard();

-- ===== 03/17 account-opening-balances.sql =====
-- CANDIDATE ONLY: account baseline at end of reference day, NEVER income or reserve.
-- Not wired/released. Reorganization+balance must eventually share the same transaction.
CREATE TABLE public.account_opening_balances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
 banco_id uuid NOT NULL REFERENCES public.bancos(id) ON DELETE RESTRICT,
 amount_cents bigint NOT NULL CHECK(amount_cents>=0), effective_date date NOT NULL,
 request_id text NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,banco_id), UNIQUE(user_id,request_id)
);
GRANT SELECT ON public.account_opening_balances TO authenticated;
GRANT ALL ON public.account_opening_balances TO service_role;
ALTER TABLE public.account_opening_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_opening_balance ON public.account_opening_balances FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE FUNCTION public.account_opening_balance_candidate(p_user uuid,p_bank uuid,p_amount bigint,p_date date,p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE existing public.account_opening_balances%ROWTYPE;
BEGIN
 IF p_amount IS NULL OR p_amount<0 OR p_amount>=100000000000000 OR p_date IS NULL OR p_request IS NULL OR length(p_request) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid_baseline'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.bancos WHERE id=p_bank AND user_id=p_user FOR SHARE) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 SELECT * INTO existing FROM public.account_opening_balances WHERE user_id=p_user AND (banco_id=p_bank OR request_id=p_request) FOR UPDATE;
 IF FOUND THEN
 IF existing.banco_id=p_bank AND existing.amount_cents=p_amount AND existing.effective_date=p_date AND existing.request_id=p_request THEN RETURN jsonb_build_object('status','replay','id',existing.id); END IF;
 RETURN jsonb_build_object('status','changed'); END IF;
 -- No replacement of an existing baseline, no INSERT into receitas, no guessed bank.
 INSERT INTO public.account_opening_balances(user_id,banco_id,amount_cents,effective_date,request_id) VALUES(p_user,p_bank,p_amount,p_date,p_request) RETURNING * INTO existing;
 RETURN jsonb_build_object('status','created','id',existing.id);
END $$;
-- Helper is not directly callable by any API role. Future authorized atomic executor only.
REVOKE ALL ON FUNCTION public.account_opening_balance_candidate(uuid,uuid,bigint,date,text) FROM PUBLIC,anon,authenticated,service_role;

-- ===== 04/17 financial-fact-ledger.sql =====
-- CANDIDATE ONLY. Apply before reorganization; never migrate financial facts in development.
-- Expense visibility does not reverse issuer charges or bank cash facts.
CREATE TABLE public.financial_card_facts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, cartao_id uuid NOT NULL REFERENCES public.cartoes(id) ON DELETE RESTRICT,
 cycle text NOT NULL, source_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN('charge','payment_snapshot','payment','accounting_reversal','bank_refund','charge_refund')),
 amount_cents bigint NOT NULL CHECK(amount_cents>=0), request_id text NOT NULL, effective_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,request_id)
);
GRANT SELECT ON public.financial_card_facts TO authenticated;
GRANT ALL ON public.financial_card_facts TO service_role;
ALTER TABLE public.financial_card_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_card_facts ON public.financial_card_facts FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE TABLE public.financial_cash_facts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, banco_id uuid NOT NULL REFERENCES public.bancos(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN('opening','income_received','expense_paid','adjustment','refund','accounting_reversal')),
 amount_cents bigint NOT NULL, request_id text NOT NULL, source_id uuid, effective_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,request_id)
);
GRANT SELECT ON public.financial_cash_facts TO authenticated;
GRANT ALL ON public.financial_cash_facts TO service_role;
ALTER TABLE public.financial_cash_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_cash_facts ON public.financial_cash_facts FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE FUNCTION public.financial_fact_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'financial_fact_immutable_append_compensation'; END $$;
REVOKE ALL ON FUNCTION public.financial_fact_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_card_facts BEFORE UPDATE OR DELETE ON public.financial_card_facts FOR EACH ROW EXECUTE FUNCTION public.financial_fact_immutable();
CREATE TRIGGER immutable_cash_facts BEFORE UPDATE OR DELETE ON public.financial_cash_facts FOR EACH ROW EXECUTE FUNCTION public.financial_fact_immutable();
CREATE FUNCTION public.financial_capture_card_history(p_user uuid,p_entries jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 -- Explicit snapshot provenance, NOT invented bank payment events.
 INSERT INTO public.financial_card_facts(user_id,cartao_id,cycle,source_id,kind,amount_cents,request_id)
 SELECT g.user_id,g.cartao_id,g.fatura_competencia,g.id,'charge',round(g.valor*100)::bigint,'charge:'||g.id
 FROM public.gastos g WHERE g.user_id=p_user AND g.cartao_id IN(SELECT (e->'row'->>'cartao_id')::uuid FROM jsonb_array_elements(p_entries) e)
 AND g.deleted_at IS NULL AND g.fatura_competencia IS NOT NULL ON CONFLICT(user_id,request_id) DO NOTHING;
 INSERT INTO public.financial_card_facts(user_id,cartao_id,cycle,source_id,kind,amount_cents,request_id)
 SELECT f.user_id,f.cartao_id,to_char(make_date(f.ano,f.mes,1)+make_interval(months=>CASE WHEN c.dia_vencimento<=c.dia_fechamento THEN 2 ELSE 1 END),'YYYY-MM'),f.id,'payment_snapshot',round(coalesce(f.valor_pago,0)*100)::bigint,'legacy-invoice:'||f.id
 FROM public.faturas_cartao f JOIN public.cartoes c ON c.id=f.cartao_id AND c.user_id=f.user_id WHERE f.user_id=p_user AND f.cartao_id IN(SELECT (e->'row'->>'cartao_id')::uuid FROM jsonb_array_elements(p_entries) e)
 AND coalesce(f.valor_pago,0)>0 ON CONFLICT(user_id,request_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.financial_capture_card_history(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.financial_cash_balance(p_user uuid,p_bank uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(sum(amount_cents),0)::bigint FROM public.financial_cash_facts WHERE user_id=p_user AND banco_id=p_bank
$$;
REVOKE ALL ON FUNCTION public.financial_cash_balance(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.financial_reconcile_current(p_user uuid,p_bank uuid,p_observed bigint,p_request text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE fact public.financial_cash_facts%ROWTYPE;
BEGIN
 IF p_observed IS NULL OR abs(p_observed)>=100000000000000 OR p_request IS NULL THEN RAISE EXCEPTION 'invalid_reconciliation'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.bancos WHERE user_id=p_user AND id=p_bank FOR SHARE) THEN RAISE EXCEPTION 'bank_owner_mismatch'; END IF;
 SELECT * INTO fact FROM public.financial_cash_facts WHERE user_id=p_user AND request_id=p_request;
 IF FOUND THEN IF fact.banco_id<>p_bank THEN RAISE EXCEPTION 'reconciliation_request_conflict'; END IF; RETURN fact.id; END IF;
 INSERT INTO public.financial_cash_facts(user_id,banco_id,kind,amount_cents,request_id)
 VALUES(p_user,p_bank,'adjustment',p_observed-public.financial_cash_balance(p_user,p_bank),p_request) RETURNING * INTO fact;
 RETURN fact.id;
END $$;
REVOKE ALL ON FUNCTION public.financial_reconcile_current(uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated,service_role;

-- ===== 05/17 reorganization-card-accounting.sql =====
-- CANDIDATE ONLY. Requires F2 and whatsapp-reorganizacao.sql. Never changes payments.
-- Unpaid, uniquely mapped single purchases only. Paid/partial/unknown states fail closed.
CREATE FUNCTION public.wa_reorganization_card_supported(p_user uuid,p_row jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p_row->>'forma_pagamento'='credito'
 AND p_row->>'fatura_competencia' ~ '^\d{4}-(0[1-9]|1[0-2])$'
 AND coalesce((p_row->>'confirmado')::boolean,true)
 AND EXISTS(SELECT 1 FROM public.cartoes c WHERE c.user_id=p_user AND c.id=(p_row->>'cartao_id')::uuid)
 AND NOT EXISTS(SELECT 1 FROM public.faturas_cartao f JOIN public.cartoes c ON c.id=f.cartao_id AND c.user_id=f.user_id
 WHERE f.user_id=p_user AND f.cartao_id=(p_row->>'cartao_id')::uuid
 AND to_char(make_date(f.ano,f.mes,1)+make_interval(months=>CASE WHEN c.dia_vencimento<=c.dia_fechamento THEN 2 ELSE 1 END),'YYYY-MM')=p_row->>'fatura_competencia'
 AND (f.status NOT IN('aberta','fechada','vencida') OR f.valor_pago<>0 OR f.data_pagamento IS NOT NULL))
$$;
CREATE FUNCTION public.wa_reorganization_card_snapshot(p_user uuid,p_entries jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('cards',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.cartoes c
 WHERE c.user_id=p_user AND c.id IN(SELECT (x->'row'->>'cartao_id')::uuid FROM jsonb_array_elements(p_entries) x WHERE x->'row'->>'cartao_id' IS NOT NULL)),'[]'),
 'invoices',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM public.faturas_cartao f
 WHERE f.user_id=p_user AND f.cartao_id IN(SELECT (x->'row'->>'cartao_id')::uuid FROM jsonb_array_elements(p_entries) x WHERE x->'row'->>'cartao_id' IS NOT NULL)),'[]'))
$$;
REVOKE ALL ON FUNCTION public.wa_reorganization_card_supported(uuid,jsonb),public.wa_reorganization_card_snapshot(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- ===== 06/17 whatsapp-reorganizacao.sql =====
-- CANDIDATA, NÃO APLICADA. Preparação reversível, nunca DELETE físico.
-- Requer F2 integral. Não substitui a RPC de privacidade nem libera lote mensal.
-- release_enabled permanece FALSE; revisão de filas offline/vínculos antecede liberação.

SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.gastos'::regclass AND tgname='gastos_guard_soft_delete' AND tgenabled='O')
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.gastos'::regclass AND conname='gastos_deletion_consistent_chk' AND convalidated)
 THEN RAISE EXCEPTION 'F2_required'; END IF;
 IF current_user <> (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.gastos'::regclass)
 THEN RAISE EXCEPTION 'execute_as_gastos_owner'; END IF;
END $$;

CREATE TABLE public.whatsapp_reorganization_policy (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), release_enabled boolean NOT NULL DEFAULT false
);
GRANT SELECT ON public.whatsapp_reorganization_policy TO service_role;
ALTER TABLE public.whatsapp_reorganization_policy ENABLE ROW LEVEL SECURITY;
-- Sem row de liberação: ausência significa bloqueado. Não contém INSERT de ativação.
CREATE TABLE public.whatsapp_reorganization_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
 phone_hash text NOT NULL, request_id text NOT NULL,
 scope jsonb NOT NULL, income jsonb, opening_balance jsonb, bank_snapshot jsonb, balance_id uuid, balance_after jsonb, card_snapshot jsonb, cash_before bigint, cash_fact_id uuid, cash_fact_after jsonb, code_hash text NOT NULL UNIQUE,
 failed_attempts int NOT NULL DEFAULT 0 CHECK(failed_attempts BETWEEN 0 AND 5),
 expires_at timestamptz NOT NULL, snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'preview' CHECK(status IN('preview','applied','cancelled','changed','expired','restored','partial')),
 deleted_stamp timestamptz, after_snapshot jsonb, income_id uuid,
 income_after jsonb, result jsonb, restore_result jsonb,
 restore_code_hash text, restore_expires_at timestamptz, restore_attempts int NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(user_id,request_id)
);
GRANT SELECT ON public.whatsapp_reorganization_operations TO service_role;
ALTER TABLE public.whatsapp_reorganization_operations ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.whatsapp_reorganization_operations(user_id,phone_hash,created_at DESC);

CREATE FUNCTION public.wa_reorganization_authorized(p_user uuid,p_phone text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce((SELECT release_enabled FROM public.whatsapp_reorganization_policy WHERE id),false)
 AND coalesce(public.has_feature_access(p_user,'whatsapp'),false)
 AND length(regexp_replace(coalesce(p_phone,''),'\D','','g')) BETWEEN 10 AND 15
 AND EXISTS(SELECT 1 FROM public.whatsapp_links l WHERE l.user_id=p_user AND l.ativo
 AND l.opt_in_em IS NOT NULL AND l.revogado_em IS NULL
 AND regexp_replace(l.telefone,'\D','','g')=regexp_replace(p_phone,'\D','','g'))
$$;

-- Known financial reverse edges: never unlink/reconstruct these during generic cleanup.
CREATE FUNCTION public.wa_reorganization_has_dependency(p_entry uuid,p_table text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE relation_name text; linked boolean; target_column text;
BEGIN
 target_column:=CASE WHEN p_table='gastos' THEN 'gasto_id' ELSE 'receita_id' END;
 FOREACH relation_name IN ARRAY ARRAY['bens_pagamentos','bens_custos_aquisicao','bens_amortizacoes','contas_a_pagar','contas_a_receber'] LOOP
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=relation_name AND information_schema.columns.column_name=target_column) THEN
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE %I=$1)',relation_name,target_column) INTO linked USING p_entry;
 IF linked THEN RETURN true; END IF; END IF;
 END LOOP;
 RETURN EXISTS(SELECT 1 FROM public.pluggy_import_entries e WHERE e.entry_id=p_entry);
END $$;
REVOKE ALL ON FUNCTION public.wa_reorganization_has_dependency(uuid,text) FROM PUBLIC,anon,authenticated;

-- Full-row snapshot: caller never supplies IDs. Unknown/linked entries block the whole scope.
CREATE FUNCTION public.wa_reorganization_snapshot(p_user uuid,p_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rows jsonb;
BEGIN
 IF p_scope IS NULL OR NOT(p_scope ?& ARRAY['tables','start','end']) OR jsonb_typeof(p_scope->'tables') IS DISTINCT FROM 'array' OR jsonb_array_length(p_scope->'tables') NOT BETWEEN 1 AND 2
 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_scope->'tables') x WHERE x NOT IN('gastos','receitas'))
 OR (SELECT count(*) FROM jsonb_array_elements_text(p_scope->'tables'))<>(SELECT count(DISTINCT x) FROM jsonb_array_elements_text(p_scope->'tables') x)
 OR (p_scope->>'start' IS NOT NULL AND p_scope->>'end' IS NOT NULL AND (p_scope->>'start')::date >= (p_scope->>'end')::date)
 THEN RAISE EXCEPTION 'invalid_scope'; END IF;
 -- Excludes soft-deleted rows. Read markers of active rows only.
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'table',x->'row'->>'id'),'[]') INTO rows FROM (
 SELECT jsonb_build_object('table','gastos','row',to_jsonb(g)) x FROM public.gastos g
 WHERE g.user_id=p_user AND g.deleted_at IS NULL AND p_scope->'tables' ? 'gastos'
 AND (p_scope->>'start' IS NULL OR g.data >= (p_scope->>'start')::date)
 AND (p_scope->>'end' IS NULL OR g.data < (p_scope->>'end')::date)
 UNION ALL
 SELECT jsonb_build_object('table','receitas','row',to_jsonb(r)) FROM public.receitas r
 WHERE r.user_id=p_user AND r.deleted_at IS NULL AND p_scope->'tables' ? 'receitas'
 AND (p_scope->>'start' IS NULL OR r.data >= (p_scope->>'start')::date)
 AND (p_scope->>'end' IS NULL OR r.data < (p_scope->>'end')::date)
 ) q;
 IF jsonb_array_length(rows)>500 THEN RAISE EXCEPTION 'scope_too_large'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(rows) item WHERE
 (item->'row'->>'cartao_id' IS NOT NULL AND NOT public.wa_reorganization_card_supported(p_user,item->'row')) OR item->'row'->>'recorrencia_id' IS NOT NULL
 OR item->'row'->>'bem_id' IS NOT NULL OR item->'row'->>'import_batch_id' IS NOT NULL
 OR item->'row'->>'grupo_parcelamento_id' IS NOT NULL
 OR coalesce((item->'row'->>'total_parcelas')::int,1)>1
 OR (item->'row'->>'forma_pagamento'='credito' AND NOT public.wa_reorganization_card_supported(p_user,item->'row'))
 OR coalesce(item->'row'->>'origem','') IN('pluggy','open_finance','extrato','mercadopago','mercado_pago')
 OR EXISTS(SELECT 1 FROM public.contas_a_pagar c WHERE c.gasto_id=(item->'row'->>'id')::uuid)
 OR public.wa_reorganization_has_dependency((item->'row'->>'id')::uuid,item->>'table')
 ) THEN RAISE EXCEPTION 'linked_scope_blocked'; END IF;
 RETURN rows;
END $$;

CREATE FUNCTION public.wa_reorganization_prepare(p_user uuid,p_phone text,p_request text,p_scope jsonb,p_income jsonb,p_code text,p_balance jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.whatsapp_reorganization_operations%ROWTYPE; snap jsonb; ph text; result jsonb; bank jsonb; bank_count int;
BEGIN
 IF NOT public.wa_reorganization_authorized(p_user,p_phone) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF p_request IS NULL OR length(p_request) NOT BETWEEN 1 AND 200 OR p_code !~ '^\d{6}$' OR p_code IS NULL THEN RAISE EXCEPTION 'invalid_request'; END IF;
 IF p_income IS NOT NULL AND (jsonb_typeof(p_income)<>'object' OR p_income->>'descricao' IS NULL
 OR length(trim(p_income->>'descricao')) NOT BETWEEN 1 AND 160 OR p_income->>'valor' IS NULL
 OR (p_income->>'valor')::numeric<=0 OR (p_income->>'valor')::numeric>=1e12
 OR round((p_income->>'valor')::numeric,2)<>(p_income->>'valor')::numeric
 OR p_income->>'data' IS NULL OR p_income->>'data' !~ '^\d{4}-\d{2}-\d{2}$'
 OR coalesce(p_income->>'tipo','') NOT IN('salario','outros')) THEN RAISE EXCEPTION 'invalid_income'; END IF;
 IF p_income IS NOT NULL THEN PERFORM (p_income->>'data')::date; END IF;
 IF p_balance IS NOT NULL THEN
 IF p_income IS NOT NULL OR jsonb_typeof(p_balance)<>'object' OR p_balance->>'accountName' IS NULL OR p_balance->>'amountCents' IS NULL OR p_balance->>'amountCents' !~ '^\d+$' OR (p_balance->>'amountCents')::numeric>=100000000000000 OR p_balance->>'effectiveDate' IS NULL THEN RAISE EXCEPTION 'invalid_baseline'; END IF;
 PERFORM (p_balance->>'effectiveDate')::date;
 SELECT count(*),jsonb_agg(to_jsonb(b))->0 INTO bank_count,bank FROM public.bancos b WHERE b.user_id=p_user AND lower(trim(b.nome))=lower(trim(p_balance->>'accountName'));
 IF bank_count<>1 THEN RETURN jsonb_build_object('status','blocked'); END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 ph:=encode(sha256(convert_to(regexp_replace(p_phone,'\D','','g'),'UTF8')),'hex');
 SELECT * INTO op FROM public.whatsapp_reorganization_operations WHERE user_id=p_user AND request_id=p_request;
 IF FOUND THEN
 IF op.phone_hash<>ph OR op.scope<>p_scope OR op.income IS DISTINCT FROM p_income OR op.opening_balance IS DISTINCT FROM p_balance THEN RETURN jsonb_build_object('status','blocked'); END IF;
 RETURN jsonb_build_object('status',CASE WHEN op.status='applied' THEN 'replay' ELSE op.status END,'operationId',op.id); END IF;
 snap:=CASE WHEN p_balance IS NOT NULL AND p_scope->'tables'='[]'::jsonb THEN '[]'::jsonb ELSE public.wa_reorganization_snapshot(p_user,p_scope) END;
 IF jsonb_array_length(snap)=0 AND p_balance IS NULL THEN RETURN jsonb_build_object('status','blocked'); END IF;
 UPDATE public.whatsapp_reorganization_operations SET status='cancelled' WHERE user_id=p_user AND phone_hash=ph AND status='preview';
 INSERT INTO public.whatsapp_reorganization_operations(user_id,phone_hash,request_id,scope,income,opening_balance,bank_snapshot,card_snapshot,cash_before,code_hash,expires_at,snapshot)
 VALUES(p_user,ph,p_request,p_scope,p_income,p_balance,bank,public.wa_reorganization_card_snapshot(p_user,snap),CASE WHEN p_balance->>'kind'='current_adjustment' THEN public.financial_cash_balance(p_user,(bank->>'id')::uuid) ELSE NULL END,encode(sha256(convert_to(p_user::text||ph||p_code,'UTF8')),'hex'),clock_timestamp()+interval '5 minutes',snap) RETURNING * INTO op;
 SELECT jsonb_build_object('status','preview','operationId',op.id,'code',p_code,'expiresAt',op.expires_at,
 'scope',p_scope,'income',p_income,'openingBalance',p_balance,'cashBeforeCents',op.cash_before,'cashAdjustmentCents',CASE WHEN op.cash_before IS NOT NULL THEN (p_balance->>'amountCents')::bigint-op.cash_before ELSE NULL END,
 'expenses',count(*) FILTER(WHERE x->>'table'='gastos'),'incomes',count(*) FILTER(WHERE x->>'table'='receitas'),
 'totalExpenses',coalesce(sum((x->'row'->>'valor')::numeric) FILTER(WHERE x->>'table'='gastos'),0),
 'totalIncomes',coalesce(sum((x->'row'->>'valor')::numeric) FILTER(WHERE x->>'table'='receitas'),0)) INTO result FROM jsonb_array_elements(snap) x;
 RETURN result;
END $$;

CREATE FUNCTION public.wa_reorganization_confirm(p_user uuid,p_phone text,p_code text,p_operation uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.whatsapp_reorganization_operations%ROWTYPE; stamp timestamptz; snap jsonb; after_snap jsonb; ng int; nr int; created_income jsonb;
BEGIN
 IF p_operation IS NULL THEN RETURN jsonb_build_object('status','wrong_code'); END IF;
 IF NOT public.wa_reorganization_authorized(p_user,p_phone) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 -- Table lock must precede owner advisory lock: INSERT takes its table lock before its trigger.
 LOCK TABLE public.gastos,public.receitas,public.contas_a_pagar,public.pluggy_import_entries,public.cartoes,public.faturas_cartao,public.bancos,public.account_opening_balances,public.financial_cash_facts,public.financial_card_facts IN SHARE ROW EXCLUSIVE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 SELECT * INTO op FROM public.whatsapp_reorganization_operations WHERE user_id=p_user
 AND phone_hash=encode(sha256(convert_to(regexp_replace(p_phone,'\D','','g'),'UTF8')),'hex')
 AND id=p_operation
 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN
 -- Unrecognized codes cannot charge attempts against an unrelated latest request.
 RETURN jsonb_build_object('status','wrong_code'); END IF;
 IF op.status='applied' THEN RETURN op.result||jsonb_build_object('status','replay'); END IF;
 IF op.failed_attempts>=5 THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF p_code IS NULL OR p_code !~ '^\d{6}$' OR op.code_hash<>encode(sha256(convert_to(p_user::text||op.phone_hash||p_code,'UTF8')),'hex') THEN
 UPDATE public.whatsapp_reorganization_operations SET failed_attempts=failed_attempts+1 WHERE id=op.id;
 RETURN jsonb_build_object('status','wrong_code'); END IF;
 IF op.status<>'preview' THEN RETURN jsonb_build_object('status',op.status); END IF;
 IF clock_timestamp()>=op.expires_at THEN UPDATE public.whatsapp_reorganization_operations SET status='expired' WHERE id=op.id; RETURN jsonb_build_object('status','expired'); END IF;
 -- Locks then full snapshot comparison protect edits/dependency changes before mutation.
 -- Conservative candidate serialization prevents phantoms and new dependency links.
 -- Broad locks must be load-tested before considering release.
 LOCK TABLE public.gastos,public.receitas,public.contas_a_pagar,public.pluggy_import_entries,public.cartoes,public.faturas_cartao,public.bancos,public.account_opening_balances,public.financial_cash_facts,public.financial_card_facts IN SHARE ROW EXCLUSIVE MODE;
 PERFORM 1 FROM public.whatsapp_links WHERE user_id=p_user FOR SHARE;
 PERFORM 1 FROM public.gastos WHERE user_id=p_user AND id IN(SELECT (x->'row'->>'id')::uuid FROM jsonb_array_elements(op.snapshot) x WHERE x->>'table'='gastos') ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.receitas WHERE user_id=p_user AND id IN(SELECT (x->'row'->>'id')::uuid FROM jsonb_array_elements(op.snapshot) x WHERE x->>'table'='receitas') ORDER BY id FOR UPDATE;
 snap:=CASE WHEN op.opening_balance IS NOT NULL AND op.scope->'tables'='[]'::jsonb THEN '[]'::jsonb ELSE public.wa_reorganization_snapshot(p_user,op.scope) END;
 IF snap<>op.snapshot OR public.wa_reorganization_card_snapshot(p_user,snap) IS DISTINCT FROM op.card_snapshot THEN UPDATE public.whatsapp_reorganization_operations SET status='changed' WHERE id=op.id; RETURN jsonb_build_object('status','changed'); END IF;
 IF NOT public.wa_reorganization_authorized(p_user,p_phone) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF op.opening_balance IS NOT NULL THEN
 IF NOT EXISTS(SELECT 1 FROM public.bancos b WHERE b.user_id=p_user AND to_jsonb(b)=op.bank_snapshot) THEN RETURN jsonb_build_object('status','changed'); END IF;
 IF op.cash_before IS NOT NULL AND op.cash_before<>public.financial_cash_balance(p_user,(op.bank_snapshot->>'id')::uuid) THEN RETURN jsonb_build_object('status','changed'); END IF;
 IF coalesce(op.opening_balance->>'kind','opening')<>'current_adjustment' AND EXISTS(SELECT 1 FROM public.account_opening_balances b WHERE b.user_id=p_user AND b.banco_id=(op.bank_snapshot->>'id')::uuid) THEN RETURN jsonb_build_object('status','changed'); END IF;
 END IF;
 stamp:=clock_timestamp();
 IF to_regclass('public.financial_write_generations') IS NULL THEN RAISE EXCEPTION 'financial_generation_required'; END IF;
 PERFORM set_config('gi.reorganization_mutation','on',true);
 PERFORM public.financial_capture_card_history(p_user,snap);
 PERFORM set_config('gi.gastos_soft_delete','on',true);
 UPDATE public.gastos SET deleted_at=stamp,deleted_by=p_user,deletion_batch_id=op.id,deletion_source='whatsapp_periodo',updated_at=stamp
 WHERE user_id=p_user AND id IN(SELECT (x->'row'->>'id')::uuid FROM jsonb_array_elements(snap) x WHERE x->>'table'='gastos');
 GET DIAGNOSTICS ng=ROW_COUNT;
 PERFORM set_config('gi.gastos_soft_delete','off',true);
 UPDATE public.receitas SET deleted_at=stamp,deleted_source='whatsapp',deleted_reason='reorganizacao:'||op.id,updated_at=stamp
 WHERE user_id=p_user AND id IN(SELECT (x->'row'->>'id')::uuid FROM jsonb_array_elements(snap) x WHERE x->>'table'='receitas');
 GET DIAGNOSTICS nr=ROW_COUNT;
 IF ng+nr<>jsonb_array_length(snap) THEN RAISE EXCEPTION 'row_count_mismatch'; END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'table',x->'row'->>'id'),'[]') INTO after_snap FROM (
 SELECT jsonb_build_object('table','gastos','row',to_jsonb(g)) x FROM public.gastos g WHERE g.user_id=p_user AND g.deletion_batch_id=op.id
 UNION ALL SELECT jsonb_build_object('table','receitas','row',to_jsonb(r)) FROM public.receitas r WHERE r.user_id=p_user AND r.deleted_reason='reorganizacao:'||op.id) q;
 IF op.income IS NOT NULL THEN
 op.income_id:=gen_random_uuid();
 INSERT INTO public.receitas(id,user_id,descricao,valor,data,tipo,mes,ano,origem)
 VALUES(op.income_id,p_user,op.income->>'descricao',(op.income->>'valor')::numeric,(op.income->>'data')::date,op.income->>'tipo',extract(month FROM (op.income->>'data')::date),extract(year FROM (op.income->>'data')::date),'whatsapp');
 SELECT to_jsonb(r) INTO created_income FROM public.receitas r WHERE r.id=op.income_id AND r.user_id=p_user;
 END IF;
 IF op.opening_balance IS NOT NULL THEN
 IF op.opening_balance->>'kind'='current_adjustment' THEN
 op.cash_fact_id:=public.financial_reconcile_current(p_user,(op.bank_snapshot->>'id')::uuid,(op.opening_balance->>'amountCents')::bigint,op.id::text);
 SELECT to_jsonb(f) INTO op.cash_fact_after FROM public.financial_cash_facts f WHERE f.id=op.cash_fact_id;
 ELSE
 PERFORM public.account_opening_balance_candidate(p_user,(op.bank_snapshot->>'id')::uuid,(op.opening_balance->>'amountCents')::bigint,(op.opening_balance->>'effectiveDate')::date,op.id::text);
 SELECT id,to_jsonb(b) INTO op.balance_id,op.balance_after FROM public.account_opening_balances b WHERE b.user_id=p_user AND b.request_id=op.id::text;
 IF op.balance_id IS NULL THEN RAISE EXCEPTION 'baseline_not_committed'; END IF;
 END IF; END IF;
 INSERT INTO public.financial_write_generations(user_id,generation) VALUES(p_user,1) ON CONFLICT(user_id) DO UPDATE SET generation=financial_write_generations.generation+1;
 PERFORM set_config('gi.reorganization_mutation','off',true);
 op.result:=jsonb_build_object('status','applied','operationId',op.id,'expenses',ng,'incomes',nr,'incomeId',op.income_id,'balanceId',coalesce(op.balance_id,op.cash_fact_id));
 UPDATE public.whatsapp_reorganization_operations SET status='applied',deleted_stamp=stamp,after_snapshot=after_snap,
 balance_id=op.balance_id,balance_after=op.balance_after,cash_fact_id=op.cash_fact_id,cash_fact_after=op.cash_fact_after,income_id=op.income_id,income_after=created_income,result=op.result,completed_at=clock_timestamp() WHERE id=op.id;
 INSERT INTO public.audit_logs(actor_user_id,target_user_id,action,entity_type,entity_id,metadata)
 VALUES(p_user,p_user,'whatsapp_reorganization','financial_operation',op.id::text,op.result-'incomeId');
 RETURN op.result;
END $$;

CREATE FUNCTION public.wa_reorganization_restore_prepare(p_user uuid,p_phone text,p_operation uuid,p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.whatsapp_reorganization_operations%ROWTYPE; ph text;
BEGIN
 IF p_code IS NULL OR p_code !~ '^\d{6}$' THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF NOT coalesce(public.has_feature_access(p_user,'whatsapp'),false) OR NOT EXISTS(SELECT 1 FROM public.whatsapp_links l WHERE l.user_id=p_user AND l.ativo AND l.opt_in_em IS NOT NULL AND l.revogado_em IS NULL AND regexp_replace(l.telefone,'\D','','g')=regexp_replace(p_phone,'\D','','g')) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 ph:=encode(sha256(convert_to(regexp_replace(p_phone,'\D','','g'),'UTF8')),'hex');
 SELECT * INTO op FROM public.whatsapp_reorganization_operations WHERE id=p_operation AND user_id=p_user AND phone_hash=ph FOR UPDATE;
 IF NOT FOUND OR op.status NOT IN('applied','partial') THEN RETURN jsonb_build_object('status','blocked'); END IF;
 UPDATE public.whatsapp_reorganization_operations SET restore_code_hash=encode(sha256(convert_to(op.id::text||p_user::text||ph||p_code,'UTF8')),'hex'),restore_expires_at=clock_timestamp()+interval '5 minutes',restore_attempts=0 WHERE id=op.id RETURNING * INTO op;
 RETURN jsonb_build_object('status','restore_preview','operationId',op.id,'code',p_code,'expiresAt',op.restore_expires_at,
 'expenses',(SELECT count(*) FROM jsonb_array_elements(op.after_snapshot) x WHERE x->>'table'='gastos'),
 'incomes',(SELECT count(*) FROM jsonb_array_elements(op.after_snapshot) x WHERE x->>'table'='receitas'));
END $$;
REVOKE ALL ON FUNCTION public.wa_reorganization_restore_prepare(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_reorganization_restore_prepare(uuid,text,uuid,text) TO service_role;

CREATE FUNCTION public.wa_reorganization_control(p_user uuid,p_phone text,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.whatsapp_reorganization_operations%ROWTYPE; x jsonb; r jsonb; ng int:=0; nr int:=0; kept int:=0;
BEGIN
 -- Pause must not prevent inspecting or restoring an already completed own operation.
 IF NOT coalesce(public.has_feature_access(p_user,'whatsapp'),false) OR NOT EXISTS(SELECT 1 FROM public.whatsapp_links l WHERE l.user_id=p_user AND l.ativo AND l.opt_in_em IS NOT NULL AND l.revogado_em IS NULL AND regexp_replace(l.telefone,'\D','','g')=regexp_replace(p_phone,'\D','','g')) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF p_action='restore' OR (p_action LIKE 'restore:%' AND array_length(string_to_array(p_action,':'),1)<>3) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF p_action NOT IN('status','cancel') AND p_action NOT LIKE 'restore:%' AND p_action NOT LIKE 'status:%' OR p_action IS NULL THEN RAISE EXCEPTION 'invalid_action'; END IF;
 IF p_action LIKE 'restore:%' THEN LOCK TABLE public.gastos,public.receitas,public.contas_a_pagar,public.pluggy_import_entries,public.cartoes,public.faturas_cartao,public.bancos,public.account_opening_balances,public.financial_cash_facts,public.financial_card_facts IN SHARE ROW EXCLUSIVE MODE; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 SELECT * INTO op FROM public.whatsapp_reorganization_operations WHERE user_id=p_user AND phone_hash=encode(sha256(convert_to(regexp_replace(p_phone,'\D','','g'),'UTF8')),'hex')
 AND (position(':' IN p_action)=0 OR id=split_part(p_action,':',2)::uuid) ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF p_action='status' OR p_action LIKE 'status:%' THEN RETURN coalesce(op.restore_result,op.result,jsonb_build_object('status',op.status)); END IF;
 IF p_action='cancel' THEN
 IF op.status<>'preview' THEN RETURN coalesce(op.result,jsonb_build_object('status',op.status)); END IF;
 UPDATE public.whatsapp_reorganization_operations SET status='cancelled' WHERE id=op.id; RETURN jsonb_build_object('status','cancelled'); END IF;
 IF split_part(p_action,':',3) !~ '^\d{6}$' OR op.restore_code_hash IS DISTINCT FROM encode(sha256(convert_to(op.id::text||p_user::text||op.phone_hash||split_part(p_action,':',3),'UTF8')),'hex') THEN
 UPDATE public.whatsapp_reorganization_operations SET restore_attempts=least(restore_attempts+1,5) WHERE id=op.id; RETURN jsonb_build_object('status','wrong_code'); END IF;
 IF op.status='restored' THEN RETURN op.restore_result||jsonb_build_object('status','replay'); END IF;
 IF op.restore_attempts>=5 THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF op.restore_expires_at IS NULL OR clock_timestamp()>=op.restore_expires_at THEN RETURN jsonb_build_object('status','expired'); END IF;
 IF op.status NOT IN('applied','partial') THEN RETURN jsonb_build_object('status','blocked'); END IF;
 LOCK TABLE public.gastos,public.receitas,public.contas_a_pagar,public.pluggy_import_entries,public.cartoes,public.faturas_cartao,public.bancos,public.account_opening_balances,public.financial_cash_facts,public.financial_card_facts IN SHARE ROW EXCLUSIVE MODE;
 PERFORM 1 FROM public.whatsapp_links WHERE user_id=p_user FOR SHARE;
 IF NOT coalesce(public.has_feature_access(p_user,'whatsapp'),false) OR NOT EXISTS(SELECT 1 FROM public.whatsapp_links l WHERE l.user_id=p_user AND l.ativo AND l.opt_in_em IS NOT NULL AND l.revogado_em IS NULL AND regexp_replace(l.telefone,'\D','','g')=regexp_replace(p_phone,'\D','','g')) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF public.wa_reorganization_card_snapshot(p_user,op.snapshot) IS DISTINCT FROM op.card_snapshot THEN RETURN jsonb_build_object('status','changed'); END IF;
 IF op.balance_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.account_opening_balances b WHERE b.user_id=p_user AND b.id=op.balance_id AND to_jsonb(b)=op.balance_after) THEN RETURN jsonb_build_object('status','changed'); END IF;
 -- Compound baseline restore must never revoke the baseline while leaving conflicted deletion rows.
 IF (op.balance_id IS NOT NULL OR op.cash_fact_id IS NOT NULL) AND EXISTS(SELECT 1 FROM jsonb_array_elements(op.after_snapshot) entry_snapshot WHERE
 public.wa_reorganization_has_dependency((entry_snapshot->'row'->>'id')::uuid,entry_snapshot->>'table') OR
 (entry_snapshot->>'table'='gastos' AND NOT EXISTS(SELECT 1 FROM public.gastos g WHERE g.user_id=p_user AND g.id=(entry_snapshot->'row'->>'id')::uuid AND to_jsonb(g)=entry_snapshot->'row')) OR
 (entry_snapshot->>'table'='receitas' AND NOT EXISTS(SELECT 1 FROM public.receitas income_row WHERE income_row.user_id=p_user AND income_row.id=(entry_snapshot->'row'->>'id')::uuid AND to_jsonb(income_row)=entry_snapshot->'row')))
 THEN RETURN jsonb_build_object('status','changed'); END IF;
 PERFORM set_config('gi.reorganization_mutation','on',true);
 IF op.cash_fact_id IS NOT NULL THEN
 IF NOT EXISTS(SELECT 1 FROM public.financial_cash_facts f WHERE f.id=op.cash_fact_id AND to_jsonb(f)=op.cash_fact_after) THEN RAISE EXCEPTION 'cash_snapshot_changed'; END IF;
 INSERT INTO public.financial_cash_facts(user_id,banco_id,kind,amount_cents,request_id,source_id) SELECT user_id,banco_id,'accounting_reversal',-amount_cents,'restore:'||op.id,id FROM public.financial_cash_facts WHERE id=op.cash_fact_id ON CONFLICT(user_id,request_id) DO NOTHING;
 END IF;
 IF op.balance_id IS NOT NULL THEN UPDATE public.account_opening_balances SET revoked_at=clock_timestamp() WHERE id=op.balance_id AND user_id=p_user; END IF;
 -- Full after snapshots preserve edits. Only own exact deletion stamp may be reversed.
 FOR x IN SELECT value FROM jsonb_array_elements(op.after_snapshot) LOOP
 r:=NULL;
 IF EXISTS(SELECT 1 FROM public.contas_a_pagar c WHERE c.gasto_id=(x->'row'->>'id')::uuid)
 OR public.wa_reorganization_has_dependency((x->'row'->>'id')::uuid,x->>'table') THEN kept:=kept+1; CONTINUE; END IF;
 IF x->>'table'='gastos' THEN
 SELECT to_jsonb(g) INTO r FROM public.gastos g WHERE g.user_id=p_user AND g.id=(x->'row'->>'id')::uuid FOR UPDATE;
 IF r IS DISTINCT FROM x->'row' OR (r->>'deleted_at')::timestamptz IS DISTINCT FROM op.deleted_stamp THEN kept:=kept+1; CONTINUE; END IF;
 PERFORM set_config('gi.gastos_soft_delete','on',true);
 UPDATE public.gastos SET deleted_at=NULL,deleted_by=NULL,deletion_batch_id=NULL,deletion_source=NULL,updated_at=clock_timestamp() WHERE id=(r->>'id')::uuid AND user_id=p_user;
 PERFORM set_config('gi.gastos_soft_delete','off',true); ng:=ng+1;
 ELSE
 SELECT to_jsonb(t) INTO r FROM public.receitas t WHERE t.user_id=p_user AND t.id=(x->'row'->>'id')::uuid FOR UPDATE;
 IF r IS DISTINCT FROM x->'row' OR (r->>'deleted_at')::timestamptz IS DISTINCT FROM op.deleted_stamp THEN kept:=kept+1; CONTINUE; END IF;
 UPDATE public.receitas SET deleted_at=NULL,deleted_source=NULL,deleted_reason=NULL,updated_at=clock_timestamp() WHERE id=(r->>'id')::uuid AND user_id=p_user; nr:=nr+1;
 END IF;
 END LOOP;
 IF op.income_id IS NOT NULL THEN
 SELECT to_jsonb(t) INTO r FROM public.receitas t WHERE t.id=op.income_id AND t.user_id=p_user FOR UPDATE;
 IF r->>'deleted_reason'='reorganizacao_desfeita:'||op.id THEN NULL;
 ELSIF r=op.income_after AND NOT public.wa_reorganization_has_dependency(op.income_id,'receitas') AND r->>'recorrencia_id' IS NULL AND r->>'import_batch_id' IS NULL THEN UPDATE public.receitas SET deleted_at=clock_timestamp(),deleted_source='whatsapp',deleted_reason='reorganizacao_desfeita:'||op.id,updated_at=clock_timestamp() WHERE id=op.income_id AND user_id=p_user;
 ELSE kept:=kept+1; END IF;
 END IF;
 PERFORM set_config('gi.reorganization_mutation','off',true);
 op.restore_result:=jsonb_build_object('status',CASE WHEN kept>0 THEN 'partial' ELSE 'restored' END,'operationId',op.id,'expenses',ng,'incomes',nr,'kept',kept);
 UPDATE public.whatsapp_reorganization_operations SET status=CASE WHEN kept>0 THEN 'partial' ELSE 'restored' END,restore_result=op.restore_result,
 restore_expires_at=NULL,
 after_snapshot=CASE WHEN kept>0 THEN (SELECT coalesce(jsonb_agg(s),'[]') FROM jsonb_array_elements(op.after_snapshot) s WHERE
 (s->>'table'='gastos' AND EXISTS(SELECT 1 FROM gastos g WHERE g.user_id=p_user AND g.id=(s->'row'->>'id')::uuid AND g.deleted_at=op.deleted_stamp)) OR
 (s->>'table'='receitas' AND EXISTS(SELECT 1 FROM receitas r WHERE r.user_id=p_user AND r.id=(s->'row'->>'id')::uuid AND r.deleted_at=op.deleted_stamp))) ELSE after_snapshot END WHERE id=op.id;
 INSERT INTO public.audit_logs(actor_user_id,target_user_id,action,entity_type,entity_id,metadata)
 VALUES(p_user,p_user,'whatsapp_reorganization_restore','financial_operation',op.id::text,op.restore_result);
 RETURN op.restore_result;
END $$;

REVOKE ALL ON FUNCTION public.wa_reorganization_authorized(uuid,text),public.wa_reorganization_snapshot(uuid,jsonb),public.wa_reorganization_prepare(uuid,text,text,jsonb,jsonb,text,jsonb),public.wa_reorganization_confirm(uuid,text,text,uuid),public.wa_reorganization_control(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_reorganization_authorized(uuid,text),public.wa_reorganization_prepare(uuid,text,text,jsonb,jsonb,text,jsonb),public.wa_reorganization_confirm(uuid,text,text,uuid),public.wa_reorganization_control(uuid,text,text) TO service_role;

-- ===== 07/17 financial-card-visibility.sql =====
-- CANDIDATE ONLY. Requires financial-fact-ledger + base card helper.
-- Lifecycle hiding preserves creditor liability; never simulates a charge refund.
CREATE OR REPLACE FUNCTION public.wa_reorganization_card_supported(p_user uuid,p_row jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p_row->>'forma_pagamento'='credito'
 AND p_row->>'fatura_competencia' ~ '^\d{4}-(0[1-9]|1[0-2])$'
 AND coalesce((p_row->>'confirmado')::boolean,true)
 AND EXISTS(SELECT 1 FROM public.cartoes c WHERE c.user_id=p_user AND c.id=(p_row->>'cartao_id')::uuid)
 AND NOT EXISTS(SELECT 1 FROM public.faturas_cartao f WHERE f.user_id=p_user AND f.cartao_id=(p_row->>'cartao_id')::uuid AND (f.valor_pago<0 OR f.status NOT IN('aberta','fechada','vencida','paga')))
$$;
-- Existing base helper's ACL remains revoked. Only verified reset routines may call it.
CREATE FUNCTION public.financial_invoice_positions(p_user uuid)
RETURNS TABLE(cartao_id uuid,cycle text,charged_cents bigint,paid_cents bigint,pending_cents bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT f.cartao_id,f.cycle,
 sum(CASE WHEN f.kind='charge' THEN f.amount_cents WHEN f.kind='charge_refund' THEN -f.amount_cents ELSE 0 END)::bigint,
 sum(CASE WHEN f.kind IN('payment','payment_snapshot') THEN f.amount_cents WHEN f.kind IN('accounting_reversal','bank_refund') THEN -f.amount_cents ELSE 0 END)::bigint,
 greatest(0,sum(CASE WHEN f.kind='charge' THEN f.amount_cents WHEN f.kind='charge_refund' THEN -f.amount_cents WHEN f.kind IN('payment','payment_snapshot') THEN -f.amount_cents WHEN f.kind IN('accounting_reversal','bank_refund') THEN f.amount_cents ELSE 0 END))::bigint
 FROM public.financial_card_facts f WHERE f.user_id=p_user AND auth.uid()=p_user GROUP BY f.cartao_id,f.cycle
$$;
REVOKE ALL ON FUNCTION public.financial_invoice_positions(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.financial_invoice_positions(uuid) TO authenticated,service_role;

-- ===== 08/17 financial-universal-fence.sql =====
-- CANDIDATE ONLY. No activation. Quarantine legacy writers after the first reset.
-- Deliberately denies non-offline unversioned writers, including service-role writers.
-- This is NOT automatic reversioning of old provider jobs into new operations.
CREATE FUNCTION public.financial_current_generation(p_user uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce((SELECT generation FROM public.financial_write_generations WHERE user_id=p_user),0)
$$;
REVOKE ALL ON FUNCTION public.financial_current_generation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.financial_current_generation(uuid) TO authenticated,service_role;
CREATE FUNCTION public.financial_universal_fence()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE owner_id uuid; version bigint; privileged boolean;
BEGIN
 owner_id:=CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
 IF TG_OP='UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'financial_owner_reassignment_forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||owner_id::text,0));
 version:=public.financial_current_generation(owner_id);
 privileged:=current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
 AND current_setting('gi.reorganization_mutation',true)='on';
 IF privileged THEN IF TG_OP='DELETE' THEN RAISE EXCEPTION 'reorganization_physical_delete_forbidden'; END IF; RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN
 IF OLD.deleted_at IS NOT NULL OR coalesce(version,0)>0 THEN RAISE EXCEPTION 'financial_physical_delete_forbidden'; END IF;
 RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'financial_tombstone_immutable'; END IF;
 IF coalesce(version,0)>0 AND (NEW.offline_client_id IS NULL OR (TG_OP='UPDATE' AND OLD.offline_client_id IS DISTINCT FROM NEW.offline_client_id)) THEN
 RAISE EXCEPTION 'financial_writer_requires_operation_context'; END IF;
 PERFORM public.financial_assert_generation(owner_id,NEW.offline_generation);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.financial_universal_fence() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER financial_universal_fence BEFORE INSERT OR UPDATE OR DELETE ON public.gastos FOR EACH ROW EXECUTE FUNCTION public.financial_universal_fence();
CREATE TRIGGER financial_universal_fence BEFORE INSERT OR UPDATE OR DELETE ON public.receitas FOR EACH ROW EXECUTE FUNCTION public.financial_universal_fence();
-- Guard executes with caller identity, generation lookup uses a narrow definer helper.
-- A dedicated full writer registry is required before releasing linked modules.

-- ===== 09/17 financial-linked-writer-fence.sql =====
-- CANDIDATE ONLY. All discovered mutable linked financial tables are quarantined after reset.
-- This protects data but deliberately does NOT make unversioned legacy writers compatible.
CREATE FUNCTION public.financial_linked_writer_fence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE owner_id uuid; trusted boolean;
BEGIN
 owner_id:=CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
 IF TG_OP='UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'financial_owner_reassignment_forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||owner_id::text,0));
 trusted:=current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID) AND current_setting('gi.reorganization_mutation',true)='on';
 IF public.financial_current_generation(owner_id)>0 AND NOT trusted THEN RAISE EXCEPTION 'linked_writer_requires_transaction_context'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.financial_linked_writer_fence() FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE relation_name text; BEGIN
 FOREACH relation_name IN ARRAY ARRAY['cartoes','faturas_cartao','transferencias_internas','contas_a_pagar','contas_a_receber','recorrencias','bens','bens_pagamentos','bens_financiamentos','bens_amortizacoes','bens_custos_aquisicao','dinheiro_guardado','movimentacoes_meta','investimentos_movimentacoes','investimentos_rendimentos','extratos_importados'] LOOP
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=relation_name AND column_name='user_id') THEN
 EXECUTE format('CREATE TRIGGER financial_linked_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.financial_linked_writer_fence()',relation_name);
 END IF;
 END LOOP;
END $$;

-- ===== 10/17 financial-fact-boundaries.sql =====
-- CANDIDATE ONLY: immutable financial facts accept inserts only from trusted routines/triggers.
CREATE FUNCTION public.financial_fact_insert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_user<>(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID) THEN RAISE EXCEPTION 'financial_fact_requires_authorized_routine'; END IF;
 IF TG_TABLE_NAME='financial_cash_facts' THEN
 IF NOT EXISTS(SELECT 1 FROM public.bancos WHERE id=NEW.banco_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'bank_owner_mismatch'; END IF;
 ELSE
 IF NOT EXISTS(SELECT 1 FROM public.cartoes WHERE id=NEW.cartao_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'card_owner_mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.financial_fact_insert_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guarded_cash_fact BEFORE INSERT ON public.financial_cash_facts FOR EACH ROW EXECUTE FUNCTION public.financial_fact_insert_guard();
CREATE TRIGGER guarded_card_fact BEFORE INSERT ON public.financial_card_facts FOR EACH ROW EXECUTE FUNCTION public.financial_fact_insert_guard();
CREATE FUNCTION public.financial_invoice_payment_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE delta bigint; old_paid bigint; invoice_cycle text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'invoice_history_delete_forbidden'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cartoes WHERE id=NEW.cartao_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'invoice_card_owner_mismatch'; END IF;
 IF TG_OP='UPDATE' AND (OLD.user_id,OLD.cartao_id,OLD.mes,OLD.ano) IS DISTINCT FROM (NEW.user_id,NEW.cartao_id,NEW.mes,NEW.ano) THEN RAISE EXCEPTION 'invoice_identity_immutable'; END IF;
 IF NEW.valor_pago IS NULL OR NEW.valor_pago<0 THEN RAISE EXCEPTION 'invalid_invoice_payment'; END IF;
 old_paid:=CASE WHEN TG_OP='UPDATE' THEN round(coalesce(OLD.valor_pago,0)*100)::bigint ELSE 0 END;
 delta:=round(NEW.valor_pago*100)::bigint-old_paid;
 SELECT to_char(make_date(NEW.ano,NEW.mes,1)+make_interval(months=>CASE WHEN c.dia_vencimento<=c.dia_fechamento THEN 2 ELSE 1 END),'YYYY-MM') INTO invoice_cycle FROM public.cartoes c WHERE c.id=NEW.cartao_id AND c.user_id=NEW.user_id;
 IF TG_OP='UPDATE' AND old_paid>0 AND NOT EXISTS(SELECT 1 FROM public.financial_card_facts f WHERE f.user_id=OLD.user_id AND f.source_id=OLD.id AND f.kind IN('payment_snapshot','payment')) THEN
 INSERT INTO public.financial_card_facts(user_id,cartao_id,cycle,source_id,kind,amount_cents,request_id)
 VALUES(OLD.user_id,OLD.cartao_id,invoice_cycle,OLD.id,'payment_snapshot',old_paid,'legacy-invoice:'||OLD.id) ON CONFLICT(user_id,request_id) DO NOTHING;
 END IF;
 -- Reducing a payment requires an explicit accounting reversal workflow, never a silent UPDATE.
 IF delta<0 THEN RAISE EXCEPTION 'explicit_payment_reversal_required'; END IF;
 IF delta>0 THEN
 INSERT INTO public.financial_card_facts(user_id,cartao_id,cycle,source_id,kind,amount_cents,request_id)
 VALUES(NEW.user_id,NEW.cartao_id,invoice_cycle,NEW.id,'payment',delta,'invoice-payment:'||NEW.id||':'||gen_random_uuid());
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.financial_invoice_payment_capture() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER invoice_payment_capture BEFORE INSERT OR UPDATE OR DELETE ON public.faturas_cartao FOR EACH ROW EXECUTE FUNCTION public.financial_invoice_payment_capture();

-- ===== 11/17 financial-cash-attribution.sql =====
-- CANDIDATE ONLY. Bank assignment is explicit, never guessed from text/provider labels.
-- Existing rows remain unassigned; no historical income/payment provenance is invented.
ALTER TABLE public.gastos ADD COLUMN financial_bank_id uuid REFERENCES public.bancos(id) ON DELETE RESTRICT, ADD COLUMN cash_effective_at timestamptz;
ALTER TABLE public.receitas ADD COLUMN financial_bank_id uuid REFERENCES public.bancos(id) ON DELETE RESTRICT, ADD COLUMN cash_effective_at timestamptz;
CREATE FUNCTION public.financial_cash_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old_amount bigint; new_amount bigint; sign_value int; request_key text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||NEW.user_id::text,0));
 IF TG_OP='UPDATE' AND (OLD.user_id IS DISTINCT FROM NEW.user_id OR (OLD.cash_effective_at IS NOT NULL AND (OLD.financial_bank_id IS DISTINCT FROM NEW.financial_bank_id OR OLD.cash_effective_at IS DISTINCT FROM NEW.cash_effective_at))) THEN RAISE EXCEPTION 'cash_owner_or_account_immutable'; END IF;
 IF TG_TABLE_NAME='gastos' AND NEW.cash_effective_at IS NOT NULL AND to_jsonb(NEW)->>'forma_pagamento'='credito' THEN RAISE EXCEPTION 'credit_purchase_not_bank_payment'; END IF;
 -- Logical deletion/restoration changes display only, never real cash paid/received.
 IF TG_OP='UPDATE' AND OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
 IF (OLD.valor,OLD.financial_bank_id,OLD.cash_effective_at) IS DISTINCT FROM (NEW.valor,NEW.financial_bank_id,NEW.cash_effective_at) THEN RAISE EXCEPTION 'cash_visibility_cannot_change_payment'; END IF;
 RETURN NEW; END IF;
 IF NEW.cash_effective_at IS NULL AND NEW.financial_bank_id IS NULL THEN RETURN NEW; END IF;
 IF NEW.cash_effective_at IS NULL OR NEW.financial_bank_id IS NULL THEN RAISE EXCEPTION 'cash_bank_and_payment_date_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.bancos WHERE id=NEW.financial_bank_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'bank_owner_mismatch'; END IF;
 IF TG_TABLE_NAME='gastos' AND to_jsonb(NEW)->>'forma_pagamento'='credito' THEN RAISE EXCEPTION 'credit_purchase_not_bank_payment'; END IF;
 sign_value:=CASE WHEN TG_TABLE_NAME='receitas' THEN 1 ELSE -1 END;
 old_amount:=CASE WHEN TG_OP='UPDATE' AND OLD.cash_effective_at IS NOT NULL THEN round(OLD.valor*100)::bigint ELSE 0 END;
 new_amount:=round(NEW.valor*100)::bigint;
 IF old_amount=new_amount THEN RETURN NEW; END IF;
 request_key:=TG_TABLE_NAME||':'||NEW.id||':'||gen_random_uuid();
 INSERT INTO public.financial_cash_facts(user_id,banco_id,kind,amount_cents,request_id,source_id,effective_at)
 VALUES(NEW.user_id,NEW.financial_bank_id,CASE WHEN old_amount<>0 THEN 'accounting_reversal' WHEN TG_TABLE_NAME='receitas' THEN 'income_received' ELSE 'expense_paid' END,sign_value*(new_amount-old_amount),request_key,NEW.id,NEW.cash_effective_at);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.financial_cash_capture() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER financial_cash_capture BEFORE INSERT OR UPDATE ON public.gastos FOR EACH ROW EXECUTE FUNCTION public.financial_cash_capture();
CREATE TRIGGER financial_cash_capture BEFORE INSERT OR UPDATE ON public.receitas FOR EACH ROW EXECUTE FUNCTION public.financial_cash_capture();

-- ===== 12/17 financial-group-writer.sql =====
-- CANDIDATE ONLY. No policy row; all API execution remains blocked until separately authorized.
-- Narrow expanded groups: expenses/income only. No transfer, invoice payment or metadata bypass.
CREATE TABLE public.financial_group_policy(id boolean PRIMARY KEY DEFAULT true CHECK(id), enabled boolean NOT NULL DEFAULT false);
GRANT SELECT ON public.financial_group_policy TO authenticated;
GRANT ALL ON public.financial_group_policy TO service_role;
ALTER TABLE public.financial_group_policy ENABLE ROW LEVEL SECURITY;
CREATE POLICY group_policy_read ON public.financial_group_policy FOR SELECT TO authenticated USING(true);
CREATE TABLE public.financial_group_operations(
 id uuid PRIMARY KEY, user_id uuid NOT NULL, generation bigint NOT NULL, kind text NOT NULL,
 payload jsonb NOT NULL, after_rows jsonb NOT NULL, status text NOT NULL DEFAULT 'committed' CHECK(status IN('committed','hidden','restored')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,id)
);
GRANT SELECT ON public.financial_group_operations TO authenticated;
GRANT ALL ON public.financial_group_operations TO service_role;
ALTER TABLE public.financial_group_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_group_operations ON public.financial_group_operations FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE FUNCTION public.financial_group_journal_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
 IF TG_OP<>'INSERT' OR current_user<>(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID) THEN RAISE EXCEPTION 'financial_group_journal_immutable'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.financial_group_journal_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER financial_group_journal_guard BEFORE INSERT OR UPDATE OR DELETE ON public.financial_group_operations FOR EACH ROW EXECUTE FUNCTION public.financial_group_journal_guard();
CREATE FUNCTION public.financial_group_write(p_owner uuid,p_operation uuid,p_generation bigint,p_kind text,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.financial_group_operations%ROWTYPE; item jsonb; row_json jsonb; result jsonb:='[]'; relation_name text; ordinal int:=0; cash_count int:=0;
BEGIN
 IF auth.uid() IS NULL OR auth.uid()<>p_owner OR NOT coalesce(public.can_create_in_account(p_owner),false) THEN RAISE EXCEPTION 'financial_group_unauthorized'; END IF;
 IF NOT coalesce((SELECT enabled FROM public.financial_group_policy WHERE id),false) THEN RAISE EXCEPTION 'financial_group_release_blocked'; END IF;
 -- Paid-only candidate; never expands basic/free quotas through a SECURITY DEFINER path.
 IF NOT coalesce(public.has_active_plan_access(p_owner),false) THEN RAISE EXCEPTION 'financial_group_feature_blocked'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN('manual','installments','recurrence','csv','pdf','image') OR p_operation IS NULL OR p_generation IS NULL OR p_generation<0
 OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_financial_group'; END IF;
 -- Match reset lock ordering; no transaction-local reorganization bypass for ordinary creation.
 LOCK TABLE public.gastos,public.receitas IN SHARE ROW EXCLUSIVE MODE;
 PERFORM public.financial_assert_generation(p_owner,p_generation);
 SELECT * INTO op FROM public.financial_group_operations WHERE id=p_operation FOR UPDATE;
 IF FOUND THEN
 IF op.user_id<>p_owner OR op.generation<>p_generation OR op.kind<>p_kind OR op.payload<>p_rows THEN RAISE EXCEPTION 'financial_group_payload_conflict'; END IF;
 -- Replay is an acknowledgement, never rows to inject into an active UI after deletion/edit.
 RETURN jsonb_build_object('status','replay','operationId',op.id,'rows','[]'::jsonb);
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
 relation_name:=item->>'table'; row_json:=item->'row'; ordinal:=ordinal+1;
 IF relation_name IS NULL OR relation_name NOT IN('gastos','receitas') OR jsonb_typeof(row_json) IS DISTINCT FROM 'object' OR row_json->>'user_id' IS DISTINCT FROM p_owner::text
 OR row_json->>'id' IS NULL OR row_json->>'descricao' IS NULL OR row_json->>'data' IS NULL OR row_json->>'valor' IS NULL
 OR (row_json->>'valor')::numeric<=0 OR (row_json->>'valor')::numeric>=1e12 OR round((row_json->>'valor')::numeric,2)<>(row_json->>'valor')::numeric
 OR row_json ?| ARRAY['deleted_at','deleted_by','deleted_source','deleted_reason','deletion_batch_id','deletion_source','offline_client_id','offline_generation'] THEN RAISE EXCEPTION 'invalid_financial_group_row'; END IF;
 IF row_json->>'bem_id' IS NOT NULL OR row_json->>'origem' IN('pluggy','open_finance','mercadopago','mercado_pago') THEN RAISE EXCEPTION 'financial_group_linked_blocked'; END IF;
 -- Only writable financial fields; never accept confirmation/audit/owner-control columns by schema existence alone.
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(row_json) key WHERE key NOT IN('id','user_id','descricao','valor','data','mes','ano','estabelecimento','categoria_id','forma_pagamento','observacao','imagem_url','tipo_gasto','parcela_atual','total_parcelas','grupo_parcelamento_id','recorrencia_id','recorrente','essencial','gasto_fixo','cartao_id','invoice_month','fatura_competencia','horario','origem','import_batch_id','id_operacao_banco','fornecedor_id','cliente_id','financial_bank_id','cash_effective_at')) THEN RAISE EXCEPTION 'financial_group_forbidden_column'; END IF;
 IF row_json->>'cliente_id' IS NOT NULL OR row_json->>'fornecedor_id' IS NOT NULL THEN RAISE EXCEPTION 'financial_group_reference_adapter_pending'; END IF;
 IF row_json->>'cash_effective_at' IS NOT NULL THEN cash_count:=cash_count+1; END IF;
 -- Payload source-key duplicate proof across tombstones; never use active-only/UI heuristics.
 IF row_json->>'id_operacao_banco' IS NOT NULL THEN
 IF EXISTS(SELECT 1 FROM public.gastos g WHERE g.user_id=p_owner AND to_jsonb(g)->>'id_operacao_banco'=row_json->>'id_operacao_banco')
 OR EXISTS(SELECT 1 FROM public.receitas r WHERE r.user_id=p_owner AND to_jsonb(r)->>'id_operacao_banco'=row_json->>'id_operacao_banco') THEN RAISE EXCEPTION 'financial_source_already_recorded'; END IF;
 END IF;
 row_json:=row_json||jsonb_build_object('offline_client_id','group:'||p_operation||':'||ordinal,'offline_generation',p_generation);
 -- Populate only columns declared by the actual schema; reject unknown keys instead of silently dropping bank/link fields.
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(row_json) key WHERE NOT EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=relation_name AND c.column_name=key)) THEN RAISE EXCEPTION 'financial_group_unknown_column'; END IF;
 IF relation_name='gastos' THEN
 IF row_json->>'cartao_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cartoes WHERE id=(row_json->>'cartao_id')::uuid AND user_id=p_owner) THEN RAISE EXCEPTION 'financial_group_card_owner_mismatch'; END IF;
 IF row_json->>'categoria_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.categorias WHERE id=(row_json->>'categoria_id')::uuid AND user_id=p_owner) THEN RAISE EXCEPTION 'financial_group_category_owner_mismatch'; END IF;
 END IF;
 -- Explicit supplied columns preserve database defaults for omitted fields.
 EXECUTE (SELECT format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I,$1) RETURNING to_jsonb(%I.*)',relation_name,string_agg(format('%I',key),',' ORDER BY key),string_agg(format('%I',key),',' ORDER BY key),relation_name,relation_name) FROM jsonb_object_keys(row_json) key) INTO row_json USING row_json;
 result:=result||jsonb_build_array(jsonb_build_object('table',relation_name,'row',row_json));
 END LOOP;
 IF cash_count>0 AND (p_kind IN('installments','recurrence') OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) e WHERE e->'row'->>'grupo_parcelamento_id' IS NOT NULL OR e->'row'->>'recorrencia_id' IS NOT NULL OR coalesce((e->'row'->>'total_parcelas')::int,1)>1)) THEN RAISE EXCEPTION 'financial_group_settlements_require_single_occurrence'; END IF;
 INSERT INTO public.financial_group_operations(id,user_id,generation,kind,payload,after_rows) VALUES(p_operation,p_owner,p_generation,p_kind,p_rows,result);
 RETURN jsonb_build_object('status','committed','operationId',p_operation,'rows',result);
END $$;
REVOKE ALL ON FUNCTION public.financial_group_write(uuid,uuid,bigint,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.financial_group_write(uuid,uuid,bigint,text,jsonb) TO authenticated;
-- Reorganization of these groups is still blocked: writer compatibility is not permission to reset a linked graph.

-- ===== 13/17 whatsapp-reorganizacao-partial-scope.sql =====
-- CANDIDATA, NÃO APLICADA. Aplicar depois de whatsapp-reorganizacao.sql (e dos candidatos financeiros).
-- Escopo parcial explícito: lançamentos vinculados (cartão sem suporte, parcelas, recorrência, bem,
-- importação, conta a pagar/receber, Pluggy) deixam de bloquear o pedido inteiro e passam a ficar
-- DE FORA, intactos, listados na prévia e no resultado com contagem e soma por motivo.
-- Não altera dados existentes; release_enabled continua FALSE.

SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regprocedure('public.wa_reorganization_prepare(uuid,text,text,jsonb,jsonb,text,jsonb)') IS NULL
 OR to_regprocedure('public.wa_reorganization_confirm(uuid,text,text,uuid)') IS NULL
 THEN RAISE EXCEPTION 'reorganization_base_required'; END IF;
END $$;

ALTER TABLE public.whatsapp_reorganization_operations ADD COLUMN IF NOT EXISTS left_out jsonb;

-- Motivo pelo qual a linha fica fora; NULL = elegível. Mesmos critérios do bloqueio anterior.
CREATE OR REPLACE FUNCTION public.wa_reorganization_left_out_reason(p_user uuid,p_item jsonb)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r jsonb:=p_item->'row';
BEGIN
 IF r->>'grupo_parcelamento_id' IS NOT NULL OR coalesce((r->>'total_parcelas')::int,1)>1 THEN RETURN 'parcelado'; END IF;
 IF r->>'recorrencia_id' IS NOT NULL THEN RETURN 'recorrente'; END IF;
 IF r->>'bem_id' IS NOT NULL THEN RETURN 'bem'; END IF;
 IF r->>'import_batch_id' IS NOT NULL OR coalesce(r->>'origem','') IN('pluggy','open_finance','extrato','mercadopago','mercado_pago') THEN RETURN 'importado'; END IF;
 IF (r->>'cartao_id' IS NOT NULL OR r->>'forma_pagamento'='credito') AND NOT public.wa_reorganization_card_supported(p_user,r) THEN RETURN 'cartao'; END IF;
 IF (p_item->>'table'='gastos' AND EXISTS(SELECT 1 FROM public.contas_a_pagar c WHERE c.gasto_id=(r->>'id')::uuid))
 OR public.wa_reorganization_has_dependency((r->>'id')::uuid,p_item->>'table') THEN RETURN 'vinculado'; END IF;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.wa_reorganization_scope_rows(p_user uuid,p_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rows jsonb;
BEGIN
 IF p_scope IS NULL OR NOT(p_scope ?& ARRAY['tables','start','end']) OR jsonb_typeof(p_scope->'tables') IS DISTINCT FROM 'array' OR jsonb_array_length(p_scope->'tables') NOT BETWEEN 1 AND 2
 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_scope->'tables') x WHERE x NOT IN('gastos','receitas'))
 OR (SELECT count(*) FROM jsonb_array_elements_text(p_scope->'tables'))<>(SELECT count(DISTINCT x) FROM jsonb_array_elements_text(p_scope->'tables') x)
 OR (p_scope->>'start' IS NOT NULL AND p_scope->>'end' IS NOT NULL AND (p_scope->>'start')::date >= (p_scope->>'end')::date)
 THEN RAISE EXCEPTION 'invalid_scope'; END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'table',x->'row'->>'id'),'[]') INTO rows FROM (
 SELECT jsonb_build_object('table','gastos','row',to_jsonb(g)) x FROM public.gastos g
 WHERE g.user_id=p_user AND g.deleted_at IS NULL AND p_scope->'tables' ? 'gastos'
 AND (p_scope->>'start' IS NULL OR g.data >= (p_scope->>'start')::date)
 AND (p_scope->>'end' IS NULL OR g.data < (p_scope->>'end')::date)
 UNION ALL
 SELECT jsonb_build_object('table','receitas','row',to_jsonb(r)) FROM public.receitas r
 WHERE r.user_id=p_user AND r.deleted_at IS NULL AND p_scope->'tables' ? 'receitas'
 AND (p_scope->>'start' IS NULL OR r.data >= (p_scope->>'start')::date)
 AND (p_scope->>'end' IS NULL OR r.data < (p_scope->>'end')::date)
 ) q;
 RETURN rows;
END $$;

-- Snapshot passa a conter só elegíveis; prepare/confirm existentes comparam este conjunto.
CREATE OR REPLACE FUNCTION public.wa_reorganization_snapshot(p_user uuid,p_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rows jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'table',x->'row'->>'id'),'[]') INTO rows
 FROM jsonb_array_elements(public.wa_reorganization_scope_rows(p_user,p_scope)) x
 WHERE public.wa_reorganization_left_out_reason(p_user,x) IS NULL;
 IF jsonb_array_length(rows)>500 THEN RAISE EXCEPTION 'scope_too_large'; END IF;
 RETURN rows;
END $$;

CREATE OR REPLACE FUNCTION public.wa_reorganization_left_out(p_user uuid,p_scope jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('table',t,'motivo',m,'n',n,'total',total) ORDER BY t,m),'[]') FROM (
  SELECT x->>'table' t,public.wa_reorganization_left_out_reason(p_user,x) m,count(*) n,sum((x->'row'->>'valor')::numeric) total
  FROM jsonb_array_elements(public.wa_reorganization_scope_rows(p_user,p_scope)) x
  WHERE public.wa_reorganization_left_out_reason(p_user,x) IS NOT NULL GROUP BY 1,2) q
$$;

-- Wrappers: mesma autorização/locks das RPCs base; acrescentam o que fica de fora.
CREATE OR REPLACE FUNCTION public.wa_reorganization_prepare_v2(p_user uuid,p_phone text,p_request text,p_scope jsonb,p_income jsonb,p_code text,p_balance jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE res jsonb; lo jsonb;
BEGIN
 res:=public.wa_reorganization_prepare(p_user,p_phone,p_request,p_scope,p_income,p_code,p_balance);
 IF NOT public.wa_reorganization_authorized(p_user,p_phone) THEN RETURN res; END IF;
 lo:=CASE WHEN p_scope->'tables'='[]'::jsonb THEN '[]'::jsonb ELSE public.wa_reorganization_left_out(p_user,p_scope) END;
 IF res->>'status'='preview' THEN
  UPDATE public.whatsapp_reorganization_operations SET left_out=lo WHERE id=(res->>'operationId')::uuid AND user_id=p_user;
  RETURN res||jsonb_build_object('leftOut',lo);
 END IF;
 IF res->>'status'='blocked' AND jsonb_array_length(lo)>0 AND p_balance IS NULL THEN
  RETURN jsonb_build_object('status','nothing_eligible','leftOut',lo);
 END IF;
 RETURN res;
END $$;

CREATE OR REPLACE FUNCTION public.wa_reorganization_confirm_v2(p_user uuid,p_phone text,p_code text,p_operation uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE res jsonb; lo jsonb;
BEGIN
 res:=public.wa_reorganization_confirm(p_user,p_phone,p_code,p_operation);
 IF res->>'status' IN('applied','replay') THEN
  SELECT left_out INTO lo FROM public.whatsapp_reorganization_operations WHERE id=p_operation AND user_id=p_user;
  RETURN res||jsonb_build_object('leftOut',coalesce(lo,'[]'::jsonb));
 END IF;
 RETURN res;
END $$;

-- Restauração por voz: devolve o ID da limpeza aplicada mais recente do
-- titular ("restaurar última limpeza"). NÃO restaura nada — a restauração
-- segue o fluxo normal de prévia + código exclusivo (restore_prepare/control).
CREATE OR REPLACE FUNCTION public.wa_reorganization_last_applied(p_user uuid,p_phone text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op uuid;
BEGIN
 IF NOT public.wa_reorganization_authorized(p_user,p_phone) THEN RETURN NULL; END IF;
 SELECT o.id INTO op FROM public.whatsapp_reorganization_operations o
  WHERE o.user_id=p_user AND o.status='applied'
  ORDER BY o.completed_at DESC NULLS LAST, o.created_at DESC LIMIT 1;
 RETURN op;
END $$;

REVOKE ALL ON FUNCTION public.wa_reorganization_left_out_reason(uuid,jsonb),public.wa_reorganization_scope_rows(uuid,jsonb),public.wa_reorganization_snapshot(uuid,jsonb),public.wa_reorganization_left_out(uuid,jsonb),public.wa_reorganization_prepare_v2(uuid,text,text,jsonb,jsonb,text,jsonb),public.wa_reorganization_confirm_v2(uuid,text,text,uuid),public.wa_reorganization_last_applied(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_reorganization_prepare_v2(uuid,text,text,jsonb,jsonb,text,jsonb),public.wa_reorganization_confirm_v2(uuid,text,text,uuid),public.wa_reorganization_last_applied(uuid,text) TO service_role;

-- ===== 14/17 whatsapp-reorganizacao-owner-allowlist.sql =====
-- CANDIDATO (não aplicado). Restringe a reorganização em massa a contas
-- explicitamente listadas. Lista nasce VAZIA: ninguém fica liberado até um
-- INSERT autorizado separadamente (dado, não migração). release_enabled continua FALSE.
-- Depende de whatsapp-reorganizacao.sql e whatsapp-reorganizacao-partial-scope.sql.

CREATE TABLE IF NOT EXISTS public.whatsapp_reorganization_allowlist (
  user_id uuid PRIMARY KEY,
  added_at timestamptz NOT NULL DEFAULT now(),
  note text
);
GRANT SELECT ON public.whatsapp_reorganization_allowlist TO service_role;
ALTER TABLE public.whatsapp_reorganization_allowlist ENABLE ROW LEVEL SECURITY;
-- Sem políticas: authenticated/anon não leem nem escrevem.

CREATE OR REPLACE FUNCTION public.wa_reorganization_authorized(p_user uuid,p_phone text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce((SELECT release_enabled FROM public.whatsapp_reorganization_policy WHERE id),false)
 AND EXISTS(SELECT 1 FROM public.whatsapp_reorganization_allowlist a WHERE a.user_id=p_user)
 AND coalesce(public.has_feature_access(p_user,'whatsapp'),false)
 AND length(regexp_replace(coalesce(p_phone,''),'\D','','g')) BETWEEN 10 AND 15
 AND EXISTS(SELECT 1 FROM public.whatsapp_links l WHERE l.user_id=p_user AND l.ativo
   AND l.opt_in_em IS NOT NULL AND l.revogado_em IS NULL
   AND regexp_replace(l.telefone,'\D','','g')=regexp_replace(p_phone,'\D','','g'))
$$;
REVOKE ALL ON FUNCTION public.wa_reorganization_authorized(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_reorganization_authorized(uuid,text) TO service_role;

-- Defesa em profundidade: nenhum lote novo para conta fora da lista, mesmo
-- por writer legado (wa_reorganization_prepare v1) ou chamada direta.
CREATE OR REPLACE FUNCTION public.tg_wa_reorganization_allowlist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_reorganization_allowlist a WHERE a.user_id=NEW.user_id) THEN
  RAISE EXCEPTION 'reorganization_not_allowlisted';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_wa_reorganization_allowlist() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS wa_reorganization_allowlist_guard ON public.whatsapp_reorganization_operations;
CREATE TRIGGER wa_reorganization_allowlist_guard BEFORE INSERT ON public.whatsapp_reorganization_operations
 FOR EACH ROW EXECUTE FUNCTION public.tg_wa_reorganization_allowlist();

-- ===== 15/17 whatsapp-reorganizacao-full-reset.sql =====
-- CANDIDATO (não aplicado). "Zerar tudo" com blocos vinculados.
-- Inclui: todos os gastos (cartão, parcelas inclusive futuras, recorrentes,
-- importados, ligados a contas), todas as receitas, faturas de cartão,
-- contas a pagar/receber, transferências internas e regras de recorrência
-- (pausadas para não recriar lançamentos). Preserva cadastros de bancos,
-- cartões, metas, investimentos, bens e a conta de acesso.
-- Lançamentos ligados a bens/financiamentos ficam DE FORA e são listados:
-- a prévia só diz "limpeza total" quando nada fica de fora.
-- Nada é apagado fisicamente: gastos/receitas viram exclusão reversível e os
-- demais blocos são arquivados (ocultos por política RESTRITIVA), com diário
-- completo antes/depois. Restauração é tudo-ou-nada.
-- Dependências: whatsapp-reorganizacao.sql, partial-scope, owner-allowlist,
-- gastos-soft-delete-f2, financial-offline-generation. release_enabled segue FALSE.

SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regprocedure('public.wa_reorganization_authorized(uuid,text)') IS NULL
 OR to_regclass('public.whatsapp_reorganization_allowlist') IS NULL
 OR to_regclass('public.financial_write_generations') IS NULL
 THEN RAISE EXCEPTION 'full_reset_prerequisites_missing'; END IF;
END $$;

-- Arquivamento reversível dos blocos sem coluna de exclusão.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['faturas_cartao','contas_a_pagar','contas_a_receber','transferencias_internas','recorrencias'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS reorg_archived_at timestamptz, ADD COLUMN IF NOT EXISTS reorg_batch_id uuid',t);
   EXECUTE format('DROP POLICY IF EXISTS reorg_hide_archived ON public.%I',t);
   -- RESTRITIVA: soma-se (AND) às políticas existentes; arquivado some do site e não pode ser editado.
   EXECUTE format('CREATE POLICY reorg_hide_archived ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (reorg_archived_at IS NULL) WITH CHECK (reorg_archived_at IS NULL)',t);
  END IF;
 END LOOP;
END $$;

-- Unicidade só entre registros ativos: depois de zerar, nova fatura do mesmo
-- cartão/mês e nova recorrência detectada podem ser criadas normalmente.
DO $$ BEGIN
 IF to_regclass('public.faturas_cartao') IS NOT NULL THEN
  ALTER TABLE public.faturas_cartao DROP CONSTRAINT IF EXISTS faturas_cartao_unique;
  DROP INDEX IF EXISTS public.faturas_cartao_unique;
  CREATE UNIQUE INDEX faturas_cartao_unique ON public.faturas_cartao(user_id,cartao_id,mes,ano) WHERE reorg_archived_at IS NULL;
 END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='recorrencias' AND column_name='detection_key') THEN
  DROP INDEX IF EXISTS public.idx_recorrencias_detection_key;
  CREATE UNIQUE INDEX idx_recorrencias_detection_key ON public.recorrencias(user_id,detection_key) WHERE detection_key IS NOT NULL AND reorg_archived_at IS NULL;
 END IF;
END $$;

CREATE TABLE public.whatsapp_reorganization_full_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL,
 phone_hash text NOT NULL,
 request_id text NOT NULL,
 status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','applied','restored','cancelled','expired','changed')),
 code_hash text NOT NULL,
 expires_at timestamptz NOT NULL,
 failed_attempts int NOT NULL DEFAULT 0,
 fingerprint text NOT NULL,
 summary jsonb NOT NULL,
 left_out jsonb NOT NULL DEFAULT '[]',
 deleted_stamp timestamptz,
 result jsonb,
 restore_code_hash text,
 restore_expires_at timestamptz,
 restore_attempts int NOT NULL DEFAULT 0,
 restore_result jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz,
 restored_at timestamptz,
 UNIQUE (user_id, request_id)
);
CREATE TABLE public.whatsapp_reorganization_full_journal (
 operation_id uuid NOT NULL REFERENCES public.whatsapp_reorganization_full_operations(id),
 table_name text NOT NULL,
 row_id uuid NOT NULL,
 before_row jsonb NOT NULL,
 after_row jsonb,
 PRIMARY KEY (operation_id, table_name, row_id)
);
CREATE TABLE public.financial_import_tombstones (
 user_id uuid NOT NULL,
 operation_key text NOT NULL,
 batch_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (user_id, operation_key)
);
GRANT SELECT ON public.whatsapp_reorganization_full_operations, public.whatsapp_reorganization_full_journal, public.financial_import_tombstones TO service_role;
ALTER TABLE public.whatsapp_reorganization_full_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_reorganization_full_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_import_tombstones ENABLE ROW LEVEL SECURITY;
-- Sem políticas: só funções SECURITY DEFINER escrevem; diário é imutável fora delas.

CREATE TRIGGER wa_reorganization_full_allowlist_guard BEFORE INSERT ON public.whatsapp_reorganization_full_operations
 FOR EACH ROW EXECUTE FUNCTION public.tg_wa_reorganization_allowlist();

CREATE FUNCTION public.tg_wa_full_journal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (OLD.after_row IS NOT NULL OR NEW.before_row IS DISTINCT FROM OLD.before_row OR NEW.row_id IS DISTINCT FROM OLD.row_id)) THEN
  RAISE EXCEPTION 'full_journal_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wa_full_journal_immutable BEFORE UPDATE OR DELETE ON public.whatsapp_reorganization_full_journal
 FOR EACH ROW EXECUTE FUNCTION public.tg_wa_full_journal_immutable();

-- Reimportação de lançamento zerado é recusada (o import inteiro falha) até a restauração.
CREATE FUNCTION public.financial_import_signature(p_table text,p_row jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT 'sig:'||p_table||':'||(p_row->>'data')||':'||round((p_row->>'valor')::numeric,2)::text||':'||lower(btrim(coalesce(p_row->>'descricao','')))
$$;
CREATE FUNCTION public.tg_financial_import_tombstone() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j jsonb:=to_jsonb(NEW); k text:=nullif(lower(btrim(j->>'id_operacao_banco')),''); sig text;
BEGIN
 -- Sem identificador bancário, importados usam a mesma assinatura exata da deduplicação do extrato.
 IF j->>'import_batch_id' IS NOT NULL THEN sig:=public.financial_import_signature(TG_TABLE_NAME,j); END IF;
 IF EXISTS(SELECT 1 FROM public.financial_import_tombstones t WHERE t.user_id=NEW.user_id AND (t.operation_key=k OR t.operation_key=sig)) THEN
  RAISE EXCEPTION 'reimport_blocked_reorganized_entry'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_financial_import_tombstone() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['gastos','receitas','transferencias_internas'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('CREATE TRIGGER financial_import_tombstone BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_financial_import_tombstone()',t);
  END IF;
 END LOOP;
END $$;

-- Linha ligada a bem/financiamento: fora do escopo (contrato contábil próprio).
CREATE FUNCTION public.wa_full_reset_bem_linked(p_item jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rel text; col text; linked boolean;
BEGIN
 IF p_item->'row'->>'bem_id' IS NOT NULL THEN RETURN true; END IF;
 col:=CASE p_item->>'table' WHEN 'gastos' THEN 'gasto_id' WHEN 'receitas' THEN 'receita_id' ELSE NULL END;
 IF col IS NULL THEN RETURN false; END IF;
 FOREACH rel IN ARRAY ARRAY['bens_pagamentos','bens_custos_aquisicao','bens_amortizacoes'] LOOP
  IF EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=rel AND c.column_name=col) THEN
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE %I=$1)',rel,col) INTO linked USING (p_item->'row'->>'id')::uuid;
   IF linked THEN RETURN true; END IF;
  END IF;
 END LOOP;
 RETURN false;
END $$;

CREATE FUNCTION public.wa_full_reset_rows(p_user uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE acc jsonb:='[]'; part jsonb; t text;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('table','gastos','row',to_jsonb(g)) ORDER BY g.id),'[]') INTO part FROM public.gastos g WHERE g.user_id=p_user AND g.deleted_at IS NULL;
 acc:=acc||part;
 SELECT coalesce(jsonb_agg(jsonb_build_object('table','receitas','row',to_jsonb(r)) ORDER BY r.id),'[]') INTO part FROM public.receitas r WHERE r.user_id=p_user AND r.deleted_at IS NULL;
 acc:=acc||part;
 FOREACH t IN ARRAY ARRAY['faturas_cartao','contas_a_pagar','contas_a_receber','transferencias_internas','recorrencias'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('SELECT coalesce(jsonb_agg(jsonb_build_object(''table'',%L,''row'',to_jsonb(x)) ORDER BY x.id),''[]'') FROM public.%I x WHERE x.user_id=$1 AND x.reorg_archived_at IS NULL',t,t) INTO part USING p_user;
   acc:=acc||part;
  END IF;
 END LOOP;
 RETURN acc;
END $$;

CREATE FUNCTION public.wa_full_reset_summary(p_rows jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 WITH x AS (SELECT e->>'table' t, e->'row' r FROM jsonb_array_elements(p_rows) e),
 g AS (SELECT * FROM x WHERE t='gastos')
 SELECT jsonb_build_object(
  'expenses',(SELECT count(*) FROM g)::int,
  'totalExpenses',(SELECT coalesce(sum((r->>'valor')::numeric),0) FROM g),
  'incomes',(SELECT count(*) FROM x WHERE t='receitas')::int,
  'totalIncomes',(SELECT coalesce(sum((r->>'valor')::numeric),0) FROM x WHERE t='receitas'),
  'card',(SELECT count(*) FROM g WHERE r->>'cartao_id' IS NOT NULL OR r->>'forma_pagamento'='credito')::int,
  'installments',(SELECT count(*) FROM g WHERE r->>'grupo_parcelamento_id' IS NOT NULL OR coalesce((r->>'total_parcelas')::int,1)>1)::int,
  'futureInstallments',(SELECT count(*) FROM g WHERE (r->>'grupo_parcelamento_id' IS NOT NULL OR coalesce((r->>'total_parcelas')::int,1)>1) AND (r->>'data')::date>current_date)::int,
  'recurringEntries',(SELECT count(*) FROM x WHERE t IN('gastos','receitas') AND r->>'recorrencia_id' IS NOT NULL)::int,
  'imported',(SELECT count(*) FROM x WHERE t IN('gastos','receitas') AND (r->>'import_batch_id' IS NOT NULL OR coalesce(r->>'origem','') IN('pluggy','open_finance','extrato','mercadopago','mercado_pago') OR coalesce(r->>'origem','') LIKE 'extrato%'))::int,
  'invoices',(SELECT count(*) FROM x WHERE t='faturas_cartao')::int,
  'payables',(SELECT count(*) FROM x WHERE t='contas_a_pagar')::int,
  'receivables',(SELECT count(*) FROM x WHERE t='contas_a_receber')::int,
  'transfers',(SELECT count(*) FROM x WHERE t='transferencias_internas')::int,
  'recurrenceRules',(SELECT count(*) FROM x WHERE t='recorrencias')::int)
$$;

CREATE FUNCTION public.wa_full_reset_prepare(p_user uuid,p_phone text,p_request text,p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rows jsonb; eligible jsonb; lo jsonb; ph text; op public.whatsapp_reorganization_full_operations%ROWTYPE; s jsonb;
BEGIN
 IF NOT public.wa_reorganization_authorized(p_user,p_phone) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF p_request IS NULL OR length(p_request) NOT BETWEEN 1 AND 200 OR p_code IS NULL OR p_code !~ '^\d{6}$' THEN RAISE EXCEPTION 'invalid_request'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 ph:=encode(sha256(convert_to(regexp_replace(p_phone,'\D','','g'),'UTF8')),'hex');
 SELECT * INTO op FROM public.whatsapp_reorganization_full_operations WHERE user_id=p_user AND request_id=p_request;
 IF FOUND THEN
  IF op.phone_hash<>ph THEN RETURN jsonb_build_object('status','blocked'); END IF;
  RETURN jsonb_build_object('status',CASE WHEN op.status='applied' THEN 'replay' ELSE op.status END,'operationId',op.id);
 END IF;
 rows:=public.wa_full_reset_rows(p_user);
 IF jsonb_array_length(rows)>5000 THEN RAISE EXCEPTION 'scope_too_large'; END IF;
 SELECT coalesce(jsonb_agg(e),'[]') INTO eligible FROM jsonb_array_elements(rows) e WHERE NOT public.wa_full_reset_bem_linked(e);
 SELECT coalesce(jsonb_agg(jsonb_build_object('table',t,'motivo','bem','n',n,'total',total)),'[]') INTO lo FROM (
  SELECT e->>'table' t,count(*) n,coalesce(sum((e->'row'->>'valor')::numeric),0) total FROM jsonb_array_elements(rows) e WHERE public.wa_full_reset_bem_linked(e) GROUP BY 1) q;
 IF jsonb_array_length(eligible)=0 THEN RETURN jsonb_build_object('status','nothing_eligible','leftOut',lo,'expenses',0,'incomes',0); END IF;
 s:=public.wa_full_reset_summary(eligible);
 UPDATE public.whatsapp_reorganization_full_operations SET status='cancelled' WHERE user_id=p_user AND status='preview';
 UPDATE public.whatsapp_reorganization_operations SET status='cancelled' WHERE user_id=p_user AND phone_hash=ph AND status='preview';
 INSERT INTO public.whatsapp_reorganization_full_operations(user_id,phone_hash,request_id,code_hash,expires_at,fingerprint,summary,left_out)
 VALUES(p_user,ph,p_request,encode(sha256(convert_to(p_user::text||ph||p_code,'UTF8')),'hex'),clock_timestamp()+interval '5 minutes',md5(rows::text),s,lo)
 RETURNING * INTO op;
 RETURN s||jsonb_build_object('status','preview','mode','full','operationId',op.id,'code',p_code,'expiresAt',op.expires_at,'leftOut',lo,'complete',jsonb_array_length(lo)=0,
  'scope',jsonb_build_object('tables',jsonb_build_array('gastos','receitas'),'start',NULL,'end',NULL));
END $$;

CREATE FUNCTION public.wa_full_reset_confirm(p_user uuid,p_phone text,p_code text,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.whatsapp_reorganization_full_operations%ROWTYPE; rows jsonb; eligible jsonb; stamp timestamptz; t text; n int; total int:=0; ph text;
BEGIN
 ph:=encode(sha256(convert_to(regexp_replace(coalesce(p_phone,''),'\D','','g'),'UTF8')),'hex');
 -- Voz/texto sem identificador: só a prévia pendente deste titular+número cujo código confere.
 IF p_operation IS NULL THEN
  SELECT o.id INTO p_operation FROM public.whatsapp_reorganization_full_operations o WHERE o.user_id=p_user AND o.phone_hash=ph AND o.status='preview'
   AND p_code ~ '^\d{6}$' AND o.code_hash=encode(sha256(convert_to(p_user::text||ph||p_code,'UTF8')),'hex') ORDER BY o.created_at DESC LIMIT 1;
  IF p_operation IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_reorganization_full_operations WHERE id=p_operation AND user_id=p_user) THEN RETURN jsonb_build_object('status','not_found'); END IF;
 IF NOT public.wa_reorganization_authorized(p_user,p_phone) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 LOCK TABLE public.gastos,public.receitas IN SHARE ROW EXCLUSIVE MODE;
 FOREACH t IN ARRAY ARRAY['faturas_cartao','contas_a_pagar','contas_a_receber','transferencias_internas','recorrencias','cartoes','bancos'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',t); END IF;
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 ph:=encode(sha256(convert_to(regexp_replace(p_phone,'\D','','g'),'UTF8')),'hex');
 SELECT * INTO op FROM public.whatsapp_reorganization_full_operations WHERE id=p_operation AND user_id=p_user AND phone_hash=ph FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','wrong_code'); END IF;
 IF op.status='applied' THEN RETURN op.result||jsonb_build_object('status','replay'); END IF;
 IF op.failed_attempts>=5 THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF p_code IS NULL OR p_code !~ '^\d{6}$' OR op.code_hash<>encode(sha256(convert_to(p_user::text||ph||p_code,'UTF8')),'hex') THEN
  UPDATE public.whatsapp_reorganization_full_operations SET failed_attempts=failed_attempts+1 WHERE id=op.id;
  RETURN jsonb_build_object('status','wrong_code'); END IF;
 IF op.status<>'preview' THEN RETURN jsonb_build_object('status',op.status); END IF;
 IF clock_timestamp()>=op.expires_at THEN UPDATE public.whatsapp_reorganization_full_operations SET status='expired' WHERE id=op.id; RETURN jsonb_build_object('status','expired'); END IF;
 rows:=public.wa_full_reset_rows(p_user);
 IF md5(rows::text)<>op.fingerprint THEN UPDATE public.whatsapp_reorganization_full_operations SET status='changed' WHERE id=op.id; RETURN jsonb_build_object('status','changed'); END IF;
 SELECT coalesce(jsonb_agg(e),'[]') INTO eligible FROM jsonb_array_elements(rows) e WHERE NOT public.wa_full_reset_bem_linked(e);
 stamp:=clock_timestamp();
 PERFORM set_config('gi.reorganization_mutation','on',true);
 INSERT INTO public.whatsapp_reorganization_full_journal(operation_id,table_name,row_id,before_row)
  SELECT op.id,e->>'table',(e->'row'->>'id')::uuid,e->'row' FROM jsonb_array_elements(eligible) e;
 IF to_regprocedure('public.financial_capture_card_history(uuid,jsonb)') IS NOT NULL THEN
  PERFORM public.financial_capture_card_history(p_user,(SELECT coalesce(jsonb_agg(e),'[]') FROM jsonb_array_elements(eligible) e WHERE e->>'table'='gastos'));
 END IF;
 PERFORM set_config('gi.gastos_soft_delete','on',true);
 UPDATE public.gastos g SET deleted_at=stamp,deleted_by=p_user,deletion_batch_id=op.id,deletion_source='whatsapp_periodo',updated_at=stamp
  FROM public.whatsapp_reorganization_full_journal j WHERE j.operation_id=op.id AND j.table_name='gastos' AND g.id=j.row_id AND g.user_id=p_user;
 GET DIAGNOSTICS n=ROW_COUNT; total:=total+n;
 PERFORM set_config('gi.gastos_soft_delete','off',true);
 UPDATE public.receitas r SET deleted_at=stamp,deleted_source='whatsapp',deleted_reason='reorganizacao_total:'||op.id,updated_at=stamp
  FROM public.whatsapp_reorganization_full_journal j WHERE j.operation_id=op.id AND j.table_name='receitas' AND r.id=j.row_id AND r.user_id=p_user;
 GET DIAGNOSTICS n=ROW_COUNT; total:=total+n;
 FOREACH t IN ARRAY ARRAY['faturas_cartao','contas_a_pagar','contas_a_receber','transferencias_internas','recorrencias'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('UPDATE public.%I x SET reorg_archived_at=$2,reorg_batch_id=$1,updated_at=$2%s FROM public.whatsapp_reorganization_full_journal j WHERE j.operation_id=$1 AND j.table_name=%L AND x.id=j.row_id AND x.user_id=$3',
    t,CASE WHEN t='recorrencias' THEN ',status=''pausada''' ELSE '' END,t) USING op.id,stamp,p_user;
   GET DIAGNOSTICS n=ROW_COUNT; total:=total+n;
  END IF;
 END LOOP;
 IF total<>jsonb_array_length(eligible) THEN RAISE EXCEPTION 'row_count_mismatch'; END IF;
 -- Diário "depois": base para detectar qualquer alteração antes da restauração.
 FOREACH t IN ARRAY ARRAY['gastos','receitas','faturas_cartao','contas_a_pagar','contas_a_receber','transferencias_internas','recorrencias'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('UPDATE public.whatsapp_reorganization_full_journal j SET after_row=to_jsonb(x) FROM public.%I x WHERE j.operation_id=$1 AND j.table_name=%L AND x.id=j.row_id',t,t) USING op.id;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.whatsapp_reorganization_full_journal WHERE operation_id=op.id AND after_row IS NULL) THEN RAISE EXCEPTION 'journal_incomplete'; END IF;
 INSERT INTO public.financial_import_tombstones(user_id,operation_key,batch_id)
  SELECT DISTINCT p_user,lower(btrim(e->'row'->>'id_operacao_banco')),op.id FROM jsonb_array_elements(eligible) e
  WHERE e->>'table' IN('gastos','receitas','transferencias_internas') AND nullif(btrim(e->'row'->>'id_operacao_banco'),'') IS NOT NULL
  ON CONFLICT DO NOTHING;
 INSERT INTO public.financial_import_tombstones(user_id,operation_key,batch_id)
  SELECT DISTINCT p_user,public.financial_import_signature(e->>'table',e->'row'),op.id FROM jsonb_array_elements(eligible) e
  WHERE e->>'table' IN('gastos','receitas','transferencias_internas') AND e->'row'->>'import_batch_id' IS NOT NULL AND nullif(btrim(e->'row'->>'id_operacao_banco'),'') IS NULL
  ON CONFLICT DO NOTHING;
 INSERT INTO public.financial_write_generations(user_id,generation) VALUES(p_user,1) ON CONFLICT(user_id) DO UPDATE SET generation=financial_write_generations.generation+1;
 PERFORM set_config('gi.reorganization_mutation','off',true);
 op.result:=op.summary||jsonb_build_object('status','applied','mode','full','operationId',op.id,'leftOut',op.left_out,'complete',jsonb_array_length(op.left_out)=0);
 UPDATE public.whatsapp_reorganization_full_operations SET status='applied',deleted_stamp=stamp,result=op.result,completed_at=clock_timestamp() WHERE id=op.id;
 IF to_regclass('public.audit_logs') IS NOT NULL THEN
  INSERT INTO public.audit_logs(actor_user_id,target_user_id,action,entity_type,entity_id,metadata) VALUES(p_user,p_user,'whatsapp_full_reset','financial_operation',op.id::text,op.result);
 END IF;
 RETURN op.result;
END $$;

CREATE FUNCTION public.wa_full_reset_restore_prepare(p_user uuid,p_phone text,p_operation uuid,p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.whatsapp_reorganization_full_operations%ROWTYPE; ph text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_reorganization_full_operations WHERE id=p_operation AND user_id=p_user) THEN RETURN jsonb_build_object('status','not_found'); END IF;
 IF p_code IS NULL OR p_code !~ '^\d{6}$' THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF NOT public.wa_reorganization_authorized(p_user,p_phone) THEN RETURN jsonb_build_object('status','blocked'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 ph:=encode(sha256(convert_to(regexp_replace(p_phone,'\D','','g'),'UTF8')),'hex');
 SELECT * INTO op FROM public.whatsapp_reorganization_full_operations WHERE id=p_operation AND user_id=p_user AND phone_hash=ph FOR UPDATE;
 IF NOT FOUND OR op.status<>'applied' THEN RETURN jsonb_build_object('status','blocked'); END IF;
 UPDATE public.whatsapp_reorganization_full_operations SET restore_code_hash=encode(sha256(convert_to(op.id::text||p_user::text||ph||p_code,'UTF8')),'hex'),
  restore_expires_at=clock_timestamp()+interval '5 minutes',restore_attempts=0 WHERE id=op.id RETURNING * INTO op;
 RETURN op.summary||jsonb_build_object('status','restore_preview','mode','full','operationId',op.id,'code',p_code,'expiresAt',op.restore_expires_at);
END $$;

CREATE FUNCTION public.wa_full_reset_restore_confirm(p_user uuid,p_phone text,p_operation uuid,p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.whatsapp_reorganization_full_operations%ROWTYPE; ph text; t text; cols text; n int; total int:=0; conflicts int:=0; expected int; superseded uuid[]:='{}'; dups int:=0;
BEGIN
 ph:=encode(sha256(convert_to(regexp_replace(coalesce(p_phone,''),'\D','','g'),'UTF8')),'hex');
 IF p_operation IS NULL THEN
  SELECT o.id INTO p_operation FROM public.whatsapp_reorganization_full_operations o WHERE o.user_id=p_user AND o.phone_hash=ph AND o.status='applied'
   AND p_code ~ '^\d{6}$' AND o.restore_code_hash=encode(sha256(convert_to(o.id::text||p_user::text||ph||p_code,'UTF8')),'hex') ORDER BY o.completed_at DESC LIMIT 1;
  IF p_operation IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_reorganization_full_operations WHERE id=p_operation AND user_id=p_user) THEN RETURN jsonb_build_object('status','not_found'); END IF;
 -- Restauração não exige release ativo (pausar não pode impedir desfazer), mas exige titular e vínculo.
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_reorganization_allowlist a WHERE a.user_id=p_user)
 OR NOT coalesce(public.has_feature_access(p_user,'whatsapp'),false)
 OR NOT EXISTS(SELECT 1 FROM public.whatsapp_links l WHERE l.user_id=p_user AND l.ativo AND l.opt_in_em IS NOT NULL AND l.revogado_em IS NULL AND regexp_replace(l.telefone,'\D','','g')=regexp_replace(p_phone,'\D','','g'))
 THEN RETURN jsonb_build_object('status','blocked'); END IF;
 LOCK TABLE public.gastos,public.receitas IN SHARE ROW EXCLUSIVE MODE;
 FOREACH t IN ARRAY ARRAY['faturas_cartao','contas_a_pagar','contas_a_receber','transferencias_internas','recorrencias'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',t); END IF;
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||p_user::text,0));
 ph:=encode(sha256(convert_to(regexp_replace(p_phone,'\D','','g'),'UTF8')),'hex');
 SELECT * INTO op FROM public.whatsapp_reorganization_full_operations WHERE id=p_operation AND user_id=p_user AND phone_hash=ph FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF op.status='restored' THEN RETURN op.restore_result||jsonb_build_object('status','replay'); END IF;
 IF op.restore_attempts>=5 THEN RETURN jsonb_build_object('status','blocked'); END IF;
 IF p_code IS NULL OR p_code !~ '^\d{6}$' OR op.restore_code_hash IS DISTINCT FROM encode(sha256(convert_to(op.id::text||p_user::text||ph||p_code,'UTF8')),'hex') THEN
  UPDATE public.whatsapp_reorganization_full_operations SET restore_attempts=restore_attempts+1 WHERE id=op.id; RETURN jsonb_build_object('status','wrong_code'); END IF;
 IF op.restore_expires_at IS NULL OR clock_timestamp()>=op.restore_expires_at THEN RETURN jsonb_build_object('status','expired'); END IF;
 IF op.status<>'applied' THEN RETURN jsonb_build_object('status','blocked'); END IF;
 -- Tudo-ou-nada: qualquer linha alterada depois da limpeza impede a restauração inteira.
 FOREACH t IN ARRAY ARRAY['gastos','receitas','faturas_cartao','contas_a_pagar','contas_a_receber','transferencias_internas','recorrencias'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('SELECT count(*) FROM public.whatsapp_reorganization_full_journal j WHERE j.operation_id=$1 AND j.table_name=%L AND NOT EXISTS(SELECT 1 FROM public.%I x WHERE x.id=j.row_id AND to_jsonb(x)=j.after_row)',t,t) INTO n USING op.id;
   conflicts:=conflicts+n;
  END IF;
 END LOOP;
 IF conflicts>0 THEN RETURN jsonb_build_object('status','changed','conflicts',conflicts); END IF;
 -- Movimentações feitas depois da limpeza nunca são apagadas nem duplicadas:
-- fatura do mesmo cartão/mês ou recorrência com a mesma chave criada depois
-- prevalece; a antiga continua arquivada e é informada como "mantida a atual".
 SELECT coalesce(array_agg(j.row_id),'{}') INTO superseded FROM public.whatsapp_reorganization_full_journal j
  WHERE j.operation_id=op.id AND (
   (j.table_name='faturas_cartao' AND EXISTS(SELECT 1 FROM public.faturas_cartao f WHERE f.user_id=p_user AND f.reorg_archived_at IS NULL AND f.id<>j.row_id
     AND f.cartao_id::text=j.before_row->>'cartao_id' AND f.mes::text=j.before_row->>'mes' AND f.ano::text=j.before_row->>'ano'))
   OR (j.table_name='recorrencias' AND j.before_row->>'detection_key' IS NOT NULL AND EXISTS(SELECT 1 FROM public.recorrencias r WHERE r.user_id=p_user AND r.reorg_archived_at IS NULL AND r.id<>j.row_id
     AND to_jsonb(r)->>'detection_key'=j.before_row->>'detection_key')));
 -- Lançamento igual digitado de novo depois da limpeza: não é fundido, só sinalizado.
 SELECT count(*) INTO dups FROM public.whatsapp_reorganization_full_journal j
  WHERE j.operation_id=op.id AND j.table_name IN('gastos','receitas') AND EXISTS(
   SELECT 1 FROM (SELECT 'gastos' tn,to_jsonb(g) r FROM public.gastos g WHERE g.user_id=p_user AND g.deleted_at IS NULL
                  UNION ALL SELECT 'receitas',to_jsonb(x) FROM public.receitas x WHERE x.user_id=p_user AND x.deleted_at IS NULL) a
   WHERE a.tn=j.table_name AND (a.r->>'id')::uuid<>j.row_id AND public.financial_import_signature(a.tn,a.r)=public.financial_import_signature(j.table_name,j.before_row));
 PERFORM set_config('gi.reorganization_mutation','on',true);
 PERFORM set_config('gi.gastos_soft_delete','on',true);
 FOREACH t IN ARRAY ARRAY['gastos','receitas','faturas_cartao','contas_a_pagar','contas_a_receber','transferencias_internas','recorrencias'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   SELECT string_agg(quote_ident(c.column_name),',' ORDER BY c.ordinal_position) INTO cols FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name=t AND c.column_name<>'id' AND c.is_generated='NEVER' AND c.is_updatable='YES';
   EXECUTE format('UPDATE public.%I x SET (%s)=(SELECT %s FROM jsonb_populate_record(NULL::public.%I,j.before_row)) FROM public.whatsapp_reorganization_full_journal j WHERE j.operation_id=$1 AND j.table_name=%L AND x.id=j.row_id AND x.user_id=$2 AND NOT (x.id=ANY($3))',
    t,cols,cols,t,t) USING op.id,p_user,superseded;
   GET DIAGNOSTICS n=ROW_COUNT; total:=total+n;
  END IF;
 END LOOP;
 PERFORM set_config('gi.gastos_soft_delete','off',true);
 SELECT count(*)-cardinality(superseded) INTO expected FROM public.whatsapp_reorganization_full_journal WHERE operation_id=op.id;
 IF total<>expected THEN RAISE EXCEPTION 'restore_row_count_mismatch'; END IF;
 DELETE FROM public.financial_import_tombstones WHERE user_id=p_user AND batch_id=op.id;
 INSERT INTO public.financial_write_generations(user_id,generation) VALUES(p_user,1) ON CONFLICT(user_id) DO UPDATE SET generation=financial_write_generations.generation+1;
 PERFORM set_config('gi.reorganization_mutation','off',true);
 op.restore_result:=op.summary||jsonb_build_object('status','restored','mode','full','operationId',op.id,'kept',0,'supersededByNewer',cardinality(superseded),'possibleDuplicates',dups);
 UPDATE public.whatsapp_reorganization_full_operations SET status='restored',restore_result=op.restore_result,restored_at=clock_timestamp() WHERE id=op.id;
 IF to_regclass('public.audit_logs') IS NOT NULL THEN
  INSERT INTO public.audit_logs(actor_user_id,target_user_id,action,entity_type,entity_id,metadata) VALUES(p_user,p_user,'whatsapp_full_reset_restore','financial_operation',op.id::text,op.restore_result);
 END IF;
 RETURN op.restore_result;
END $$;

CREATE FUNCTION public.wa_full_reset_last_applied(p_user uuid,p_phone text) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_reorganization_allowlist a WHERE a.user_id=p_user) THEN RETURN NULL; END IF;
 RETURN (SELECT o.id FROM public.whatsapp_reorganization_full_operations o
  WHERE o.user_id=p_user AND o.status='applied' AND o.phone_hash=encode(sha256(convert_to(regexp_replace(p_phone,'\D','','g'),'UTF8')),'hex')
  ORDER BY o.completed_at DESC LIMIT 1);
END $$;

REVOKE ALL ON FUNCTION public.financial_import_signature(text,jsonb),public.wa_full_reset_bem_linked(jsonb),public.wa_full_reset_rows(uuid),public.wa_full_reset_summary(jsonb),
 public.wa_full_reset_prepare(uuid,text,text,text),public.wa_full_reset_confirm(uuid,text,text,uuid),
 public.wa_full_reset_restore_prepare(uuid,text,uuid,text),public.wa_full_reset_restore_confirm(uuid,text,uuid,text),
 public.wa_full_reset_last_applied(uuid,text),public.tg_wa_full_journal_immutable() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_full_reset_prepare(uuid,text,text,text),public.wa_full_reset_confirm(uuid,text,text,uuid),
 public.wa_full_reset_restore_prepare(uuid,text,uuid,text),public.wa_full_reset_restore_confirm(uuid,text,uuid,text),
 public.wa_full_reset_last_applied(uuid,text) TO service_role;

-- ===== 16/17 financial-post-reset-writers.sql =====
-- CANDIDATO (não aplicado). Uso normal depois de "zerar tudo".
-- Substitui a quarentena das travas universal/vinculada: após a limpeza o
-- titular volta a lançar gastos, receitas, cartões, faturas, contas e
-- movimentações pelo site e pelo WhatsApp, sem erro.
--  * Escritor online (sem offline_client_id) recebe a geração atual carimbada:
--    é um lançamento novo, nunca confundido com os ocultados (id próprio,
--    sem marca de exclusão/arquivamento, fora do diário da limpeza).
--  * Fila offline continua precisando da geração vigente (fila antiga à limpeza
--    é recusada para revisão).
--  * Registros ocultados/arquivados pela limpeza seguem imutáveis fora das
--    funções confiáveis, e nada que esteja numa limpeza aplicada pode ser
--    apagado fisicamente (a restauração depende deles).
--  * Reimportação de lançamento zerado continua barrada pelas lápides.
-- Dependências: financial-universal-fence, financial-linked-writer-fence,
-- whatsapp-reorganizacao-full-reset.

SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regclass('public.whatsapp_reorganization_full_journal') IS NULL
 OR to_regprocedure('public.financial_universal_fence()') IS NULL
 OR to_regprocedure('public.financial_linked_writer_fence()') IS NULL
 THEN RAISE EXCEPTION 'post_reset_prerequisites_missing'; END IF;
END $$;

CREATE FUNCTION public.financial_row_in_applied_reset(p_table text,p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.whatsapp_reorganization_full_journal j
  JOIN public.whatsapp_reorganization_full_operations o ON o.id=j.operation_id
  WHERE j.table_name=p_table AND j.row_id=p_id AND o.status='applied')
$$;
REVOKE ALL ON FUNCTION public.financial_row_in_applied_reset(text,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.financial_offline_generation_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.offline_client_id IS NULL THEN RETURN NEW; END IF;
 IF current_setting('gi.reorganization_mutation',true)='on' AND current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID) THEN RETURN NEW; END IF;
 -- Edição online de um lançamento que nasceu offline (mesma geração gravada): não é replay de fila.
 IF TG_OP='UPDATE' AND NEW.offline_client_id IS NOT DISTINCT FROM OLD.offline_client_id AND NEW.offline_generation IS NOT DISTINCT FROM OLD.offline_generation THEN
  IF OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'offline_cannot_restore_deleted_entry'; END IF;
  RETURN NEW;
 END IF;
 PERFORM public.financial_assert_generation(NEW.user_id,NEW.offline_generation);
 IF TG_OP='UPDATE' AND OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'offline_cannot_restore_deleted_entry'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.financial_universal_fence()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE owner_id uuid; version bigint; privileged boolean;
BEGIN
 owner_id:=CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
 IF TG_OP='UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'financial_owner_reassignment_forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||owner_id::text,0));
 version:=public.financial_current_generation(owner_id);
 privileged:=current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
 AND current_setting('gi.reorganization_mutation',true)='on';
 IF privileged THEN IF TG_OP='DELETE' THEN RAISE EXCEPTION 'reorganization_physical_delete_forbidden'; END IF; RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN
  IF OLD.deleted_at IS NOT NULL OR public.financial_row_in_applied_reset(TG_TABLE_NAME,OLD.id) THEN RAISE EXCEPTION 'financial_physical_delete_forbidden'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'financial_tombstone_immutable'; END IF;
 IF TG_OP='UPDATE' AND OLD.offline_client_id IS DISTINCT FROM NEW.offline_client_id THEN RAISE EXCEPTION 'financial_writer_requires_operation_context'; END IF;
 IF NEW.offline_client_id IS NULL THEN
  -- Lançamento/edição online: pertence à geração vigente.
  NEW.offline_generation:=version; RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND NEW.offline_generation IS NOT DISTINCT FROM OLD.offline_generation THEN RETURN NEW; END IF;
 PERFORM public.financial_assert_generation(owner_id,NEW.offline_generation);
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.financial_linked_writer_fence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE owner_id uuid; trusted boolean;
BEGIN
 owner_id:=CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
 IF TG_OP='UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'financial_owner_reassignment_forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gi_gastos_soft_delete:'||owner_id::text,0));
 trusted:=current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID) AND current_setting('gi.reorganization_mutation',true)='on';
 IF trusted THEN IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
 -- Arquivado pela limpeza: só a restauração mexe (vale também para service role).
 IF TG_OP IN('UPDATE','DELETE') AND to_jsonb(OLD)->>'reorg_archived_at' IS NOT NULL THEN RAISE EXCEPTION 'archived_by_reset_immutable'; END IF;
 IF TG_OP IN('INSERT','UPDATE') AND (to_jsonb(NEW)->>'reorg_archived_at' IS NOT NULL OR to_jsonb(NEW)->>'reorg_batch_id' IS NOT NULL) THEN RAISE EXCEPTION 'archived_by_reset_immutable'; END IF;
 IF TG_OP='DELETE' AND public.financial_row_in_applied_reset(TG_TABLE_NAME,OLD.id) THEN RAISE EXCEPTION 'financial_physical_delete_forbidden'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

-- ===== 17/17 whatsapp-reorganizacao-preview-only.sql =====
-- CANDIDATO (não aplicado). Trava "somente prévia" da limpeza por WhatsApp.
-- Com preview_only=TRUE (padrão, e também quando a linha de política não existe)
-- a prévia funciona, mas NENHUMA execução/restauração grava, nem por chamada
-- direta às RPCs com código correto: o banco recusa (1) qualquer operação que
-- vire applied/partial/restored e (2) qualquer escrita financeira feita sob a
-- marca de mutação da reorganização. Desligar exige UPDATE explícito da política.
-- Dependências: whatsapp-reorganizacao, owner-allowlist, full-reset, post-reset-writers.

SET LOCAL lock_timeout='5s';
ALTER TABLE public.whatsapp_reorganization_policy ADD COLUMN IF NOT EXISTS preview_only boolean NOT NULL DEFAULT true;
UPDATE public.whatsapp_reorganization_policy SET preview_only=true;

CREATE FUNCTION public.wa_reorganization_preview_only() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce((SELECT preview_only FROM public.whatsapp_reorganization_policy WHERE id),true)
$$;
REVOKE ALL ON FUNCTION public.wa_reorganization_preview_only() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.tg_wa_reorganization_preview_only_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.status IN('applied','partial','restored') AND public.wa_reorganization_preview_only() THEN
  RAISE EXCEPTION 'reorganization_preview_only'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.tg_wa_reorganization_preview_only_rows() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_setting('gi.reorganization_mutation',true)='on' AND public.wa_reorganization_preview_only() THEN
  RAISE EXCEPTION 'reorganization_preview_only'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_wa_reorganization_preview_only_status(),public.tg_wa_reorganization_preview_only_rows() FROM PUBLIC,anon,authenticated;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['whatsapp_reorganization_operations','whatsapp_reorganization_full_operations'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('CREATE TRIGGER wa_reorganization_preview_only BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_wa_reorganization_preview_only_status()',t);
  END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['gastos','receitas','faturas_cartao','contas_a_pagar','contas_a_receber','transferencias_internas','recorrencias'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('CREATE TRIGGER wa_reorganization_preview_only BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_wa_reorganization_preview_only_rows()',t);
  END IF;
 END LOOP;
END $$;
