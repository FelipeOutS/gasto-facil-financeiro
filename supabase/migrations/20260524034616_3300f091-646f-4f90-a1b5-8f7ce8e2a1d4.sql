-- Security fix: prevent view-only connected viewers from reading PIX/boleto codes
-- Step 1: Restrict direct table SELECT for connected accounts to admin-level only.
--          Owners keep full access via contas_a_pagar_select_own.
DROP POLICY IF EXISTS connected_select_contas_a_pagar ON public.contas_a_pagar;

CREATE POLICY connected_select_contas_a_pagar
  ON public.contas_a_pagar
  FOR SELECT
  TO authenticated
  USING (public.can_admin_account(user_id));

-- Step 2: Provide a masked view for view-only connected viewers (and admins/owners),
--          so future app code can surface contas a pagar to viewers WITHOUT exposing
--          sensitive payment codes. Sensitive columns are NULL unless the caller is
--          the owner or an admin connected account.
CREATE OR REPLACE VIEW public.contas_a_pagar_shared
WITH (security_invoker = true)
AS
SELECT
  id,
  user_id,
  nome,
  valor,
  data_vencimento,
  categoria_id,
  observacao,
  recorrente,
  recorrencia_id,
  data_inicio,
  data_fim,
  status,
  data_pagamento,
  gasto_id,
  mes,
  ano,
  created_at,
  updated_at,
  beneficiario,
  forma_pagamento,
  CASE
    WHEN auth.uid() = user_id OR public.can_admin_account(user_id)
      THEN codigo_boleto
    ELSE NULL
  END AS codigo_boleto,
  CASE
    WHEN auth.uid() = user_id OR public.can_admin_account(user_id)
      THEN codigo_pix
    ELSE NULL
  END AS codigo_pix,
  CASE
    WHEN auth.uid() = user_id OR public.can_admin_account(user_id)
      THEN chave_pix
    ELSE NULL
  END AS chave_pix,
  banco_emissor,
  import_batch_id,
  frequencia_recorrencia,
  mes_referencia,
  fornecedor_id
FROM public.contas_a_pagar
WHERE public.can_view_account(user_id) OR auth.uid() = user_id;

GRANT SELECT ON public.contas_a_pagar_shared TO authenticated;

COMMENT ON VIEW public.contas_a_pagar_shared IS
  'Masked surface for shared contas a pagar. PIX/boleto codes are nulled for non-admin viewers. Use this view in connected-account contexts instead of the base table.';