CREATE OR REPLACE FUNCTION public.create_installment_purchase(p_user_id uuid, p_cartao_id uuid, p_categoria_id uuid, p_descricao text, p_estabelecimento text, p_observacao text, p_origem text, p_grupo_id uuid, p_total_parcelas integer, p_parcelas jsonb)
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
    RETURNING public.gastos.id, public.gastos.parcela_atual, public.gastos.invoice_month, public.gastos.valor
  )
  SELECT inserted.id, inserted.parcela_atual, inserted.invoice_month, inserted.valor
    FROM inserted ORDER BY inserted.parcela_atual;
END;
$function$;