-- WA-C7: adicionar chave Pix a fornecedores (reuso da entidade existente)
ALTER TABLE public.fornecedores
  ADD COLUMN IF NOT EXISTS pix_key text,
  ADD COLUMN IF NOT EXISTS pix_key_type text;

ALTER TABLE public.fornecedores
  DROP CONSTRAINT IF EXISTS fornecedores_pix_key_type_check;

ALTER TABLE public.fornecedores
  ADD CONSTRAINT fornecedores_pix_key_type_check
  CHECK (
    pix_key_type IS NULL
    OR pix_key_type IN ('email','telefone','cpf','cnpj','aleatoria','desconhecida')
  );

-- Índice para busca rápida por nome no WhatsApp (lower)
CREATE INDEX IF NOT EXISTS idx_fornecedores_user_nome_lower
  ON public.fornecedores (user_id, lower(nome));

-- Índice para busca por apelido (apenas quando presente)
CREATE INDEX IF NOT EXISTS idx_fornecedores_user_apelido_lower
  ON public.fornecedores (user_id, lower(apelido))
  WHERE apelido IS NOT NULL;