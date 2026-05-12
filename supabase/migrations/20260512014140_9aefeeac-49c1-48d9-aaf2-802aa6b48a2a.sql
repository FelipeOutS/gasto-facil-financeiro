-- Empresa do próprio usuário (MEI/Empresa). Snapshot dos dados públicos do
-- CNPJ no momento do cadastro, mais o vínculo com auth.users.
CREATE TABLE IF NOT EXISTS public.user_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  cnpj text NOT NULL,
  razao_social text,
  nome_fantasia text,
  situacao_cadastral text,
  cnae_principal_codigo text,
  cnae_principal_descricao text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cep text,
  municipio text,
  uf text,
  data_abertura date,
  porte text,
  natureza_juridica text,
  source text,
  cnpj_cache_fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_companies_cnpj_format CHECK (cnpj ~ '^[0-9]{14}$'),
  -- MVP: uma empresa por usuário.
  CONSTRAINT user_companies_user_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_companies_cnpj ON public.user_companies(cnpj);

ALTER TABLE public.user_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_companies_select_own"
  ON public.user_companies FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_companies_insert_own"
  ON public.user_companies FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_companies_update_own"
  ON public.user_companies FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_companies_delete_own"
  ON public.user_companies FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER user_companies_set_updated_at
  BEFORE UPDATE ON public.user_companies
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();