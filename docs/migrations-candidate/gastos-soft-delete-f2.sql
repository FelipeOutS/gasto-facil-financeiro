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
  IF current_setting('gi.gastos_soft_delete', true) = 'on' THEN
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
