-- Adiciona campos opcionais ao perfil para suportar Pessoa Física, MEI e Empresa.
-- Todos os campos são nullable: usuários antigos continuam funcionando sem alterações.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tipo_cadastro text,
  ADD COLUMN IF NOT EXISTS cpf text,
  ADD COLUMN IF NOT EXISTS cnpj text,
  ADD COLUMN IF NOT EXISTS razao_social text,
  ADD COLUMN IF NOT EXISTS nome_fantasia text,
  ADD COLUMN IF NOT EXISTS responsavel_nome text,
  ADD COLUMN IF NOT EXISTS telefone text;

-- Restringe valores aceitos em tipo_cadastro (permite NULL para usuários antigos).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_tipo_cadastro_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_tipo_cadastro_check
      CHECK (tipo_cadastro IS NULL OR tipo_cadastro IN ('pessoa_fisica', 'mei', 'empresa'));
  END IF;
END$$;

-- Permite que o usuário insira o próprio perfil caso ainda não exista (usuários antigos).
-- A política de SELECT/UPDATE/INSERT já existe, esta migration apenas estende campos.