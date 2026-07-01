UPDATE public.whatsapp_messages
SET status = 'cancelada',
    parsed = COALESCE(parsed, '{}'::jsonb) || jsonb_build_object('cancel_reason', 'WA-Q-Transferencias: rota corrigida para listar_transferencias')
WHERE id = '4cca5ee0-5d2f-4dc2-9af9-0972d974e525'
  AND status = 'aguardando_descricao_e_valor_gasto';