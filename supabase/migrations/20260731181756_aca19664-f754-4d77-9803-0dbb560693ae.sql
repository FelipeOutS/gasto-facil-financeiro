-- =========================================================================
-- Migration A — Estrutura de soft delete em public.receitas
-- SOFT DELETE: nenhum registro é removido fisicamente. As colunas abaixo
-- apenas marcam o registro como "oculto" para as consultas operacionais.
-- Reversão: UPDATE public.receitas SET deleted_at=NULL, deleted_reason=NULL,
--           deleted_source=NULL WHERE id = ANY(<lista de IDs>);
-- =========================================================================
ALTER TABLE public.receitas
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason text NULL,
  ADD COLUMN IF NOT EXISTS deleted_source text NULL;

COMMENT ON COLUMN public.receitas.deleted_at IS
  'Soft delete (NAO e exclusao fisica): quando preenchido, a linha deve ser ignorada por todas as consultas operacionais (dashboards, relatorios, somas, APIs). NULL = registro ativo.';
COMMENT ON COLUMN public.receitas.deleted_reason IS
  'Motivo do soft delete. Ex.: confirmed_test_recurring_income.';
COMMENT ON COLUMN public.receitas.deleted_source IS
  'Origem/lote da operacao de soft delete. Ex.: controlled_cleanup_2026_07_31.';

-- Índices parciais para as consultas operacionais (somente registros ativos).
CREATE INDEX IF NOT EXISTS idx_receitas_user_periodo_ativas
  ON public.receitas (user_id, ano, mes)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_receitas_user_data_ativas
  ON public.receitas (user_id, data)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_receitas_recorrencia_ativas
  ON public.receitas (recorrencia_id)
  WHERE deleted_at IS NULL AND recorrencia_id IS NOT NULL;

-- =========================================================================
-- Migration B — Quarentena controlada dos 12 registros confirmados
-- =========================================================================
DO $$
DECLARE
  v_ids uuid[] := ARRAY[
    '3e7dc017-c2a4-4b0f-ae13-24bd60fac4ca',
    '769f7a24-2539-4a7a-ba07-32693ac3c9f4',
    'de07fb13-a4e6-4fbf-94ec-89baee777120',
    'c76d5356-bb02-45fb-aae9-9b8c97e98640',
    '23491df9-9742-4cd9-9378-a3802891d878',
    'c6bf60f0-ad97-4b2f-85ac-982f4fb325c1',
    '93060a44-087e-4ec3-91c8-2fe2382bf2d4',
    '01f07dd8-32ed-4159-aa09-da51a70b1c69',
    '236aa1e4-ea0e-41b2-a48d-690993507c52',
    '7ae8ff22-ba08-43f7-92f4-cc2c0369e5c4',
    '53026e84-2f17-416f-b426-3ff6c6595247',
    'bf39361f-9066-4c3e-ace4-30341e351f05'
  ]::uuid[];
  v_expected_user uuid := 'cafcb221-3537-4b62-b647-bec6427b7050';
  v_expected_rec  uuid := 'e6629b5a-8760-41a3-8215-040f8757e11d';
  v_count int;
  v_users int;
  v_recs int;
  v_bad int;
  v_already int;
  v_sum numeric;
  v_updated int;
BEGIN
  SELECT count(*), count(DISTINCT user_id), count(DISTINCT recorrencia_id), sum(valor),
         count(*) FILTER (WHERE descricao <> '5555' OR valor <> 55555555555.00 OR tipo <> 'salario'
                            OR user_id <> v_expected_user OR recorrencia_id <> v_expected_rec
                            OR data < DATE '2026-05-01' OR data > DATE '2027-04-30'),
         count(*) FILTER (WHERE deleted_at IS NOT NULL)
    INTO v_count, v_users, v_recs, v_sum, v_bad, v_already
    FROM public.receitas
   WHERE id = ANY(v_ids);

  IF v_count <> 12 THEN
    RAISE EXCEPTION 'ABORT: esperados 12 registros, encontrados %', v_count;
  END IF;
  IF v_users <> 1 OR v_recs <> 1 THEN
    RAISE EXCEPTION 'ABORT: proprietarios=% recorrencias=% (esperado 1/1)', v_users, v_recs;
  END IF;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'ABORT: % registro(s) nao correspondem ao diagnostico', v_bad;
  END IF;
  IF v_already <> 0 THEN
    RAISE EXCEPTION 'ABORT: % registro(s) ja estao em soft delete', v_already;
  END IF;
  IF v_sum <> 666666666660.00 THEN
    RAISE EXCEPTION 'ABORT: soma % diferente da esperada 666666666660.00', v_sum;
  END IF;

  UPDATE public.receitas
     SET deleted_at = now(),
         deleted_reason = 'confirmed_test_recurring_income',
         deleted_source = 'controlled_cleanup_2026_07_31'
   WHERE id = ANY(v_ids)
     AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 12 THEN
    RAISE EXCEPTION 'ABORT: soft delete afetou % linhas (esperado 12)', v_updated;
  END IF;

  -- Recorrência vinculada: o recorrencia_id 'e6629b5a…e11d' NAO existe em
  -- public.recorrencias (e um agrupador gerado no cliente, nao FK). Portanto
  -- nao ha registro de recorrencia a desativar e nenhuma outra recorrencia foi
  -- tocada. Sem as 12 linhas ativas, a serie deixa de existir operacionalmente.
  SELECT count(*) INTO v_count FROM public.recorrencias WHERE id = v_expected_rec;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'ABORT: recorrencia inesperada encontrada, revisar manualmente';
  END IF;
END $$;

-- =========================================================================
-- Migration C — Teto de valor para receitas ATIVAS
-- Pré-validação: nenhuma receita ativa fora da faixa após a quarentena.
-- =========================================================================
DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM public.receitas
   WHERE deleted_at IS NULL AND (valor <= 0 OR valor > 999999999.99);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'ABORT: % receita(s) ativa(s) fora da faixa permitida', v_bad;
  END IF;
END $$;

ALTER TABLE public.receitas
  ADD CONSTRAINT receitas_valor_valid_range_check
  CHECK (deleted_at IS NOT NULL OR (valor > 0 AND valor <= 999999999.99));

COMMENT ON CONSTRAINT receitas_valor_valid_range_check ON public.receitas IS
  'Receitas ativas devem ter valor > 0 e <= 999999999.99 (MAX_FINANCIAL_ENTRY_AMOUNT). Registros em soft delete ficam isentos para preservar dados historicos sem alteracao.';
