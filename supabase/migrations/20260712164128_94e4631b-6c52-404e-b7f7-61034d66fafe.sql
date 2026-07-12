-- WA-SEC-RPC-01 — Hardening de RPCs financeiras SECURITY DEFINER
-- 1) Guarda interna: rejeita chamadas fora de service_role.
-- 2) REVOKE EXECUTE de PUBLIC/anon/authenticated; GRANT EXECUTE apenas a service_role.
-- Corpo funcional preservado (contrato, ownership, idempotência e retornos inalterados).

-- =========================================================================
-- 1. whatsapp_baixa_conta_atomic
-- =========================================================================
CREATE OR REPLACE FUNCTION public.whatsapp_baixa_conta_atomic(
  p_user_id uuid,
  p_conta_id uuid,
  p_data_pagamento date,
  p_origem text DEFAULT 'whatsapp'::text
)
RETURNS TABLE(result text, gasto_id uuid, nome text, valor numeric, data_pagamento date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_conta RECORD;
  v_gasto_id uuid;
  v_forma text;
  v_estab text;
BEGIN
  -- WA-SEC-RPC-01: apenas service_role pode invocar.
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'permission denied for function whatsapp_baixa_conta_atomic'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_conta_id IS NULL OR p_data_pagamento IS NULL THEN
    RAISE EXCEPTION 'parametros obrigatorios ausentes';
  END IF;

  SELECT * INTO v_conta
  FROM public.contas_a_pagar
  WHERE id = p_conta_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::numeric, NULL::date;
    RETURN;
  END IF;

  IF v_conta.status = 'pago' AND v_conta.gasto_id IS NOT NULL THEN
    RETURN QUERY SELECT 'noop'::text, v_conta.gasto_id, v_conta.nome, v_conta.valor, v_conta.data_pagamento;
    RETURN;
  END IF;

  IF v_conta.status = 'pago' AND v_conta.gasto_id IS NULL THEN
    RETURN QUERY SELECT 'inconsistent'::text, NULL::uuid, v_conta.nome, v_conta.valor, v_conta.data_pagamento;
    RETURN;
  END IF;

  IF v_conta.status <> 'pendente' THEN
    RETURN QUERY SELECT 'not_pending'::text, NULL::uuid, v_conta.nome, v_conta.valor, v_conta.data_pagamento;
    RETURN;
  END IF;

  v_forma := COALESCE(NULLIF(trim(v_conta.forma_pagamento), ''), 'outros');
  v_estab := COALESCE(NULLIF(trim(v_conta.beneficiario), ''), '');

  INSERT INTO public.gastos (
    user_id, categoria_id, descricao, valor, data,
    estabelecimento, forma_pagamento, mes, ano,
    tipo_gasto, confirmado, origem
  ) VALUES (
    p_user_id,
    v_conta.categoria_id,
    COALESCE(NULLIF(trim(v_conta.nome), ''), 'Conta'),
    v_conta.valor,
    p_data_pagamento,
    v_estab,
    v_forma,
    EXTRACT(month FROM p_data_pagamento)::smallint,
    EXTRACT(year FROM p_data_pagamento)::int,
    'unico',
    true,
    COALESCE(p_origem, 'whatsapp')
  )
  RETURNING id INTO v_gasto_id;

  IF v_gasto_id IS NULL THEN
    RAISE EXCEPTION 'falha ao criar gasto correspondente';
  END IF;

  UPDATE public.contas_a_pagar
  SET status = 'pago',
      data_pagamento = p_data_pagamento,
      gasto_id = v_gasto_id,
      updated_at = now()
  WHERE id = p_conta_id
    AND user_id = p_user_id
    AND status = 'pendente';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'falha ao atualizar conta pendente';
  END IF;

  RETURN QUERY SELECT 'paid'::text, v_gasto_id, v_conta.nome, v_conta.valor, p_data_pagamento;
END;
$function$;

REVOKE ALL ON FUNCTION public.whatsapp_baixa_conta_atomic(uuid, uuid, date, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.whatsapp_baixa_conta_atomic(uuid, uuid, date, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.whatsapp_baixa_conta_atomic(uuid, uuid, date, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_baixa_conta_atomic(uuid, uuid, date, text) TO service_role;

-- =========================================================================
-- 2. create_installment_purchase
-- =========================================================================
CREATE OR REPLACE FUNCTION public.create_installment_purchase(
  p_user_id uuid,
  p_cartao_id uuid,
  p_categoria_id uuid,
  p_descricao text,
  p_estabelecimento text,
  p_observacao text,
  p_origem text,
  p_grupo_id uuid,
  p_total_parcelas integer,
  p_parcelas jsonb
)
RETURNS TABLE(id uuid, parcela_atual integer, invoice_month text, valor numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cartao_owner uuid;
  v_cat_owner uuid;
  v_item jsonb;
  v_count integer;
  v_valor numeric;
  v_sum numeric := 0;
  v_numero integer;
  v_invm text;
  v_seq integer[] := ARRAY[]::integer[];
  v_i integer;
BEGIN
  -- WA-SEC-RPC-01: apenas service_role pode invocar.
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'permission denied for function create_installment_purchase'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id obrigatório';
  END IF;
  IF p_cartao_id IS NULL THEN
    RAISE EXCEPTION 'cartao_id obrigatório';
  END IF;
  IF p_total_parcelas IS NULL OR p_total_parcelas < 2 OR p_total_parcelas > 48 THEN
    RAISE EXCEPTION 'total_parcelas inválido (2..48)';
  END IF;
  IF p_grupo_id IS NULL THEN
    RAISE EXCEPTION 'grupo_id obrigatório';
  END IF;

  SELECT c.user_id INTO v_cartao_owner FROM public.cartoes c WHERE c.id = p_cartao_id;
  IF v_cartao_owner IS NULL OR v_cartao_owner <> p_user_id THEN
    RAISE EXCEPTION 'cartão não pertence ao usuário';
  END IF;

  IF p_categoria_id IS NOT NULL THEN
    SELECT cat.user_id INTO v_cat_owner FROM public.categorias cat WHERE cat.id = p_categoria_id;
    IF v_cat_owner IS NULL OR v_cat_owner <> p_user_id THEN
      RAISE EXCEPTION 'categoria não pertence ao usuário';
    END IF;
  END IF;

  SELECT count(*) INTO v_count FROM jsonb_array_elements(p_parcelas);
  IF v_count <> p_total_parcelas THEN
    RAISE EXCEPTION 'quantidade de parcelas (%) difere de total_parcelas (%)', v_count, p_total_parcelas;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_parcelas) LOOP
    v_valor := (v_item->>'valor')::numeric;
    IF v_valor IS NULL OR v_valor <= 0 THEN
      RAISE EXCEPTION 'parcela com valor inválido';
    END IF;
    v_sum := v_sum + v_valor;
    v_invm := v_item->>'invoice_month';
    IF v_invm IS NULL OR v_invm !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
      RAISE EXCEPTION 'invoice_month inválido (esperado YYYY-MM)';
    END IF;
    v_numero := (v_item->>'numero')::integer;
    IF v_numero IS NULL OR v_numero < 1 OR v_numero > p_total_parcelas THEN
      RAISE EXCEPTION 'parcela_atual fora do intervalo 1..%', p_total_parcelas;
    END IF;
    v_seq := array_append(v_seq, v_numero);
  END LOOP;

  IF v_sum <= 0 THEN
    RAISE EXCEPTION 'soma das parcelas deve ser maior que zero';
  END IF;

  FOR v_i IN 1..p_total_parcelas LOOP
    IF NOT (v_i = ANY(v_seq)) THEN
      RAISE EXCEPTION 'sequência de parcelas inválida (faltando %)', v_i;
    END IF;
  END LOOP;
  IF array_length(v_seq, 1) <> p_total_parcelas THEN
    RAISE EXCEPTION 'sequência de parcelas inválida (duplicada)';
  END IF;

  RETURN QUERY
  WITH inserted AS (
    INSERT INTO public.gastos (
      user_id, cartao_id, categoria_id,
      descricao, estabelecimento, observacao,
      valor, data, mes, ano,
      invoice_month, forma_pagamento, tipo_gasto,
      parcela_atual, total_parcelas, grupo_parcelamento_id,
      origem, confirmado
    )
    SELECT
      p_user_id, p_cartao_id, p_categoria_id,
      p_descricao, p_estabelecimento, p_observacao,
      (item->>'valor')::numeric,
      (item->>'data')::date,
      (item->>'mes')::integer,
      (item->>'ano')::integer,
      item->>'invoice_month',
      'credito',
      'parcelado',
      (item->>'numero')::integer,
      p_total_parcelas,
      p_grupo_id,
      coalesce(p_origem, 'whatsapp'),
      true
    FROM jsonb_array_elements(p_parcelas) AS item
    RETURNING public.gastos.id, public.gastos.parcela_atual::integer AS parcela_atual,
              public.gastos.invoice_month, public.gastos.valor
  )
  SELECT inserted.id, inserted.parcela_atual, inserted.invoice_month, inserted.valor
    FROM inserted ORDER BY inserted.parcela_atual;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_installment_purchase(uuid, uuid, uuid, text, text, text, text, uuid, integer, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_installment_purchase(uuid, uuid, uuid, text, text, text, text, uuid, integer, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_installment_purchase(uuid, uuid, uuid, text, text, text, text, uuid, integer, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_installment_purchase(uuid, uuid, uuid, text, text, text, text, uuid, integer, jsonb) TO service_role;

-- =========================================================================
-- 3. create_recurring_income
-- =========================================================================
CREATE OR REPLACE FUNCTION public.create_recurring_income(
  p_user_id uuid,
  p_descricao text,
  p_valor numeric,
  p_data date,
  p_tipo text,
  p_frequencia text,
  p_dia_mes integer DEFAULT NULL::integer,
  p_dia_semana integer DEFAULT NULL::integer,
  p_observacao text DEFAULT NULL::text,
  p_origem text DEFAULT 'whatsapp'::text
)
RETURNS TABLE(receita_id uuid, recorrencia_id uuid, proxima_cobranca date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rec_id uuid;
  v_receita_id uuid;
  v_prox date;
  v_freq text := lower(coalesce(p_frequencia, 'mensal'));
  v_today date := p_data;
  v_year int;
  v_month int;
  v_day int;
  v_candidate date;
  v_last_day int;
  v_dow int;
  v_diff int;
BEGIN
  -- WA-SEC-RPC-01: apenas service_role pode invocar.
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'permission denied for function create_recurring_income'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_id obrigatório'; END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN RAISE EXCEPTION 'valor inválido'; END IF;
  IF p_data IS NULL THEN RAISE EXCEPTION 'data obrigatória'; END IF;
  IF v_freq NOT IN ('mensal','semanal','quinzenal') THEN
    RAISE EXCEPTION 'frequencia inválida (mensal|semanal|quinzenal)';
  END IF;

  IF v_freq = 'mensal' THEN
    IF p_dia_mes IS NULL OR p_dia_mes < 1 OR p_dia_mes > 31 THEN
      RAISE EXCEPTION 'dia_mes inválido (1..31)';
    END IF;
    v_year := extract(year from v_today)::int;
    v_month := extract(month from v_today)::int;
    v_last_day := extract(day from (date_trunc('month', make_date(v_year, v_month, 1)) + interval '1 month - 1 day'))::int;
    v_day := least(p_dia_mes, v_last_day);
    v_candidate := make_date(v_year, v_month, v_day);
    IF v_candidate <= v_today THEN
      v_candidate := (date_trunc('month', v_candidate) + interval '1 month')::date;
      v_year := extract(year from v_candidate)::int;
      v_month := extract(month from v_candidate)::int;
      v_last_day := extract(day from (date_trunc('month', make_date(v_year, v_month, 1)) + interval '1 month - 1 day'))::int;
      v_candidate := make_date(v_year, v_month, least(p_dia_mes, v_last_day));
    END IF;
    v_prox := v_candidate;
  ELSIF v_freq = 'semanal' THEN
    IF p_dia_semana IS NULL OR p_dia_semana < 0 OR p_dia_semana > 6 THEN
      RAISE EXCEPTION 'dia_semana inválido (0..6)';
    END IF;
    v_dow := extract(dow from v_today)::int;
    v_diff := ((p_dia_semana - v_dow + 7) % 7);
    IF v_diff = 0 THEN v_diff := 7; END IF;
    v_prox := v_today + v_diff;
  ELSE
    v_prox := v_today + 15;
  END IF;

  INSERT INTO public.recorrencias (
    user_id, nome, valor, frequencia, proxima_cobranca,
    status, tipo_recorrencia, origem, observacao
  ) VALUES (
    p_user_id,
    coalesce(nullif(trim(p_descricao), ''), 'Renda'),
    p_valor,
    v_freq,
    v_prox,
    'ativa',
    'recorrencia_fixa',
    coalesce(p_origem, 'whatsapp'),
    p_observacao
  )
  RETURNING id INTO v_rec_id;

  IF v_rec_id IS NULL THEN
    RAISE EXCEPTION 'falha ao criar recorrência';
  END IF;

  INSERT INTO public.receitas (
    user_id, descricao, valor, data, tipo,
    recorrente, recorrencia_id, mes, ano, origem
  ) VALUES (
    p_user_id,
    coalesce(nullif(trim(p_descricao), ''), 'Renda'),
    p_valor,
    p_data,
    coalesce(p_tipo, 'outros'),
    true,
    v_rec_id,
    extract(month from p_data)::int,
    extract(year from p_data)::int,
    coalesce(p_origem, 'whatsapp')
  )
  RETURNING id INTO v_receita_id;

  IF v_receita_id IS NULL THEN
    RAISE EXCEPTION 'falha ao criar receita';
  END IF;

  RETURN QUERY SELECT v_receita_id, v_rec_id, v_prox;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_recurring_income(uuid, text, numeric, date, text, text, integer, integer, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_recurring_income(uuid, text, numeric, date, text, text, integer, integer, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_recurring_income(uuid, text, numeric, date, text, text, integer, integer, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_recurring_income(uuid, text, numeric, date, text, text, integer, integer, text, text) TO service_role;