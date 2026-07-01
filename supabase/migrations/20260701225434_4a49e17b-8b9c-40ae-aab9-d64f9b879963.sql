
CREATE TABLE public.whatsapp_pix_pending_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_message_id uuid NOT NULL,
  key_ciphertext text NOT NULL,
  key_iv text NOT NULL,
  key_auth_tag text NOT NULL,
  key_hash text NOT NULL,
  key_type text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.whatsapp_pix_pending_secrets TO service_role;
-- No grants to anon/authenticated: read/write only via service_role.
ALTER TABLE public.whatsapp_pix_pending_secrets ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated: table is service-role-only (deny-by-default).

CREATE INDEX idx_wa_pix_pending_secrets_session
  ON public.whatsapp_pix_pending_secrets(session_message_id);
CREATE INDEX idx_wa_pix_pending_secrets_expires
  ON public.whatsapp_pix_pending_secrets(expires_at);
