
-- WA-C9.2 Fase C — Callbacks de status da Meta (idempotência, ordenação, auditoria)
-- Migration isolada. Nenhum backfill financeiro. Nenhuma alteração em RLS/grants existentes.

-- 1) Colunas de entrega e leitura em whatsapp_notifications
ALTER TABLE public.whatsapp_notifications
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS read_at      timestamptz NULL;

-- 2) Índice unique parcial de provider_message_id (garante 1:1 com notificação)
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_notifications_provider_message_id_uniq
  ON public.whatsapp_notifications (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- 3) Tabela normalizada de eventos de callback (auditoria + idempotência)
CREATE TABLE IF NOT EXISTS public.whatsapp_notification_status_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id     uuid NULL REFERENCES public.whatsapp_notifications(id) ON DELETE SET NULL,
  provider_message_id text NOT NULL,
  event_status        text NOT NULL,
  event_at            timestamptz NOT NULL,
  error_code          text NULL,
  error_title         text NULL,
  error_message       text NULL,
  error_category      text NULL,
  conversation_id     text NULL,
  pricing_category    text NULL,
  phone_number_id     text NULL,
  event_key           text NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_notification_status_events_event_status_chk
    CHECK (event_status IN ('sent','delivered','read','failed')),
  CONSTRAINT whatsapp_notification_status_events_event_key_uniq
    UNIQUE (event_key)
);

-- 4) Grants: apenas service_role. Sem anon/authenticated.
REVOKE ALL ON public.whatsapp_notification_status_events FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.whatsapp_notification_status_events TO service_role;

-- 5) RLS ativa e fechada (sem policies para anon/authenticated).
ALTER TABLE public.whatsapp_notification_status_events ENABLE ROW LEVEL SECURITY;

-- 6) Índices auxiliares
CREATE INDEX IF NOT EXISTS idx_wa_notif_status_events_pmid
  ON public.whatsapp_notification_status_events (provider_message_id);
CREATE INDEX IF NOT EXISTS idx_wa_notif_status_events_notif
  ON public.whatsapp_notification_status_events (notification_id)
  WHERE notification_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_notif_status_events_unmatched
  ON public.whatsapp_notification_status_events (provider_message_id, received_at)
  WHERE notification_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_wa_notif_status_events_received
  ON public.whatsapp_notification_status_events (received_at DESC);
