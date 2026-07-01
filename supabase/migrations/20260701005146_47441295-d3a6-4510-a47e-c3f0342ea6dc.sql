UPDATE public.whatsapp_messages
SET status = 'cancelada',
    parsed = COALESCE(parsed, '{}'::jsonb) || jsonb_build_object('cancel_reason', 'WA-Q-ContasReceber routing fix — safe cancel')
WHERE id = '920c9dd9-19f6-4654-ba67-fdb716ed5716'
  AND status = 'rec_aguardando_tipo';