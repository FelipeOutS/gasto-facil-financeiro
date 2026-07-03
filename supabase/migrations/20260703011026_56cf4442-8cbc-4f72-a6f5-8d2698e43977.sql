
CREATE OR REPLACE FUNCTION public.whatsapp_baixa_conta_atomic(
  p_user_id uuid,
  p_conta_id uuid,
  p_data_pagamento date,
  p_origem text DEFAULT 'whatsapp'
)
RETURNS TABLE(
  result text,
  gasto_id uuid,
  nome text,
  valor numeric,
  data_pagamento date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_conta RECORD;
  v_gasto_id uuid;
  v_forma text;
  v_estab text;
BEGIN
  IF p_user_id IS NULL OR p_conta_id IS NULL OR p_data_pagamento IS NULL THEN
    RAISE EXCEPTION 'parametros obrigatorios ausentes';
  END IF;

  -- Lock the row to serialize concurrent baixas
  SELECT * INTO v_conta
  FROM public.contas_a_pagar
  WHERE id = p_conta_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::numeric, NULL::date;
    RETURN;
  END IF;

  -- Idempotência: já paga com vínculo válido => no-op
  IF v_conta.status = 'pago' AND v_conta.gasto_id IS NOT NULL THEN
    RETURN QUERY SELECT 'noop'::text, v_conta.gasto_id, v_conta.nome, v_conta.valor, v_conta.data_pagamento;
    RETURN;
  END IF;

  -- Inconsistência: paga sem gasto vinculado => não cria silenciosamente
  IF v_conta.status = 'pago' AND v_conta.gasto_id IS NULL THEN
    RETURN QUERY SELECT 'inconsistent'::text, NULL::uuid, v_conta.nome, v_conta.valor, v_conta.data_pagamento;
    RETURN;
  END IF;

  -- Só prossegue se estiver pendente
  IF v_conta.status <> 'pendente' THEN
    RETURN QUERY SELECT 'not_pending'::text, NULL::uuid, v_conta.nome, v_conta.valor, v_conta.data_pagamento;
    RETURN;
  END IF;

  -- forma_pagamento: preserva se definida na conta; caso contrário 'outros'
  v_forma := COALESCE(NULLIF(trim(v_conta.forma_pagamento), ''), 'outros');
  v_estab := COALESCE(NULLIF(trim(v_conta.beneficiario), ''), '');

  -- Cria gasto correspondente
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

  -- Marca conta como paga + vincula gasto (mesma transação)
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
$$;

REVOKE ALL ON FUNCTION public.whatsapp_baixa_conta_atomic(uuid, uuid, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_baixa_conta_atomic(uuid, uuid, date, text) TO service_role;
