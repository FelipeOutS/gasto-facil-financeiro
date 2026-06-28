UPDATE public.whatsapp_messages
SET status = 'cancelada',
    resposta_sugerida = COALESCE(resposta_sugerida, '') || E'\n[WA-Q-Receitas-Fix] Sessão indevida encerrada: consulta interpretada como gasto.'
WHERE id = 'fba6c455-00e4-4ce0-9bcc-4d29ddc70e9b'
  AND status = 'aguardando_descricao_e_valor_gasto';