UPDATE public.whatsapp_messages
SET status='cancelada',
    parsed = COALESCE(parsed,'{}'::jsonb) || jsonb_build_object('cancel_reason','WA-Q-Metas: consulta indevida roteada para parser de gasto (3.18)')
WHERE id='6a11d030-7cd6-4f3e-a128-7e97e68b5771'
  AND status='aguardando_descricao_e_valor_gasto';