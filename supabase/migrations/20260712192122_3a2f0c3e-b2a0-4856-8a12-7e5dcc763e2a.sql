-- WA-C9.2 Fase B — Lease temporário + ownership token para claim de notificações WhatsApp.
-- Idempotente (IF NOT EXISTS).
-- Sem backfill; sem alterar RLS/grants/constraints; sem trigger novo; sem SECURITY DEFINER.
ALTER TABLE public.whatsapp_notifications
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS claim_token uuid NULL;

CREATE INDEX IF NOT EXISTS idx_wa_notif_processing_lease
  ON public.whatsapp_notifications (lease_expires_at)
  WHERE status = 'processing';