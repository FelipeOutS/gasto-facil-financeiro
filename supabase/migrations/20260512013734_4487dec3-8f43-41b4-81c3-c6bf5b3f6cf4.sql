-- Cache de consultas de CNPJ (dados públicos da Receita Federal).
-- Compartilhado entre usuários — CNPJ é dado público, não há PII sensível.
-- Gravação apenas via service role (server function); leitura para autenticados.
CREATE TABLE IF NOT EXISTS public.cnpj_cache (
  cnpj text PRIMARY KEY,
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
  raw_payload jsonb,
  source text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cnpj_cache_cnpj_format CHECK (cnpj ~ '^[0-9]{14}$')
);

CREATE INDEX IF NOT EXISTS idx_cnpj_cache_expires_at ON public.cnpj_cache(expires_at);

ALTER TABLE public.cnpj_cache ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer usuário autenticado pode consultar o cache (dados públicos).
CREATE POLICY "Authenticated users can read cnpj cache"
  ON public.cnpj_cache
  FOR SELECT
  TO authenticated
  USING (true);

-- Gravação: nenhuma policy para anon/authenticated → apenas service role grava
-- (via server function com supabaseAdmin, que ignora RLS).

-- Trigger para manter updated_at.
CREATE TRIGGER cnpj_cache_set_updated_at
  BEFORE UPDATE ON public.cnpj_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();