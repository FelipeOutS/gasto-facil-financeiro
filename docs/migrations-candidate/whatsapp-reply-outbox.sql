-- CANDIDATO INATIVO — NÃO APLICAR sem autorização do dono (Pacote 2 / A).
-- Outbox durável para respostas não entregues depois da janela do webhook.
-- Nenhum código atual depende desta tabela; o webhook continua funcionando sem ela.
CREATE TABLE IF NOT EXISTS public.whatsapp_reply_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  inbound_external_id text NOT NULL,          -- wamid recebido; 1 resposta por mensagem
  telefone_hash text NOT NULL,                 -- sem telefone em claro
  reply_text text NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','sending','accepted','ambiguous','failed_permanent','expired')),
  attempts int NOT NULL DEFAULT 0,
  provider_message_id text,                    -- messages[0].id quando aceito
  last_error_class text,
  window_expires_at timestamptz NOT NULL,      -- última msg do usuário + 24h
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, inbound_external_id)
);
ALTER TABLE public.whatsapp_reply_outbox ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso apenas server-side (service role). Sem GRANT a anon/authenticated.
-- Regras do worker (a implementar só após aplicar):
--  * reivindicar com UPDATE ... SET state='sending' WHERE state='pending' AND window_expires_at > now() RETURNING
--  * 'ambiguous' NUNCA é reenviado automaticamente; reconciliar via callback de status
--  * revalidar vínculo/opt-in/revogação antes de cada envio
