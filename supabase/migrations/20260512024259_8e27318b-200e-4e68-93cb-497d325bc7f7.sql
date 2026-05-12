-- Tabela clientes (espelho de fornecedores, sem vínculos com receitas nesta etapa)
CREATE TABLE IF NOT EXISTS public.clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  CONSTRAINT clientes_cnpj_14_digitos CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$')
);

-- Índice único parcial: user_id + cnpj quando cnpj não nulo
CREATE UNIQUE INDEX IF NOT EXISTS clientes_user_cnpj_uniq
  ON public.clientes (user_id, cnpj)
  WHERE cnpj IS NOT NULL;

CREATE INDEX IF NOT EXISTS clientes_user_id_idx ON public.clientes (user_id);

-- updated_at automático
DROP TRIGGER IF EXISTS clientes_set_updated_at ON public.clientes;
CREATE TRIGGER clientes_set_updated_at
  BEFORE UPDATE ON public.clientes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuário lê seus clientes"
  ON public.clientes FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Usuário cria seus clientes"
  ON public.clientes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuário atualiza seus clientes"
  ON public.clientes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuário remove seus clientes"
  ON public.clientes FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Contas conectadas (mesma regra de fornecedores)
CREATE POLICY "connected_select_clientes"
  ON public.clientes FOR SELECT TO authenticated
  USING (can_view_account(user_id));

CREATE POLICY "connected_insert_clientes"
  ON public.clientes FOR INSERT TO authenticated
  WITH CHECK (can_create_in_account(user_id));

CREATE POLICY "connected_update_clientes"
  ON public.clientes FOR UPDATE TO authenticated
  USING (can_admin_account(user_id))
  WITH CHECK (can_admin_account(user_id));

CREATE POLICY "connected_delete_clientes"
  ON public.clientes FOR DELETE TO authenticated
  USING (can_admin_account(user_id));