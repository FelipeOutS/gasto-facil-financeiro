
CREATE TABLE public.fornecedores (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  cnpj text,
  nome text NOT NULL,
  apelido text,
  razao_social text,
  nome_fantasia text,
  situacao_cadastral text,
  cnae_principal_codigo text,
  cnae_principal_descricao text,
  telefone text,
  email text,
  observacoes text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cep text,
  municipio text,
  uf text,
  ativo boolean NOT NULL DEFAULT true,
  source text,
  cnpj_cache_fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fornecedores_cnpj_format CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$')
);

CREATE UNIQUE INDEX fornecedores_user_cnpj_unique
  ON public.fornecedores (user_id, cnpj)
  WHERE cnpj IS NOT NULL;

CREATE INDEX fornecedores_user_id_idx ON public.fornecedores (user_id);

ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuário lê seus fornecedores"
  ON public.fornecedores FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Usuário cria seus fornecedores"
  ON public.fornecedores FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuário atualiza seus fornecedores"
  ON public.fornecedores FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuário remove seus fornecedores"
  ON public.fornecedores FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER set_fornecedores_updated_at
  BEFORE UPDATE ON public.fornecedores
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
