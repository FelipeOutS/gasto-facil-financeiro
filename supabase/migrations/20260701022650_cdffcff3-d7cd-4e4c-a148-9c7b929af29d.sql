UPDATE public.whatsapp_messages
SET status = 'cancelada',
    parsed = COALESCE(parsed, '{}'::jsonb) || jsonb_build_object('canceled_reason', 'WA-Q-PixInline-Mask-Fix retest', 'canceled_at', now())
WHERE id = '097e77a4-4fdd-4158-9a88-e1ca15eea330';