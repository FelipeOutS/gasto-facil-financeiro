-- WA-C9.2 Fase D.1 — Livro persistente de tentativas outbound.
-- Tabela interna: RLS ativa, sem policies para anon/authenticated,
-- grants revogados para anon/authenticated/public. Só backend server-side
-- (service_role via supabaseAdmin) opera.

CREATE TABLE IF NOT EXISTS public.whatsapp_notification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.whatsapp_notifications(id) ON DELETE CASCADE,
  attempt_token uuid NOT NULL DEFAULT gen_random_uuid(),
  claim_token uuid NOT NULL,
  request_hash text NOT NULL,
  template_key text NOT NULL,
  template_name text NOT NULL,
  template_language text NOT NULL,
  attempt_status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  provider_message_id text NULL,
  http_status integer NULL,
  error_code text NULL,
  error_category text NULL,
  retryable boolean NULL,
  client_reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_notification_attempts_status_check
    CHECK (attempt_status IN ('planned','sending','accepted','rejected','ambiguous','cancelled')),
  CONSTRAINT whatsapp_notification_attempts_attempt_token_unique UNIQUE (attempt_token),
  CONSTRAINT whatsapp_notification_attempts_client_reference_unique UNIQUE (client_reference)
);

-- Índices auxiliares
CREATE INDEX IF NOT EXISTS idx_wa_notif_attempts_notification
  ON public.whatsapp_notification_attempts (notification_id);
CREATE INDEX IF NOT EXISTS idx_wa_notif_attempts_started
  ON public.whatsapp_notification_attempts (started_at);
CREATE INDEX IF NOT EXISTS idx_wa_notif_attempts_status
  ON public.whatsapp_notification_attempts (attempt_status);
CREATE INDEX IF NOT EXISTS idx_wa_notif_attempts_pmid
  ON public.whatsapp_notification_attempts (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Unique parcial: no máximo UMA tentativa ativa por notificação.
-- planned/sending impede envio duplicado; ambiguous bloqueia retry
-- automático até reconciliação segura futura (Fase D.2).
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_notif_attempts_active_unique
  ON public.whatsapp_notification_attempts (notification_id)
  WHERE attempt_status IN ('planned','sending','ambiguous');

-- Grants fechados: revogar TUDO de anon/authenticated/public.
REVOKE ALL ON public.whatsapp_notification_attempts FROM PUBLIC;
REVOKE ALL ON public.whatsapp_notification_attempts FROM anon;
REVOKE ALL ON public.whatsapp_notification_attempts FROM authenticated;
GRANT ALL ON public.whatsapp_notification_attempts TO service_role;

-- RLS ativa, sem policies (nega tudo por padrão para anon/authenticated).
-- service_role bypassa RLS.
ALTER TABLE public.whatsapp_notification_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_notification_attempts FORCE ROW LEVEL SECURITY;

-- updated_at trigger (reusa função existente set_updated_at do projeto)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at' AND pronamespace = 'public'::regnamespace) THEN
    EXECUTE 'CREATE TRIGGER tg_wa_notif_attempts_updated_at
             BEFORE UPDATE ON public.whatsapp_notification_attempts
             FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
  END IF;
END$$;