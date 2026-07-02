
CREATE TABLE public.whatsapp_pix_reveal_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  favorecido_id uuid NOT NULL REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  pix_key_type text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.whatsapp_pix_reveal_tokens TO authenticated;
GRANT ALL ON public.whatsapp_pix_reveal_tokens TO service_role;

ALTER TABLE public.whatsapp_pix_reveal_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own reveal tokens: read"
  ON public.whatsapp_pix_reveal_tokens FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX idx_whatsapp_pix_reveal_tokens_expiry
  ON public.whatsapp_pix_reveal_tokens (expires_at);
CREATE INDEX idx_whatsapp_pix_reveal_tokens_user_fav
  ON public.whatsapp_pix_reveal_tokens (user_id, favorecido_id);
