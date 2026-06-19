-- WA-C: Consentimento/opt-in LGPD para WhatsApp como canal de lançamento de gastos.
-- Adiciona campos de consentimento e revogação à tabela whatsapp_links.
-- Vínculos existentes ficam com opt_in_em NULL → webhook não processa até
-- usuário re-aceitar o consentimento explicitamente na UI.

ALTER TABLE public.whatsapp_links
  ADD COLUMN IF NOT EXISTS opt_in_em timestamptz,
  ADD COLUMN IF NOT EXISTS opt_in_ip text,
  ADD COLUMN IF NOT EXISTS opt_in_user_agent text,
  ADD COLUMN IF NOT EXISTS opt_in_version text,
  ADD COLUMN IF NOT EXISTS revogado_em timestamptz;

-- Índice parcial para consulta rápida de vínculos com consentimento ativo
CREATE INDEX IF NOT EXISTS idx_whatsapp_links_opt_in_ativo
  ON public.whatsapp_links(telefone)
  WHERE opt_in_em IS NOT NULL AND revogado_em IS NULL AND ativo = true;

COMMENT ON COLUMN public.whatsapp_links.opt_in_em IS
  'Quando o usuário aceitou o consentimento de uso do WhatsApp como canal de lançamento de gastos. NULL = sem consentimento, webhook não processa.';
COMMENT ON COLUMN public.whatsapp_links.opt_in_version IS
  'Versão textual da copy de consentimento aceita (ex: whatsapp-expense-v1).';
COMMENT ON COLUMN public.whatsapp_links.revogado_em IS
  'Quando o usuário revogou o consentimento. Webhook deve recusar mensagens deste número.';