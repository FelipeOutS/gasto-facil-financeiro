-- =====================================================================
-- CANDIDATA — NÃO APLICADA. Exclusão/restauração de um MÊS inteiro de
-- gastos OU receitas pelo WhatsApp (P1 14/10/2026).
-- Só aditiva: 1 tabela de lotes (somente IDs, sem valores) + 2 RPCs.
-- Soft-delete (deleted_at); nunca DELETE físico. Tudo-ou-nada.
-- EXECUTE apenas para service_role (o servidor do WhatsApp já validou
-- vínculo, consentimento e plano; p_user_id vem desse vínculo).
-- Incompatível com a candidata F2 (gatilho gastos_guard_soft_delete):
-- se a F2 for aplicada, wa_lote_mes_excluir falha com 42501 e faz
-- rollback (fail closed) — revisar antes de aplicar as duas.
-- Idempotente: pode ser executada duas vezes.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_lote_mes_acoes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('gastos', 'receitas')),
  ano int NOT NULL CHECK (ano BETWEEN 2000 AND 2100),
  mes int NOT NULL CHECK (mes BETWEEN 1 AND 12),
  item_ids uuid[] NOT NULL,
  deleted_stamp timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'excluido' CHECK (status IN ('excluido', 'restaurado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS whatsapp_lote_mes_acoes_user_idx
  ON public.whatsapp_lote_mes_acoes (user_id, tipo, ano, mes, created_at DESC);
REVOKE ALL ON public.whatsapp_lote_mes_acoes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.whatsapp_lote_mes_acoes TO service_role;
ALTER TABLE public.whatsapp_lote_mes_acoes ENABLE ROW LEVEL SECURITY;
-- Sem políticas: somente service_role (BYPASSRLS) acessa.

CREATE OR REPLACE FUNCTION public.wa_lote_mes_excluir(
  p_user_id uuid, p_batch_id uuid, p_tipo text, p_ano int, p_mes int,
  p_ids uuid[], p_versions timestamptz[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_ini date; v_fim date; v_now timestamptz := clock_timestamp();
  v_elig uuid[]; v_ver timestamptz[]; v_in_ids uuid[]; v_in_ver timestamptz[];
  v_prev public.whatsapp_lote_mes_acoes%ROWTYPE; v_n int;
BEGIN
  IF p_user_id IS NULL OR p_batch_id IS NULL THEN RAISE EXCEPTION 'parametros_obrigatorios' USING ERRCODE = '22023'; END IF;
  IF p_tipo NOT IN ('gastos', 'receitas') THEN RAISE EXCEPTION 'tipo_invalido' USING ERRCODE = '22023'; END IF;
  IF p_mes IS NULL OR p_mes NOT BETWEEN 1 AND 12 OR p_ano IS NULL OR p_ano NOT BETWEEN 2000 AND 2100 THEN
    RAISE EXCEPTION 'periodo_invalido' USING ERRCODE = '22023'; END IF;
  IF coalesce(cardinality(p_ids), 0) NOT BETWEEN 1 AND 500 OR cardinality(p_ids) <> coalesce(cardinality(p_versions), -1) THEN
    RAISE EXCEPTION 'conjunto_invalido' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_ids) x) <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'ids_duplicados' USING ERRCODE = '22023'; END IF;

  -- Serializa lotes do mesmo usuário (duplo Confirmar / webhook duplicado).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':wa_lote_mes', 0));
  SELECT * INTO v_prev FROM public.whatsapp_lote_mes_acoes WHERE id = p_batch_id;
  IF FOUND THEN
    IF v_prev.user_id <> p_user_id THEN RAISE EXCEPTION 'lote_de_outro_usuario' USING ERRCODE = '42501'; END IF;
    RETURN jsonb_build_object('status', 'replay', 'count', cardinality(v_prev.item_ids));
  END IF;

  v_ini := make_date(p_ano, p_mes, 1);
  v_fim := (v_ini + interval '1 month')::date;
  SELECT array_agg(i ORDER BY i), array_agg(v ORDER BY i) INTO v_in_ids, v_in_ver
    FROM unnest(p_ids, p_versions) AS x(i, v);

  IF p_tipo = 'gastos' THEN
    PERFORM 1 FROM public.gastos WHERE user_id = p_user_id AND data >= v_ini AND data < v_fim AND deleted_at IS NULL FOR UPDATE;
    SELECT coalesce(array_agg(g.id ORDER BY g.id), '{}'), coalesce(array_agg(g.updated_at ORDER BY g.id), '{}')
      INTO v_elig, v_ver
      FROM public.gastos g
     WHERE g.user_id = p_user_id AND g.data >= v_ini AND g.data < v_fim AND g.deleted_at IS NULL
       AND g.grupo_parcelamento_id IS NULL AND coalesce(g.total_parcelas, 1) <= 1
       AND g.recorrencia_id IS NULL AND g.bem_id IS NULL AND g.cartao_id IS NULL
       AND coalesce(g.forma_pagamento, '') <> 'credito' AND g.import_batch_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.contas_a_pagar c WHERE c.gasto_id = g.id);
  ELSE
    PERFORM 1 FROM public.receitas WHERE user_id = p_user_id AND data >= v_ini AND data < v_fim AND deleted_at IS NULL FOR UPDATE;
    SELECT coalesce(array_agg(r.id ORDER BY r.id), '{}'), coalesce(array_agg(r.updated_at ORDER BY r.id), '{}')
      INTO v_elig, v_ver
      FROM public.receitas r
     WHERE r.user_id = p_user_id AND r.data >= v_ini AND r.data < v_fim AND r.deleted_at IS NULL
       AND r.recorrencia_id IS NULL AND r.import_batch_id IS NULL;
  END IF;

  -- Snapshot da prévia (IDs + updated_at) precisa bater exatamente.
  IF v_elig IS DISTINCT FROM v_in_ids OR v_ver IS DISTINCT FROM v_in_ver THEN
    RETURN jsonb_build_object('status', 'changed', 'count', cardinality(v_elig));
  END IF;

  IF p_tipo = 'gastos' THEN
    UPDATE public.gastos SET deleted_at = v_now, updated_at = v_now
     WHERE id = ANY (v_elig) AND user_id = p_user_id AND deleted_at IS NULL;
  ELSE
    UPDATE public.receitas SET deleted_at = v_now, updated_at = v_now,
           deleted_source = 'whatsapp_lote_mes', deleted_reason = 'exclusao_lote_mes'
     WHERE id = ANY (v_elig) AND user_id = p_user_id AND deleted_at IS NULL;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> cardinality(v_elig) THEN RAISE EXCEPTION 'contagem_divergente' USING ERRCODE = '40001'; END IF;

  INSERT INTO public.whatsapp_lote_mes_acoes (id, user_id, tipo, ano, mes, item_ids, deleted_stamp)
  VALUES (p_batch_id, p_user_id, p_tipo, p_ano, p_mes, v_elig, v_now);
  RETURN jsonb_build_object('status', 'deleted', 'count', v_n);
END $$;

CREATE OR REPLACE FUNCTION public.wa_lote_mes_restaurar(
  p_user_id uuid, p_batch_id uuid, p_expected int
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_l public.whatsapp_lote_mes_acoes%ROWTYPE; v_ids uuid[]; v_n int;
BEGIN
  IF p_user_id IS NULL OR p_batch_id IS NULL OR p_expected IS NULL OR p_expected < 1 THEN
    RAISE EXCEPTION 'parametros_obrigatorios' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':wa_lote_mes', 0));
  SELECT * INTO v_l FROM public.whatsapp_lote_mes_acoes WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lote_inexistente' USING ERRCODE = 'P0002'; END IF;
  IF v_l.user_id <> p_user_id THEN RAISE EXCEPTION 'lote_de_outro_usuario' USING ERRCODE = '42501'; END IF;
  IF v_l.status = 'restaurado' THEN RETURN jsonb_build_object('status', 'replay', 'count', 0); END IF;

  -- Só linhas ainda marcadas POR ESTE LOTE (mesmo carimbo de deleted_at).
  -- Restaurado individualmente ou excluído de novo por outra operação: fica de fora.
  IF v_l.tipo = 'gastos' THEN
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_ids FROM (
      SELECT id FROM public.gastos WHERE id = ANY (v_l.item_ids) AND user_id = p_user_id
         AND deleted_at = v_l.deleted_stamp FOR UPDATE) s;
  ELSE
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_ids FROM (
      SELECT id FROM public.receitas WHERE id = ANY (v_l.item_ids) AND user_id = p_user_id
         AND deleted_at = v_l.deleted_stamp FOR UPDATE) s;
  END IF;
  IF cardinality(v_ids) <> p_expected THEN
    RETURN jsonb_build_object('status', 'changed', 'count', cardinality(v_ids));
  END IF;

  IF v_l.tipo = 'gastos' THEN
    UPDATE public.gastos SET deleted_at = NULL, updated_at = clock_timestamp()
     WHERE id = ANY (v_ids) AND user_id = p_user_id AND deleted_at = v_l.deleted_stamp;
  ELSE
    UPDATE public.receitas SET deleted_at = NULL, updated_at = clock_timestamp(), deleted_source = NULL, deleted_reason = NULL
     WHERE id = ANY (v_ids) AND user_id = p_user_id AND deleted_at = v_l.deleted_stamp;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> cardinality(v_ids) THEN RAISE EXCEPTION 'contagem_divergente' USING ERRCODE = '40001'; END IF;
  UPDATE public.whatsapp_lote_mes_acoes SET status = 'restaurado', restored_at = clock_timestamp() WHERE id = p_batch_id;
  RETURN jsonb_build_object('status', 'restored', 'count', v_n);
END $$;

REVOKE ALL ON FUNCTION public.wa_lote_mes_excluir(uuid, uuid, text, int, int, uuid[], timestamptz[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wa_lote_mes_restaurar(uuid, uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_lote_mes_excluir(uuid, uuid, text, int, int, uuid[], timestamptz[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.wa_lote_mes_restaurar(uuid, uuid, int) TO service_role;
