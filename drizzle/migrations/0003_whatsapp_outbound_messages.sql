-- Rastreabilidade das respostas enviadas pelo WhatsApp (outbound).
-- Reversão: DROP TABLE public.whatsapp_outbound_messages;
CREATE TABLE public.whatsapp_outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL,
  recipient_hash text NOT NULL,
  recipient_last4 text NULL,
  message_type text NOT NULL CHECK (message_type IN ('text','interactive')),
  source text NOT NULL DEFAULT 'reply',
  content_sha256 text NULL,
  content_length integer NULL,
  meta_message_id text NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('accepted','send_failed','sent','delivered','read','failed')),
  http_status integer NULL,
  error_code text NULL,
  error_message text NULL,
  accepted_at timestamptz NULL,
  sent_at timestamptz NULL,
  delivered_at timestamptz NULL,
  read_at timestamptz NULL,
  failed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.whatsapp_outbound_messages TO authenticated;
GRANT ALL ON public.whatsapp_outbound_messages TO service_role;

ALTER TABLE public.whatsapp_outbound_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own outbound whatsapp messages"
ON public.whatsapp_outbound_messages FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX whatsapp_outbound_messages_user_created_idx
  ON public.whatsapp_outbound_messages (user_id, created_at DESC);
CREATE INDEX whatsapp_outbound_messages_status_idx
  ON public.whatsapp_outbound_messages (status, created_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_notification_status_events_pmid_idx
  ON public.whatsapp_notification_status_events (provider_message_id);