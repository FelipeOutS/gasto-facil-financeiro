
-- WA-F3.2 — Inserção atômica de compra parcelada no cartão.
-- Centraliza a criação de N parcelas em uma única chamada server-side,
-- garantindo que nenhuma parcela seja persistida se qualquer item falhar.
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
RETURNS TABLE (id uuid, parcela_atual integer, invoice_month text, valor numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cartao_owner uuid;
  v_item jsonb;
  v_count integer;
  v_valor numeric;
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

  -- Confirma que o cartão pertence ao usuário antes de qualquer escrita.
  SELECT user_id INTO v_cartao_owner FROM public.cartoes WHERE id = p_cartao_id;
  IF v_cartao_owner IS NULL OR v_cartao_owner <> p_user_id THEN
    RAISE EXCEPTION 'cartão não pertence ao usuário';
  END IF;

  -- Valida estrutura mínima das parcelas.
  SELECT count(*) INTO v_count FROM jsonb_array_elements(p_parcelas);
  IF v_count <> p_total_parcelas THEN
    RAISE EXCEPTION 'quantidade de parcelas (%) difere de total_parcelas (%)', v_count, p_total_parcelas;
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_parcelas) LOOP
    v_valor := (v_item->>'valor')::numeric;
    IF v_valor IS NULL OR v_valor <= 0 THEN
      RAISE EXCEPTION 'parcela com valor inválido';
    END IF;
  END LOOP;

  -- Inserção atômica. Erros em qualquer linha disparam ROLLBACK
  -- automaticamente da função inteira.
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
    RETURNING gastos.id, gastos.parcela_atual, gastos.invoice_month, gastos.valor
  )
  SELECT id, parcela_atual, invoice_month, valor FROM inserted ORDER BY parcela_atual;
END;
$$;

REVOKE ALL ON FUNCTION public.create_installment_purchase(uuid, uuid, uuid, text, text, text, text, uuid, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_installment_purchase(uuid, uuid, uuid, text, text, text, text, uuid, integer, jsonb) TO service_role;
